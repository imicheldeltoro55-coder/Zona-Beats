// Carga variables desde .env sin dependencias externas
(function loadEnv() {
  const fs = require('node:fs');
  const path = require('node:path');
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const idx = trimmed.indexOf('=');
    if (idx === -1) return;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  });
})();

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');

const db = require('./db');
const { issueStreamToken, validateStreamToken } = require('./streamAuth');
const { applyWatermark } = require('./watermark');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'cambiaesto123';
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const UPLOADS_AUDIO = path.join(__dirname, 'uploads', 'audio');
const UPLOADS_COVERS = path.join(__dirname, 'uploads', 'covers');
const UPLOADS_RECEIPTS = path.join(__dirname, 'uploads', 'receipts');
const UPLOADS_WATERMARK = path.join(__dirname, 'uploads', 'watermark');
const TMP_PROCESSING = path.join(__dirname, 'uploads', 'tmp');
[UPLOADS_AUDIO, UPLOADS_COVERS, UPLOADS_RECEIPTS, UPLOADS_WATERMARK, TMP_PROCESSING].forEach(d => fs.mkdirSync(d, { recursive: true }));

const MAX_AUDIO_BYTES = 150 * 1024 * 1024; // 150MB por pista (para WAV sin comprimir)
const MAX_COVER_BYTES = 8 * 1024 * 1024;  // 8MB portada
const MAX_RECEIPT_BYTES = 12 * 1024 * 1024; // 12MB comprobante (fotos de capturas de pantalla pueden pesar más que una portada)
const MAX_WATERMARK_BYTES = 10 * 1024 * 1024; // 10MB para el audio corto de la voz de marca de agua

// ---------- Sesión admin simple (cookie firmada, sin dependencias) ----------
function signSession() {
  const payload = `admin:${Date.now()}`;
  const sig = crypto.createHmac('sha256', ADMIN_SESSION_SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}.${sig}`).toString('base64');
}

function verifySession(cookieValue) {
  try {
    const decoded = Buffer.from(cookieValue, 'base64').toString('utf8');
    const [payload, sig] = decoded.split('.');
    const expectedSig = crypto.createHmac('sha256', ADMIN_SESSION_SECRET).update(payload).digest('hex');
    if (sig !== expectedSig) return false;
    const ts = Number(payload.split(':')[1]);
    // sesión válida por 12 horas
    return Date.now() - ts < 1000 * 60 * 60 * 12;
  } catch {
    return false;
  }
}

function getCookie(req, name) {
  const header = req.headers.cookie || '';
  const parts = header.split(';').map(p => p.trim());
  for (const p of parts) {
    if (p.startsWith(name + '=')) return decodeURIComponent(p.slice(name.length + 1));
  }
  return null;
}

function isAdminAuthed(req) {
  const cookie = getCookie(req, 'admin_session');
  return cookie && verifySession(cookie);
}

// ---------- Utilidades ----------
function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) return sendJSON(res, 404, { error: 'No encontrado' });
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('PAYLOAD_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Parser multipart/form-data minimalista (sin dependencias externas)
function parseMultipart(buffer, boundary) {
  const boundaryBuf = Buffer.from(`--${boundary}`);
  const parts = [];
  let start = buffer.indexOf(boundaryBuf);
  while (start !== -1) {
    const next = buffer.indexOf(boundaryBuf, start + boundaryBuf.length);
    if (next === -1) break;
    let part = buffer.slice(start + boundaryBuf.length, next);
    // remover CRLF inicial/final
    if (part.slice(0, 2).toString() === '\r\n') part = part.slice(2);
    part = part.slice(0, part.length - 2); // quitar CRLF final antes del siguiente boundary
    if (part.length > 0) parts.push(part);
    start = next;
  }

  return parts.map(part => {
    const headerEnd = part.indexOf('\r\n\r\n');
    const headerStr = part.slice(0, headerEnd).toString('utf8');
    const content = part.slice(headerEnd + 4);

    const nameMatch = headerStr.match(/name="([^"]+)"/);
    const filenameMatch = headerStr.match(/filename="([^"]*)"/);
    const typeMatch = headerStr.match(/Content-Type:\s*([^\r\n]+)/i);

    return {
      name: nameMatch ? nameMatch[1] : null,
      filename: filenameMatch ? filenameMatch[1] : null,
      contentType: typeMatch ? typeMatch[1].trim() : null,
      data: content,
    };
  });
}

function safeExt(filename, fallback) {
  const ext = path.extname(filename || '').toLowerCase().replace(/[^a-z0-9.]/g, '');
  return ext || fallback;
}

const ALLOWED_AUDIO_EXT = ['.mp3', '.wav', '.m4a', '.ogg', '.flac'];
const ALLOWED_IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp'];

function contentTypeForAudio(ext) {
  return {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
  }[ext] || 'application/octet-stream';
}

function contentTypeForImage(ext) {
  return {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
  }[ext] || 'application/octet-stream';
}

// ---------- Rutas de la API ----------
const routes = [];
function route(method, pattern, handler) {
  routes.push({ method, pattern, handler });
}

function matchRoute(method, pathname) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const paramNames = [];
    const regexStr = '^' + r.pattern.replace(/:[^/]+/g, (m) => {
      paramNames.push(m.slice(1));
      return '([^/]+)';
    }) + '$';
    const match = pathname.match(new RegExp(regexStr));
    if (match) {
      const params = {};
      paramNames.forEach((name, i) => { params[name] = decodeURIComponent(match[i + 1]); });
      return { handler: r.handler, params };
    }
  }
  return null;
}

// --- API pública: listar tracks ---
// --- API pública: listar tracks. ?type=catalog (default) | playlist | vip ---
route('GET', '/api/tracks', (req, res, params, query) => {
  const type = query.get('type') || 'catalog';
  let rows;

  if (type === 'playlist') {
    // Playlist: música gratuita, nunca aparece mezclada con el catálogo de venta.
    rows = db.prepare(`
      SELECT id, title, genre, description, artist_credit, cover_filename, duration_seconds, plays, created_at
      FROM tracks WHERE is_playlist = 1 ORDER BY created_at DESC
    `).all();
  } else if (type === 'vip') {
    // Beats VIP: pistas exclusivas que ya se vendieron (compra única, ya no disponibles para nadie más).
    rows = db.prepare(`
      SELECT id, title, genre, description, cover_filename, duration_seconds, plays,
             price_label, price_cup, for_sale, is_exclusive, sold, created_at
      FROM tracks WHERE is_playlist = 0 AND is_exclusive = 1 AND sold = 1 ORDER BY created_at DESC
    `).all();
  } else {
    // Catálogo: todo lo que está a la venta y aún no se vendió (si es exclusiva).
    rows = db.prepare(`
      SELECT id, title, genre, description, cover_filename, duration_seconds, plays,
             price_label, price_cup, for_sale, is_exclusive, sold, created_at
      FROM tracks WHERE is_playlist = 0 AND sold = 0 ORDER BY created_at DESC
    `).all();
  }

  sendJSON(res, 200, { tracks: rows });
});

// --- API pública: obtener perfil del artista ---
route('GET', '/api/profile', (req, res) => {
  const profile = db.prepare('SELECT artist_name, bio, avatar_filename FROM profile WHERE id = 1').get();
  sendJSON(res, 200, { profile });
});

// --- API pública: configuración del sitio (promoción y horario de atención) ---
route('GET', '/api/site-config', (req, res) => {
  const config = db.prepare('SELECT promo_text, promo_active, schedule_text FROM site_config WHERE id = 1').get();
  sendJSON(res, 200, {
    promoText: config.promo_text || '',
    promoActive: Boolean(config.promo_active),
    scheduleText: config.schedule_text || '',
  });
});

// --- API pública: tasas de cambio (para que el usuario vea el precio en su moneda preferida) ---
route('GET', '/api/exchange-rates', (req, res) => {
  const row = db.prepare('SELECT rates_json FROM exchange_rates WHERE id = 1').get();
  let rates = [];
  try { rates = JSON.parse(row.rates_json || '[]'); } catch { rates = []; }
  sendJSON(res, 200, { rates });
});

// --- API pública: datos de cobro para comprar una pista (cuentas + teléfono de contacto) ---
route('GET', '/api/payment-info', (req, res) => {
  const info = db.prepare('SELECT contact_phone, accounts_json FROM payment_info WHERE id = 1').get();
  let accounts = [];
  try { accounts = JSON.parse(info.accounts_json || '[]'); } catch { accounts = []; }
  sendJSON(res, 200, { contactPhone: info.contact_phone || '', accounts });
});

// --- API pública: redes sociales del artista ---
route('GET', '/api/social-links', (req, res) => {
  const row = db.prepare('SELECT links_json FROM social_links WHERE id = 1').get();
  let links = [];
  try { links = JSON.parse(row.links_json || '[]'); } catch { links = []; }
  sendJSON(res, 200, { links });
});

// --- API pública: enviar comprobante de pago (crea un pedido que se revisa en el panel) ---
route('POST', '/api/orders', async (req, res) => {
  const contentType = req.headers['content-type'] || '';
  const boundaryMatch = contentType.match(/boundary=(.+)$/);
  if (!boundaryMatch) return sendJSON(res, 400, { error: 'Falta boundary multipart' });

  let buffer;
  try {
    buffer = await readBody(req, MAX_RECEIPT_BYTES + 1024 * 50);
  } catch {
    return sendJSON(res, 413, { error: 'La imagen del comprobante es demasiado grande' });
  }

  const parts = parseMultipart(buffer, boundaryMatch[1]);
  const fields = {};
  let receiptPart = null;
  for (const part of parts) {
    if (part.filename && part.name === 'receipt') receiptPart = part;
    else if (part.name) fields[part.name] = part.data.toString('utf8');
  }

  const trackId = Number(fields.trackId);
  const buyerName = (fields.buyerName || '').trim().slice(0, 100);
  const buyerPhone = (fields.buyerPhone || '').trim().slice(0, 40);
  const currency = (fields.currency || 'CUP').trim().slice(0, 20);
  const displayedPrice = (fields.displayedPrice || '').trim().slice(0, 60);

  if (!trackId || !buyerName || !buyerPhone || !receiptPart) {
    return sendJSON(res, 400, { error: 'Faltan datos: nombre, teléfono o comprobante' });
  }

  const track = db.prepare('SELECT id, title, price_label, is_exclusive, sold FROM tracks WHERE id = ?').get(trackId);
  if (!track) return sendJSON(res, 404, { error: 'Pista no encontrada' });

  // Una pista exclusiva que ya se vendió no puede comprarse de nuevo — se resguarda
  // aquí además de en el frontend, por si dos personas intentan comprarla casi a la vez.
  if (track.is_exclusive && track.sold) {
    return sendJSON(res, 409, { error: 'Esta pista exclusiva ya fue comprada por otra persona' });
  }

  const receiptExt = safeExt(receiptPart.filename, '.jpg');
  if (!ALLOWED_IMAGE_EXT.includes(receiptExt)) {
    return sendJSON(res, 400, { error: 'El comprobante debe ser una imagen (JPG, PNG o WEBP)' });
  }
  if (receiptPart.data.length > MAX_RECEIPT_BYTES) {
    return sendJSON(res, 413, { error: 'La imagen del comprobante es demasiado grande' });
  }

  const receiptFilename = `${crypto.randomUUID()}${receiptExt}`;
  fs.writeFileSync(path.join(UPLOADS_RECEIPTS, receiptFilename), receiptPart.data);

  db.prepare(`
    INSERT INTO orders (track_id, track_title, price_label, currency, buyer_name, buyer_phone, receipt_filename)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(track.id, track.title, displayedPrice || track.price_label || '', currency, buyerName, buyerPhone, receiptFilename);

  sendJSON(res, 201, { ok: true });
});

// --- API pública: pedir token temporal para reproducir un track ---
route('POST', '/api/tracks/:id/token', (req, res, params) => {
  const track = db.prepare('SELECT id FROM tracks WHERE id = ?').get(params.id);
  if (!track) return sendJSON(res, 404, { error: 'Pista no encontrada' });
  const token = issueStreamToken(track.id);
  db.prepare('UPDATE tracks SET plays = plays + 1 WHERE id = ?').run(track.id);
  sendJSON(res, 200, { token, expiresInSeconds: 1800 });
});

// --- Descarga real, solo permitida para pistas de Playlist (las gratuitas) ---
route('GET', '/api/download/:id', (req, res, params) => {
  const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(params.id);
  if (!track) return sendJSON(res, 404, { error: 'Pista no encontrada' });

  // Verificación en el servidor, no solo en el frontend: una pista del Catálogo de venta
  // nunca se puede descargar por esta vía aunque alguien arme la URL a mano.
  if (!track.is_playlist) {
    return sendJSON(res, 403, { error: 'Esta pista no está disponible para descarga' });
  }

  const filePath = path.join(UPLOADS_AUDIO, track.audio_filename);
  if (!fs.existsSync(filePath)) return sendJSON(res, 404, { error: 'Archivo no encontrado' });

  const ext = path.extname(track.audio_filename).toLowerCase();
  const safeName = track.title.replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'pista';

  res.writeHead(200, {
    'Content-Type': contentTypeForAudio(ext),
    'Content-Disposition': `attachment; filename="${safeName}${ext}"`,
    'Content-Length': fs.statSync(filePath).size,
  });
  fs.createReadStream(filePath).pipe(res);
});

// --- Streaming de audio con soporte de Range (chunks), requiere token válido ---
route('GET', '/api/stream/:id', (req, res, params, query) => {
  const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(params.id);
  if (!track) return sendJSON(res, 404, { error: 'Pista no encontrada' });

  const token = query.get('t');
  if (!token || !validateStreamToken(token, track.id)) {
    return sendJSON(res, 403, { error: 'Token inválido o expirado' });
  }

  const filePath = path.join(UPLOADS_AUDIO, track.audio_filename);
  if (!fs.existsSync(filePath)) return sendJSON(res, 404, { error: 'Archivo no encontrado' });

  const stat = fs.statSync(filePath);
  const ext = path.extname(track.audio_filename).toLowerCase();
  const contentType = contentTypeForAudio(ext);
  const range = req.headers.range;

  // Cabeceras anti-cache / anti-descarga básica: se sirve inline, nunca como attachment
  const baseHeaders = {
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'Content-Disposition': 'inline',
    'Cache-Control': 'no-store',
  };

  if (range) {
    const match = range.match(/bytes=(\d*)-(\d*)/);
    let start = match[1] ? parseInt(match[1], 10) : 0;
    let end = match[2] ? parseInt(match[2], 10) : stat.size - 1;
    if (end >= stat.size) end = stat.size - 1;
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      ...baseHeaders,
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Content-Length': chunkSize,
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { ...baseHeaders, 'Content-Length': stat.size });
    fs.createReadStream(filePath).pipe(res);
  }
});

// --- Cover art (público, no necesita token) ---
route('GET', '/api/cover/:id', (req, res, params) => {
  const track = db.prepare('SELECT cover_filename FROM tracks WHERE id = ?').get(params.id);
  if (!track || !track.cover_filename) return sendJSON(res, 404, { error: 'Sin portada' });
  const filePath = path.join(UPLOADS_COVERS, track.cover_filename);
  const ext = path.extname(track.cover_filename).toLowerCase();
  sendFile(res, filePath, contentTypeForImage(ext));
});

route('GET', '/api/avatar', (req, res) => {
  const profile = db.prepare('SELECT avatar_filename FROM profile WHERE id = 1').get();
  if (!profile || !profile.avatar_filename) return sendJSON(res, 404, { error: 'Sin avatar' });
  const filePath = path.join(UPLOADS_COVERS, profile.avatar_filename);
  const ext = path.extname(profile.avatar_filename).toLowerCase();
  sendFile(res, filePath, contentTypeForImage(ext));
});

// ---------- ADMIN ----------

route('POST', '/api/admin/login', async (req, res) => {
  try {
    const body = await readBody(req, 1024 * 10);
    const { password } = JSON.parse(body.toString('utf8'));
    if (password !== ADMIN_PASSWORD) {
      return sendJSON(res, 401, { error: 'Contraseña incorrecta' });
    }
    const sessionValue = signSession();
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': `admin_session=${encodeURIComponent(sessionValue)}; HttpOnly; Path=/; Max-Age=43200; SameSite=Strict`,
    });
    res.end(JSON.stringify({ ok: true }));
  } catch (e) {
    sendJSON(res, 400, { error: 'Solicitud inválida' });
  }
});

route('POST', '/api/admin/logout', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Set-Cookie': 'admin_session=; HttpOnly; Path=/; Max-Age=0',
  });
  res.end(JSON.stringify({ ok: true }));
});

route('GET', '/api/admin/check', (req, res) => {
  sendJSON(res, 200, { authenticated: isAdminAuthed(req) });
});

// Subir nueva pista (multipart: title, genre, description, audio, cover)
route('POST', '/api/admin/tracks', async (req, res) => {
  if (!isAdminAuthed(req)) return sendJSON(res, 401, { error: 'No autorizado' });

  const contentType = req.headers['content-type'] || '';
  const boundaryMatch = contentType.match(/boundary=(.+)$/);
  if (!boundaryMatch) return sendJSON(res, 400, { error: 'Falta boundary multipart' });

  let buffer;
  try {
    buffer = await readBody(req, MAX_AUDIO_BYTES + MAX_COVER_BYTES + 1024 * 100);
  } catch {
    return sendJSON(res, 413, { error: 'Archivo demasiado grande' });
  }

  const parts = parseMultipart(buffer, boundaryMatch[1]);
  const fields = {};
  let audioPart = null;
  let coverPart = null;

  for (const part of parts) {
    if (part.filename && part.name === 'audio') audioPart = part;
    else if (part.filename && part.name === 'cover') coverPart = part;
    else if (part.name) fields[part.name] = part.data.toString('utf8');
  }

  if (!fields.title || !audioPart) {
    return sendJSON(res, 400, { error: 'Falta título o archivo de audio' });
  }

  const audioExt = safeExt(audioPart.filename, '.mp3');
  if (!ALLOWED_AUDIO_EXT.includes(audioExt)) {
    return sendJSON(res, 400, { error: 'Formato de audio no permitido' });
  }
  if (audioPart.data.length > MAX_AUDIO_BYTES) {
    return sendJSON(res, 413, { error: `Audio demasiado grande (máx ${Math.round(MAX_AUDIO_BYTES / 1024 / 1024)}MB)` });
  }

  // Guardar el audio subido en una ruta temporal primero, porque si hay marca de agua
  // configurada necesitamos procesarlo con ffmpeg antes de que sea el archivo "definitivo".
  const tmpUploadPath = path.join(TMP_PROCESSING, `${crypto.randomUUID()}${audioExt}`);
  fs.writeFileSync(tmpUploadPath, audioPart.data);

  const watermarkConfig = db.prepare('SELECT * FROM watermark_config WHERE id = 1').get();
  let savedAudioFilename;

  if (watermarkConfig && watermarkConfig.voice_filename) {
    const watermarkPath = path.join(UPLOADS_WATERMARK, watermarkConfig.voice_filename);
    const watermarkedFilename = `${crypto.randomUUID()}.wav`; // ffmpeg siempre exporta a WAV aquí
    try {
      await applyWatermark({
        inputPath: tmpUploadPath,
        watermarkPath,
        outputPath: path.join(UPLOADS_AUDIO, watermarkedFilename),
        intervalSeconds: watermarkConfig.interval_seconds,
        volume: watermarkConfig.volume,
      });
      savedAudioFilename = watermarkedFilename;
    } catch (err) {
      console.error('Error aplicando marca de agua:', err.message);
      return sendJSON(res, 500, { error: 'No se pudo procesar el audio con la marca de agua. Verifica que el archivo no esté dañado.' });
    } finally {
      fs.unlinkSync(tmpUploadPath);
    }
  } else {
    // Sin marca de agua configurada: se guarda el audio subido tal cual (mismo formato original).
    savedAudioFilename = `${crypto.randomUUID()}${audioExt}`;
    fs.renameSync(tmpUploadPath, path.join(UPLOADS_AUDIO, savedAudioFilename));
  }

  let coverFilename = '';
  if (coverPart && coverPart.data.length > 0) {
    const coverExt = safeExt(coverPart.filename, '.jpg');
    if (ALLOWED_IMAGE_EXT.includes(coverExt) && coverPart.data.length <= MAX_COVER_BYTES) {
      coverFilename = `${crypto.randomUUID()}${coverExt}`;
      fs.writeFileSync(path.join(UPLOADS_COVERS, coverFilename), coverPart.data);
    }
  }

  const isPlaylist = fields.isPlaylist === '1' || fields.isPlaylist === 'true' ? 1 : 0;
  const isExclusive = !isPlaylist && (fields.isExclusive === '1' || fields.isExclusive === 'true') ? 1 : 0;
  const forSale = !isPlaylist && (fields.forSale === '1' || fields.forSale === 'true') ? 1 : 0;
  const artistCredit = (fields.artistCredit || '').trim();

  // El precio se define en CUP (moneda base). priceCup es el número puro para poder
  // convertir a otras monedas; priceLabel es lo que se muestra si no hay conversión.
  const priceCup = isPlaylist ? 0 : Math.max(0, parseFloat(fields.priceCup) || 0);
  const priceLabel = isPlaylist ? '' : (priceCup > 0 ? `${priceCup} CUP` : (fields.priceLabel || '').trim());

  const result = db.prepare(`
    INSERT INTO tracks (title, genre, description, artist_credit, audio_filename, cover_filename,
                         price_label, price_cup, for_sale, is_playlist, is_exclusive)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    fields.title, fields.genre || '', fields.description || '', artistCredit,
    savedAudioFilename, coverFilename, priceLabel, priceCup, forSale, isPlaylist, isExclusive
  );

  sendJSON(res, 201, { id: Number(result.lastInsertRowid) });
});

// Listar tracks para admin (igual que público, pero requiere sesión)
route('GET', '/api/admin/tracks', (req, res, params, query) => {
  if (!isAdminAuthed(req)) return sendJSON(res, 401, { error: 'No autorizado' });
  const type = query.get('type') || 'catalog';

  let tracks;
  if (type === 'playlist') {
    tracks = db.prepare('SELECT * FROM tracks WHERE is_playlist = 1 ORDER BY created_at DESC').all();
  } else if (type === 'vip') {
    tracks = db.prepare('SELECT * FROM tracks WHERE is_playlist = 0 AND is_exclusive = 1 AND sold = 1 ORDER BY created_at DESC').all();
  } else {
    tracks = db.prepare('SELECT * FROM tracks WHERE is_playlist = 0 ORDER BY created_at DESC').all();
  }

  sendJSON(res, 200, { tracks });
});

// Actualizar precio / disponibilidad de venta / exclusividad de una pista
route('POST', '/api/admin/tracks/:id/price', async (req, res, params) => {
  if (!isAdminAuthed(req)) return sendJSON(res, 401, { error: 'No autorizado' });
  const track = db.prepare('SELECT id, is_playlist FROM tracks WHERE id = ?').get(params.id);
  if (!track) return sendJSON(res, 404, { error: 'No encontrada' });
  if (track.is_playlist) return sendJSON(res, 400, { error: 'Las pistas de Playlist no tienen precio' });

  try {
    const body = await readBody(req, 1024 * 5);
    const { priceCup, forSale, isExclusive } = JSON.parse(body.toString('utf8'));
    const cleanPriceCup = Math.max(0, parseFloat(priceCup) || 0);
    const priceLabel = cleanPriceCup > 0 ? `${cleanPriceCup} CUP` : '';

    db.prepare('UPDATE tracks SET price_label = ?, price_cup = ?, for_sale = ?, is_exclusive = ? WHERE id = ?')
      .run(priceLabel, cleanPriceCup, forSale ? 1 : 0, isExclusive ? 1 : 0, params.id);
    sendJSON(res, 200, { ok: true });
  } catch {
    sendJSON(res, 400, { error: 'Solicitud inválida' });
  }
});

// Borrar track
route('DELETE', '/api/admin/tracks/:id', (req, res, params) => {
  if (!isAdminAuthed(req)) return sendJSON(res, 401, { error: 'No autorizado' });
  const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(params.id);
  if (!track) return sendJSON(res, 404, { error: 'No encontrada' });

  const audioPath = path.join(UPLOADS_AUDIO, track.audio_filename);
  if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
  if (track.cover_filename) {
    const coverPath = path.join(UPLOADS_COVERS, track.cover_filename);
    if (fs.existsSync(coverPath)) fs.unlinkSync(coverPath);
  }
  db.prepare('DELETE FROM tracks WHERE id = ?').run(params.id);
  sendJSON(res, 200, { ok: true });
});

// Actualizar perfil del artista (nombre, bio, avatar)
route('POST', '/api/admin/profile', async (req, res) => {
  if (!isAdminAuthed(req)) return sendJSON(res, 401, { error: 'No autorizado' });

  const contentType = req.headers['content-type'] || '';
  const boundaryMatch = contentType.match(/boundary=(.+)$/);
  if (!boundaryMatch) return sendJSON(res, 400, { error: 'Falta boundary multipart' });

  let buffer;
  try {
    buffer = await readBody(req, MAX_COVER_BYTES + 1024 * 50);
  } catch {
    return sendJSON(res, 413, { error: 'Archivo demasiado grande' });
  }

  const parts = parseMultipart(buffer, boundaryMatch[1]);
  const fields = {};
  let avatarPart = null;
  for (const part of parts) {
    if (part.filename && part.name === 'avatar') avatarPart = part;
    else if (part.name) fields[part.name] = part.data.toString('utf8');
  }

  const current = db.prepare('SELECT * FROM profile WHERE id = 1').get();
  let avatarFilename = current.avatar_filename;

  if (avatarPart && avatarPart.data.length > 0) {
    const ext = safeExt(avatarPart.filename, '.jpg');
    if (ALLOWED_IMAGE_EXT.includes(ext) && avatarPart.data.length <= MAX_COVER_BYTES) {
      avatarFilename = `${crypto.randomUUID()}${ext}`;
      fs.writeFileSync(path.join(UPLOADS_COVERS, avatarFilename), avatarPart.data);
    }
  }

  db.prepare('UPDATE profile SET artist_name = ?, bio = ?, avatar_filename = ? WHERE id = 1')
    .run(fields.artist_name || current.artist_name, fields.bio ?? current.bio, avatarFilename);

  sendJSON(res, 200, { ok: true });
});

// Obtener datos de cobro (vista admin, igual que el público pero requiere sesión por consistencia del panel)
route('GET', '/api/admin/payment-info', (req, res) => {
  if (!isAdminAuthed(req)) return sendJSON(res, 401, { error: 'No autorizado' });
  const info = db.prepare('SELECT contact_phone, accounts_json FROM payment_info WHERE id = 1').get();
  let accounts = [];
  try { accounts = JSON.parse(info.accounts_json || '[]'); } catch { accounts = []; }
  sendJSON(res, 200, { contactPhone: info.contact_phone || '', accounts });
});

// Actualizar datos de cobro: teléfono de contacto + lista de cuentas (moneda + banco + número)
route('POST', '/api/admin/payment-info', async (req, res) => {
  if (!isAdminAuthed(req)) return sendJSON(res, 401, { error: 'No autorizado' });
  try {
    const body = await readBody(req, 1024 * 20);
    const { contactPhone, accounts } = JSON.parse(body.toString('utf8'));

    if (!Array.isArray(accounts)) {
      return sendJSON(res, 400, { error: 'Formato de cuentas inválido' });
    }
    const cleanAccounts = accounts
      .filter(a => a && (a.bank || a.number))
      .map(a => ({
        currency: String(a.currency || 'CUP').slice(0, 20).trim(),
        bank: String(a.bank || '').slice(0, 60).trim(),
        number: String(a.number || '').slice(0, 60).trim(),
      }));

    db.prepare('UPDATE payment_info SET contact_phone = ?, accounts_json = ? WHERE id = 1')
      .run(String(contactPhone || '').slice(0, 40).trim(), JSON.stringify(cleanAccounts));

    sendJSON(res, 200, { ok: true });
  } catch {
    sendJSON(res, 400, { error: 'Solicitud inválida' });
  }
});

// Obtener redes sociales (vista admin)
route('GET', '/api/admin/social-links', (req, res) => {
  if (!isAdminAuthed(req)) return sendJSON(res, 401, { error: 'No autorizado' });
  const row = db.prepare('SELECT links_json FROM social_links WHERE id = 1').get();
  let links = [];
  try { links = JSON.parse(row.links_json || '[]'); } catch { links = []; }
  sendJSON(res, 200, { links });
});

// Actualizar la lista completa de redes sociales (nombre + link cada una, cualquier plataforma)
route('POST', '/api/admin/social-links', async (req, res) => {
  if (!isAdminAuthed(req)) return sendJSON(res, 401, { error: 'No autorizado' });
  try {
    const body = await readBody(req, 1024 * 20);
    const { links } = JSON.parse(body.toString('utf8'));

    if (!Array.isArray(links)) {
      return sendJSON(res, 400, { error: 'Formato de redes sociales inválido' });
    }

    const cleanLinks = links
      .filter(l => l && (l.label || l.url))
      .map(l => ({
        label: String(l.label || '').slice(0, 40).trim(),
        url: String(l.url || '').slice(0, 500).trim(),
      }))
      .filter(l => l.url); // sin URL no tiene sentido guardar la entrada

    // Validación básica: solo http(s), para no guardar cosas como javascript: en un link clicable
    for (const l of cleanLinks) {
      if (!/^https?:\/\//i.test(l.url)) {
        return sendJSON(res, 400, { error: `El link "${l.url}" debe empezar con http:// o https://` });
      }
    }

    db.prepare('UPDATE social_links SET links_json = ? WHERE id = 1').run(JSON.stringify(cleanLinks));
    sendJSON(res, 200, { ok: true });
  } catch {
    sendJSON(res, 400, { error: 'Solicitud inválida' });
  }
});

// ---------- Tasas de cambio ----------

// Obtener tasas actuales (vista admin)
route('GET', '/api/admin/exchange-rates', (req, res) => {
  if (!isAdminAuthed(req)) return sendJSON(res, 401, { error: 'No autorizado' });
  const row = db.prepare('SELECT rates_json FROM exchange_rates WHERE id = 1').get();
  let rates = [];
  try { rates = JSON.parse(row.rates_json || '[]'); } catch { rates = []; }
  sendJSON(res, 200, { rates });
});

// Actualizar tasas de cambio. CUP siempre queda fija en 1 (es la moneda base).
route('POST', '/api/admin/exchange-rates', async (req, res) => {
  if (!isAdminAuthed(req)) return sendJSON(res, 401, { error: 'No autorizado' });
  try {
    const body = await readBody(req, 1024 * 10);
    const { rates } = JSON.parse(body.toString('utf8'));
    if (!Array.isArray(rates)) return sendJSON(res, 400, { error: 'Formato de tasas inválido' });

    const cleanRates = rates.map(r => ({
      code: String(r.code || '').slice(0, 30).trim(),
      label: String(r.label || '').slice(0, 40).trim(),
      cupPerUnit: r.code === 'CUP' ? 1 : Math.max(0, parseFloat(r.cupPerUnit) || 0),
    })).filter(r => r.code);

    db.prepare('UPDATE exchange_rates SET rates_json = ? WHERE id = 1').run(JSON.stringify(cleanRates));
    sendJSON(res, 200, { ok: true });
  } catch {
    sendJSON(res, 400, { error: 'Solicitud inválida' });
  }
});

// ---------- Configuración del sitio (promociones + horario) ----------

route('GET', '/api/admin/site-config', (req, res) => {
  if (!isAdminAuthed(req)) return sendJSON(res, 401, { error: 'No autorizado' });
  const config = db.prepare('SELECT promo_text, promo_active, schedule_text FROM site_config WHERE id = 1').get();
  sendJSON(res, 200, {
    promoText: config.promo_text || '',
    promoActive: Boolean(config.promo_active),
    scheduleText: config.schedule_text || '',
  });
});

route('POST', '/api/admin/site-config', async (req, res) => {
  if (!isAdminAuthed(req)) return sendJSON(res, 401, { error: 'No autorizado' });
  try {
    const body = await readBody(req, 1024 * 10);
    const { promoText, promoActive, scheduleText } = JSON.parse(body.toString('utf8'));
    db.prepare('UPDATE site_config SET promo_text = ?, promo_active = ?, schedule_text = ? WHERE id = 1')
      .run(String(promoText || '').slice(0, 300).trim(), promoActive ? 1 : 0, String(scheduleText || '').slice(0, 300).trim());
    sendJSON(res, 200, { ok: true });
  } catch {
    sendJSON(res, 400, { error: 'Solicitud inválida' });
  }
});

// ---------- Pedidos (comprobantes de compra) ----------

// Listar pedidos pendientes de revisión
route('GET', '/api/admin/orders', (req, res) => {
  if (!isAdminAuthed(req)) return sendJSON(res, 401, { error: 'No autorizado' });
  const orders = db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
  sendJSON(res, 200, { orders });
});

// Ver la imagen del comprobante de un pedido específico
route('GET', '/api/admin/orders/:id/receipt', (req, res, params) => {
  if (!isAdminAuthed(req)) return sendJSON(res, 401, { error: 'No autorizado' });
  const order = db.prepare('SELECT receipt_filename FROM orders WHERE id = ?').get(params.id);
  if (!order) return sendJSON(res, 404, { error: 'Pedido no encontrado' });
  const filePath = path.join(UPLOADS_RECEIPTS, order.receipt_filename);
  const ext = path.extname(order.receipt_filename).toLowerCase();
  sendFile(res, filePath, contentTypeForImage(ext));
});

// Aprobar un pedido: si la pista es exclusiva, se marca como vendida y desaparece
// del catálogo público para todos los demás — pasa a verse solo en "Beats VIP".
route('POST', '/api/admin/orders/:id/approve', (req, res, params) => {
  if (!isAdminAuthed(req)) return sendJSON(res, 401, { error: 'No autorizado' });
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(params.id);
  if (!order) return sendJSON(res, 404, { error: 'Pedido no encontrado' });

  const track = db.prepare('SELECT id, is_exclusive, sold FROM tracks WHERE id = ?').get(order.track_id);
  if (track && track.is_exclusive && !track.sold) {
    db.prepare('UPDATE tracks SET sold = 1 WHERE id = ?').run(track.id);
  }

  db.prepare("UPDATE orders SET status = 'approved' WHERE id = ?").run(params.id);
  sendJSON(res, 200, { ok: true, trackMarkedSold: Boolean(track && track.is_exclusive) });
});

// Eliminar un pedido ya revisado (borra también el archivo del comprobante del disco)
route('DELETE', '/api/admin/orders/:id', (req, res, params) => {
  if (!isAdminAuthed(req)) return sendJSON(res, 401, { error: 'No autorizado' });
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(params.id);
  if (!order) return sendJSON(res, 404, { error: 'Pedido no encontrado' });

  const receiptPath = path.join(UPLOADS_RECEIPTS, order.receipt_filename);
  if (fs.existsSync(receiptPath)) fs.unlinkSync(receiptPath);

  db.prepare('DELETE FROM orders WHERE id = ?').run(params.id);
  sendJSON(res, 200, { ok: true });
});

// ---------- Marca de agua audible ----------

const ALLOWED_WATERMARK_EXT = ['.mp3', '.wav', '.m4a', '.ogg', '.flac'];

// Obtener configuración actual (para mostrar en el panel admin)
route('GET', '/api/admin/watermark', (req, res) => {
  if (!isAdminAuthed(req)) return sendJSON(res, 401, { error: 'No autorizado' });
  const config = db.prepare('SELECT * FROM watermark_config WHERE id = 1').get();
  sendJSON(res, 200, {
    active: Boolean(config.voice_filename),
    intervalSeconds: config.interval_seconds,
    volume: config.volume,
  });
});

// Subir o reemplazar el audio de voz de la marca de agua, y/o actualizar intervalo/volumen
route('POST', '/api/admin/watermark', async (req, res) => {
  if (!isAdminAuthed(req)) return sendJSON(res, 401, { error: 'No autorizado' });

  const contentType = req.headers['content-type'] || '';
  const boundaryMatch = contentType.match(/boundary=(.+)$/);
  if (!boundaryMatch) return sendJSON(res, 400, { error: 'Falta boundary multipart' });

  let buffer;
  try {
    buffer = await readBody(req, MAX_WATERMARK_BYTES + 1024 * 50);
  } catch {
    return sendJSON(res, 413, { error: 'Archivo demasiado grande' });
  }

  const parts = parseMultipart(buffer, boundaryMatch[1]);
  const fields = {};
  let voicePart = null;
  for (const part of parts) {
    if (part.filename && part.name === 'voice') voicePart = part;
    else if (part.name) fields[part.name] = part.data.toString('utf8');
  }

  const current = db.prepare('SELECT * FROM watermark_config WHERE id = 1').get();
  let voiceFilename = current.voice_filename;

  if (voicePart && voicePart.data.length > 0) {
    const ext = safeExt(voicePart.filename, '.mp3');
    if (!ALLOWED_WATERMARK_EXT.includes(ext)) {
      return sendJSON(res, 400, { error: 'Formato de audio no permitido para la marca de agua' });
    }
    if (voicePart.data.length > MAX_WATERMARK_BYTES) {
      return sendJSON(res, 413, { error: `El audio de marca de agua debe pesar menos de ${MAX_WATERMARK_BYTES / 1024 / 1024}MB` });
    }
    // Borrar la voz anterior si existía, para no acumular archivos huérfanos
    if (current.voice_filename) {
      const oldPath = path.join(UPLOADS_WATERMARK, current.voice_filename);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    voiceFilename = `${crypto.randomUUID()}${ext}`;
    fs.writeFileSync(path.join(UPLOADS_WATERMARK, voiceFilename), voicePart.data);
  }

  const intervalSeconds = fields.intervalSeconds ? Math.max(5, Math.min(600, parseInt(fields.intervalSeconds, 10) || 20)) : current.interval_seconds;
  const volume = fields.volume ? Math.max(0.05, Math.min(1, parseFloat(fields.volume) || 0.35)) : current.volume;

  db.prepare('UPDATE watermark_config SET voice_filename = ?, interval_seconds = ?, volume = ? WHERE id = 1')
    .run(voiceFilename, intervalSeconds, volume);

  sendJSON(res, 200, { ok: true, active: Boolean(voiceFilename) });
});

// Quitar la marca de agua (deja de aplicarse a las pistas nuevas; no reprocesa las ya subidas)
route('DELETE', '/api/admin/watermark', (req, res) => {
  if (!isAdminAuthed(req)) return sendJSON(res, 401, { error: 'No autorizado' });
  const current = db.prepare('SELECT * FROM watermark_config WHERE id = 1').get();
  if (current.voice_filename) {
    const voicePath = path.join(UPLOADS_WATERMARK, current.voice_filename);
    if (fs.existsSync(voicePath)) fs.unlinkSync(voicePath);
  }
  db.prepare("UPDATE watermark_config SET voice_filename = '' WHERE id = 1").run();
  sendJSON(res, 200, { ok: true });
});

// Escuchar la voz de marca de agua actual (para que el admin la confirme antes de activarla)
route('GET', '/api/admin/watermark/preview', (req, res) => {
  if (!isAdminAuthed(req)) return sendJSON(res, 401, { error: 'No autorizado' });
  const config = db.prepare('SELECT voice_filename FROM watermark_config WHERE id = 1').get();
  if (!config.voice_filename) return sendJSON(res, 404, { error: 'No hay marca de agua configurada' });
  const filePath = path.join(UPLOADS_WATERMARK, config.voice_filename);
  const ext = path.extname(config.voice_filename).toLowerCase();
  sendFile(res, filePath, contentTypeForAudio(ext));
});

// ---------- Archivos estáticos (frontend) ----------
const STATIC_DIRS = {
  '/admin': path.join(__dirname, 'admin'),
  '': path.join(__dirname, 'public'),
};

function serveStatic(req, res, pathname) {
  let baseDir = STATIC_DIRS[''];
  let relativePath = pathname;

  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    baseDir = STATIC_DIRS['/admin'];
    relativePath = pathname.replace(/^\/admin/, '') || '/index.html';
  }
  if (relativePath === '/' || relativePath === '') relativePath = '/index.html';

  const filePath = path.join(baseDir, relativePath);
  // prevenir path traversal
  if (!filePath.startsWith(baseDir)) {
    return sendJSON(res, 403, { error: 'Prohibido' });
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // fallback SPA: servir index.html
      fs.readFile(path.join(baseDir, 'index.html'), (err2, indexData) => {
        if (err2) return sendJSON(res, 404, { error: 'No encontrado' });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(indexData);
      });
      return;
    }
    const ext = path.extname(filePath);
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.ico': 'image/x-icon',
    };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------- Servidor HTTP ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (pathname.startsWith('/api/')) {
    const matched = matchRoute(req.method, pathname);
    if (matched) {
      try {
        await matched.handler(req, res, matched.params, url.searchParams);
      } catch (err) {
        console.error(err);
        if (!res.headersSent) sendJSON(res, 500, { error: 'Error interno' });
      }
      return;
    }
    return sendJSON(res, 404, { error: 'Ruta no encontrada' });
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
  console.log(`Panel admin en http://localhost:${PORT}/admin`);
});

// Timeouts generosos para subidas de audio grandes (WAV) en conexiones lentas.
// Por defecto Node corta la conexión a los 2 minutos de inactividad; lo subimos a 10.
server.timeout = 10 * 60 * 1000;
server.headersTimeout = 10 * 60 * 1000 + 5000;
server.requestTimeout = 10 * 60 * 1000;
server.keepAliveTimeout = 10 * 60 * 1000;
