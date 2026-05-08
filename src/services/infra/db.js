// src/services/infra/db.js - Configuración y acceso a la base de datos SQLite para usuarios, acciones, estadísticas y overlays.
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { runMigrations } = require('./migrations');

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'app.db');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      rcon_host TEXT DEFAULT '',
      rcon_port INTEGER DEFAULT 25575,
      rcon_password TEXT DEFAULT '',
      minecraft_playername TEXT DEFAULT '@a',
      tiktok_username TEXT DEFAULT '',
      use_global_rcon INTEGER NOT NULL DEFAULT 0,
      use_global_tiktok INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT DEFAULT '',
      type TEXT NOT NULL,
      trigger TEXT DEFAULT '',
      command TEXT NOT NULL,
      use_queue INTEGER NOT NULL DEFAULT 0,
      repeat_per_unit INTEGER NOT NULL DEFAULT 0,
      audio_enabled INTEGER NOT NULL DEFAULT 0,
      audio_asset TEXT NOT NULL DEFAULT '',
      audio_volume INTEGER NOT NULL DEFAULT 70,
      audio_wait_for_finish INTEGER NOT NULL DEFAULT 0,
      audio_replace_current INTEGER NOT NULL DEFAULT 0,
      audio_play_once_per_combo INTEGER NOT NULL DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      minecraft_version TEXT DEFAULT '',
      folder TEXT DEFAULT '',
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );


    CREATE TABLE IF NOT EXISTS stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      total_likes INTEGER NOT NULL DEFAULT 0,
      total_comments INTEGER NOT NULL DEFAULT 0,
      total_follows INTEGER NOT NULL DEFAULT 0,
      total_gifts INTEGER NOT NULL DEFAULT 0,
      diamonds_total INTEGER NOT NULL DEFAULT 0,
      users_json TEXT NOT NULL DEFAULT '{}',
      gift_types_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS overlays (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL DEFAULT 'Nuevo overlay',
      canvas_json TEXT NOT NULL DEFAULT '{"width":1080,"height":1920,"background":"transparent"}',
      elements_json TEXT NOT NULL DEFAULT '[]',
      groups_json TEXT NOT NULL DEFAULT '[]',
      preview TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS queue_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      source TEXT NOT NULL DEFAULT 'unknown',
      commands_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      processed_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS gallery_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      author_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      tags_json TEXT NOT NULL DEFAULT '[]',
      name TEXT DEFAULT '',
      type TEXT NOT NULL,
      trigger TEXT DEFAULT '',
      command TEXT NOT NULL,
      use_queue INTEGER NOT NULL DEFAULT 0,
      repeat_per_unit INTEGER NOT NULL DEFAULT 0,
      audio_enabled INTEGER NOT NULL DEFAULT 0,
      audio_asset TEXT NOT NULL DEFAULT '',
      audio_volume INTEGER NOT NULL DEFAULT 70,
      audio_wait_for_finish INTEGER NOT NULL DEFAULT 0,
      audio_replace_current INTEGER NOT NULL DEFAULT 0,
      audio_play_once_per_combo INTEGER NOT NULL DEFAULT 1,
      minecraft_version TEXT NOT NULL DEFAULT '1.20',
      imports_count INTEGER NOT NULL DEFAULT 0,
      is_public INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_actions_user_id ON actions(user_id);
    CREATE INDEX IF NOT EXISTS idx_overlays_user_id ON overlays(user_id);
    CREATE INDEX IF NOT EXISTS idx_queue_user_id ON queue_items(user_id);
    CREATE INDEX IF NOT EXISTS idx_queue_user_status ON queue_items(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings(user_id);
    CREATE INDEX IF NOT EXISTS idx_stats_user_id ON stats(user_id);
    CREATE INDEX IF NOT EXISTS idx_gallery_author_id ON gallery_actions(author_id);
    CREATE INDEX IF NOT EXISTS idx_gallery_public_created ON gallery_actions(is_public, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_gallery_type_public ON gallery_actions(type, is_public);
  `);

  const actionColumns = new Set(
    db.prepare(`PRAGMA table_info(actions)`).all().map((column) => column.name)
  );

  const addColumnIfMissing = (columnName, definition) => {
    if (actionColumns.has(columnName)) return;
    db.exec(`ALTER TABLE actions ADD COLUMN ${definition}`);
    actionColumns.add(columnName);
  };

  addColumnIfMissing('audio_wait_for_finish', 'audio_wait_for_finish INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('audio_replace_current', 'audio_replace_current INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('audio_play_once_per_combo', 'audio_play_once_per_combo INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('minecraft_version', "minecraft_version TEXT DEFAULT ''");
  addColumnIfMissing('folder', "folder TEXT DEFAULT ''");

  const galleryColumns = new Set(
    db.prepare(`PRAGMA table_info(gallery_actions)`).all().map((column) => column.name)
  );

  const addGalleryColumnIfMissing = (columnName, definition) => {
    if (galleryColumns.has(columnName)) return;
    db.exec(`ALTER TABLE gallery_actions ADD COLUMN ${definition}`);
    galleryColumns.add(columnName);
  };

  addGalleryColumnIfMissing('audio_enabled', 'audio_enabled INTEGER NOT NULL DEFAULT 0');
  addGalleryColumnIfMissing('audio_asset', "audio_asset TEXT NOT NULL DEFAULT ''");
  addGalleryColumnIfMissing('audio_volume', 'audio_volume INTEGER NOT NULL DEFAULT 70');
  addGalleryColumnIfMissing('audio_wait_for_finish', 'audio_wait_for_finish INTEGER NOT NULL DEFAULT 0');
  addGalleryColumnIfMissing('audio_replace_current', 'audio_replace_current INTEGER NOT NULL DEFAULT 0');
  addGalleryColumnIfMissing('audio_play_once_per_combo', 'audio_play_once_per_combo INTEGER NOT NULL DEFAULT 1');

  db.exec(`
    UPDATE actions
    SET audio_play_once_per_combo = 0
    WHERE audio_play_once_per_combo IS NULL OR audio_play_once_per_combo <> 0
  `);
}

function getDb() {
  return db;
}

module.exports = {
  getDb,
  initDb,
  DB_PATH
};