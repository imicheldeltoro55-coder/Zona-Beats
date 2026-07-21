const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DB_DIR = path.join(__dirname, 'db');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DB_DIR, 'app.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    genre TEXT DEFAULT '',
    description TEXT DEFAULT '',
    audio_filename TEXT NOT NULL,
    cover_filename TEXT DEFAULT '',
    duration_seconds INTEGER DEFAULT 0,
    plays INTEGER DEFAULT 0,
    price_label TEXT DEFAULT '',
    for_sale INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS profile (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    artist_name TEXT DEFAULT '',
    bio TEXT DEFAULT '',
    avatar_filename TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS payment_info (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    contact_phone TEXT DEFAULT '',
    accounts_json TEXT DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS stream_tokens (
    token TEXT PRIMARY KEY,
    track_id INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id INTEGER NOT NULL,
    track_title TEXT NOT NULL,
    price_label TEXT DEFAULT '',
    buyer_name TEXT NOT NULL,
    buyer_phone TEXT NOT NULL,
    receipt_filename TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS watermark_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    voice_filename TEXT DEFAULT '',
    interval_seconds INTEGER DEFAULT 20,
    volume REAL DEFAULT 0.35
  );

  CREATE TABLE IF NOT EXISTS social_links (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    links_json TEXT DEFAULT '[]'
  );
`);

// Migración simple para bases de datos ya existentes (creadas antes de agregar precio/venta)
const trackCols = db.prepare("PRAGMA table_info(tracks)").all().map(c => c.name);
if (!trackCols.includes('price_label')) {
  db.exec("ALTER TABLE tracks ADD COLUMN price_label TEXT DEFAULT ''");
}
if (!trackCols.includes('for_sale')) {
  db.exec('ALTER TABLE tracks ADD COLUMN for_sale INTEGER DEFAULT 0');
}

// Migración de bases de datos creadas antes de renombrar dj_name -> artist_name
const profileCols = db.prepare("PRAGMA table_info(profile)").all().map(c => c.name);
if (profileCols.includes('dj_name') && !profileCols.includes('artist_name')) {
  db.exec("ALTER TABLE profile ADD COLUMN artist_name TEXT DEFAULT ''");
  db.exec('UPDATE profile SET artist_name = dj_name WHERE id = 1');
}

// Asegurar que exista una fila de perfil
const profileExists = db.prepare('SELECT id FROM profile WHERE id = 1').get();
if (!profileExists) {
  db.prepare(`INSERT INTO profile (id, artist_name, bio) VALUES (1, '', 'Bienvenido a mi música')`).run();
}

// Asegurar que exista una fila de datos de cobro
const paymentExists = db.prepare('SELECT id FROM payment_info WHERE id = 1').get();
if (!paymentExists) {
  db.prepare(`INSERT INTO payment_info (id, contact_phone, accounts_json) VALUES (1, '', '[]')`).run();
}

// Asegurar que exista una fila de configuración de marca de agua
const watermarkExists = db.prepare('SELECT id FROM watermark_config WHERE id = 1').get();
if (!watermarkExists) {
  db.prepare(`INSERT INTO watermark_config (id, voice_filename, interval_seconds, volume) VALUES (1, '', 20, 0.35)`).run();
}

// Asegurar que exista una fila de redes sociales, precargada con los links iniciales del artista
const socialExists = db.prepare('SELECT id FROM social_links WHERE id = 1').get();
if (!socialExists) {
  const defaultLinks = JSON.stringify([
    { label: 'Spotify', url: 'https://open.spotify.com/artist/5miqqIFpsWv8Tpx1OlD4Ay' },
    { label: 'Facebook', url: 'https://www.facebook.com/share/1HQWkiRP8T/' },
    { label: 'YouTube Music', url: 'https://music.youtube.com/@jlarryrg' },
    { label: 'Instagram', url: 'https://www.instagram.com/jlarryrg' },
  ]);
  db.prepare('INSERT INTO social_links (id, links_json) VALUES (1, ?)').run(defaultLinks);
}

module.exports = db;
