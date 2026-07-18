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

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'cambiaesto123';
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const UPLOADS_AUDIO = path.join(__dirname, 'uploads', 'audio');
const UPLOADS_COVERS = path.join(__dirname, 'uploads', 'covers');
[UPLOADS_AUDIO, UPLOADS_COVERS].forEach(d => fs.mkdirSync(d, { recursive: true }));

const MAX_AUDIO_BYTES = 60 * 1024 * 1024; // 60MB por pista
const MAX_COVER_BYTES = 8 * 1024 * 1024;  // 8MB portada

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
route('GET', '/api/tracks', (req, res) => {
  const tracks = db.prepare(`
    SELECT id, title, genre, description, cover_filename, duration_seconds, plays,
           price_label, for_sale, created_at
    FROM tracks ORDER BY created_at DESC
  `).all();
  sendJSON(res, 200, { tracks });
});

// --- API pública: obtener perfil del DJ ---
route('GET', '/api/profile', (req, res) => {
  const profile = db.prepare('SELECT dj_name, bio, avatar_filename FROM profile WHERE id = 1').get();
  sendJSON(res, 200, { profile });
});

// --- API pública: datos de cobro para comprar una pista (cuentas + teléfono de contacto) ---
route('GET', '/api/payment-info', (req, res) => {
  const info = db.prepare('SELECT contact_phone, accounts_json FROM payment_info WHERE id = 1').get();
  let accounts = [];
  try { accounts = JSON.parse(info.accounts_json || '[]'); } catch { accounts = []; }
  sendJSON(res, 200, { contactPhone: info.contact_phone || '', accounts });
});

// --- API pública: pedir token temporal para reproducir un track ---
route('POST', '/api/tracks/:id/token', (req, res, params) => {
  const track = db.prepare('SELECT id FROM tracks WHERE id = ?').get(params.id);
  if (!track) return sendJSON(res, 404, { error: 'Pista no encontrada' });
  const token = issueStreamToken(track.id);
  db.prepare('UPDATE tracks SET plays = plays + 1 WHERE id = ?').run(track.id);
  sendJSON(res, 200, { token, expiresInSeconds: 1800 });
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
    return sendJSON(res, 413, { error: 'Audio demasiado grande (máx 60MB)' });
  }

  const audioFilename = `${crypto.randomUUID()}${audioExt}`;
  fs.writeFileSync(path.join(UPLOADS_AUDIO, audioFilename), audioPart.data);

  let coverFilename = '';
  if (coverPart && coverPart.data.length > 0) {
    const coverExt = safeExt(coverPart.filename, '.jpg');
    if (ALLOWED_IMAGE_EXT.includes(coverExt) && coverPart.data.length <= MAX_COVER_BYTES) {
      coverFilename = `${crypto.randomUUID()}${coverExt}`;
      fs.writeFileSync(path.join(UPLOADS_COVERS, coverFilename), coverPart.data);
    }
  }

  const priceLabel = (fields.priceLabel || '').trim();
  const forSale = fields.forSale === '1' || fields.forSale === 'true' ? 1 : 0;

  const result = db.prepare(`
    INSERT INTO tracks (title, genre, description, audio_filename, cover_filename, price_label, for_sale)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(fields.title, fields.genre || '', fields.description || '', audioFilename, coverFilename, priceLabel, forSale);

  sendJSON(res, 201, { id: Number(result.lastInsertRowid) });
});

// Listar tracks para admin (igual que público, pero requiere sesión)
route('GET', '/api/admin/tracks', (req, res) => {
  if (!isAdminAuthed(req)) return sendJSON(res, 401, { error: 'No autorizado' });
  const tracks = db.prepare('SELECT * FROM tracks ORDER BY created_at DESC').all();
  sendJSON(res, 200, { tracks });
});

// Actualizar precio / disponibilidad de venta de una pista
route('POST', '/api/admin/tracks/:id/price', async (req, res, params) => {
  if (!isAdminAuthed(req)) return sendJSON(res, 401, { error: 'No autorizado' });
  const track = db.prepare('SELECT id FROM tracks WHERE id = ?').get(params.id);
  if (!track) return sendJSON(res, 404, { error: 'No encontrada' });

  try {
    const body = await readBody(req, 1024 * 5);
    const { priceLabel, forSale } = JSON.parse(body.toString('utf8'));
    db.prepare('UPDATE tracks SET price_label = ?, for_sale = ? WHERE id = ?')
      .run((priceLabel || '').trim(), forSale ? 1 : 0, params.id);
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

// Actualizar perfil del DJ (nombre, bio, avatar)
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

  db.prepare('UPDATE profile SET dj_name = ?, bio = ?, avatar_filename = ? WHERE id = 1')
    .run(fields.dj_name || current.dj_name, fields.bio ?? current.bio, avatarFilename);

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

// Actualizar datos de cobro: teléfono de contacto + lista de cuentas (banco + número)
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
        bank: String(a.bank || '').slice(0, 60).trim(),
        number: String(a.number || '').slice(0, 40).trim(),
      }));

    db.prepare('UPDATE payment_info SET contact_phone = ?, accounts_json = ? WHERE id = 1')
      .run(String(contactPhone || '').slice(0, 40).trim(), JSON.stringify(cleanAccounts));

    sendJSON(res, 200, { ok: true });
  } catch {
    sendJSON(res, 400, { error: 'Solicitud inválida' });
  }
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
