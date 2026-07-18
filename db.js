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
    dj_name TEXT DEFAULT 'DJ',
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
`);

// Migración simple para bases de datos ya existentes (creadas antes de agregar precio/venta)
const trackCols = db.prepare("PRAGMA table_info(tracks)").all().map(c => c.name);
if (!trackCols.includes('price_label')) {
  db.exec("ALTER TABLE tracks ADD COLUMN price_label TEXT DEFAULT ''");
}
if (!trackCols.includes('for_sale')) {
  db.exec('ALTER TABLE tracks ADD COLUMN for_sale INTEGER DEFAULT 0');
}

// Asegurar que exista una fila de perfil
const profileExists = db.prepare('SELECT id FROM profile WHERE id = 1').get();
if (!profileExists) {
  db.prepare(`INSERT INTO profile (id, dj_name, bio) VALUES (1, 'DJ Set', 'Bienvenido a mi música')`).run();
}

// Asegurar que exista una fila de datos de cobro
const paymentExists = db.prepare('SELECT id FROM payment_info WHERE id = 1').get();
if (!paymentExists) {
  db.prepare(`INSERT INTO payment_info (id, contact_phone, accounts_json) VALUES (1, '', '[]')`).run();
}

module.exports = db;
