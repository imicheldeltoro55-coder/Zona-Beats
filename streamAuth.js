const crypto = require('node:crypto');
const db = require('./db');

const TOKEN_TTL_MS = 1000 * 60 * 30; // 30 minutos de validez por token

// Limpia tokens vencidos de vez en cuando
function cleanupExpired() {
  const now = Date.now();
  db.prepare('DELETE FROM stream_tokens WHERE expires_at < ?').run(now);
}

// Genera un token de streaming temporal ligado a un track específico.
// Esto evita que el link de audio se pueda copiar y compartir/reusar indefinidamente.
function issueStreamToken(trackId) {
  cleanupExpired();
  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  db.prepare('INSERT INTO stream_tokens (token, track_id, expires_at) VALUES (?, ?, ?)')
    .run(token, trackId, expiresAt);
  return token;
}

function validateStreamToken(token, trackId) {
  const row = db.prepare('SELECT * FROM stream_tokens WHERE token = ?').get(token);
  if (!row) return false;
  if (row.track_id !== Number(trackId)) return false;
  if (row.expires_at < Date.now()) return false;
  return true;
}

module.exports = { issueStreamToken, validateStreamToken };
