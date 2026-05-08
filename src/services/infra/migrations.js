// src/services/infra/migrations.js - Migraciones de base de datos
const fs = require('fs');
const path = require('path');
const logger = require('../../utils/logger');

const CACHE_DIR = path.join(process.cwd(), 'data', 'cache');
const AUDIO_CACHE_DIR = path.join(CACHE_DIR, 'audio');
const IMAGE_CACHE_DIR = path.join(CACHE_DIR, 'img');
const CACHE_URL_BASE = 'http://cache-migration.local';

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function rewriteCachedPath(value) {
  const raw = String(value || '').trim();
  if (!raw) return raw;

  const isAbsoluteUrl = /^https?:\/\//i.test(raw);
  if (!isAbsoluteUrl && !raw.startsWith('/cache/')) return raw;

  let parsed;
  try {
    parsed = new URL(raw, CACHE_URL_BASE);
  } catch {
    return raw;
  }

  const pathname = parsed.pathname || '';
  if (!pathname.startsWith('/cache/')) return raw;
  if (pathname.startsWith('/cache/audio/') || pathname.startsWith('/cache/img/')) return raw;

  const fileName = path.posix.basename(pathname);
  if (!fileName || fileName === '.' || fileName === '..') return raw;

  const nextPath = fileName.startsWith('audio_')
    ? `/cache/audio/${fileName.replace(/^audio_/, '')}`
    : `/cache/img/${fileName}`;

  if (isAbsoluteUrl) {
    parsed.pathname = nextPath;
    return parsed.toString();
  }

  return nextPath;
}

function rewriteCachedValues(value) {
  if (Array.isArray(value)) {
    return value.map((item) => rewriteCachedValues(item));
  }

  if (value && typeof value === 'object') {
    const next = {};

    for (const [key, item] of Object.entries(value)) {
      next[key] = rewriteCachedValues(item);
    }

    return next;
  }

  if (typeof value === 'string') {
    return rewriteCachedPath(value);
  }

  return value;
}

function moveLegacyCacheFiles() {
  ensureDir(CACHE_DIR);
  ensureDir(AUDIO_CACHE_DIR);
  ensureDir(IMAGE_CACHE_DIR);

  const entries = fs.readdirSync(CACHE_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile()) continue;

    const sourcePath = path.join(CACHE_DIR, entry.name);

    if (entry.name.startsWith('audio_')) {
      const targetName = entry.name.replace(/^audio_/, '');
      const targetPath = path.join(AUDIO_CACHE_DIR, targetName);

      if (sourcePath === targetPath) continue;

      if (fs.existsSync(targetPath)) {
        fs.unlinkSync(sourcePath);
      } else {
        fs.renameSync(sourcePath, targetPath);
      }

      logger.info(`✅ Migración: audio movido a ${path.relative(process.cwd(), targetPath)}`);
      continue;
    }

    const targetPath = path.join(IMAGE_CACHE_DIR, entry.name);

    if (sourcePath === targetPath) continue;

    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(sourcePath);
    } else {
      fs.renameSync(sourcePath, targetPath);
    }

    logger.info(`✅ Migración: imagen movida a ${path.relative(process.cwd(), targetPath)}`);
  }
}

function migrateActionAudioAssets(db) {
  const rows = db.prepare(`
    SELECT id, audio_asset
    FROM actions
    WHERE audio_asset IS NOT NULL AND audio_asset <> ''
  `).all();

  const update = db.prepare(`
    UPDATE actions
    SET audio_asset = ?
    WHERE id = ?
  `);

  for (const row of rows) {
    const nextValue = rewriteCachedPath(row.audio_asset);
    if (nextValue === row.audio_asset) continue;
    update.run(nextValue, row.id);
  }
}

function migrateGalleryAudioAssets(db) {
  const rows = db.prepare(`
    SELECT id, audio_asset
    FROM gallery_actions
    WHERE audio_asset IS NOT NULL AND audio_asset <> ''
  `).all();

  const update = db.prepare(`
    UPDATE gallery_actions
    SET audio_asset = ?
    WHERE id = ?
  `);

  for (const row of rows) {
    const nextValue = rewriteCachedPath(row.audio_asset);
    if (nextValue === row.audio_asset) continue;
    update.run(nextValue, row.id);
  }
}

function migrateOverlayCacheRefs(db) {
  const rows = db.prepare(`
    SELECT id, elements_json, groups_json, preview
    FROM overlays
  `).all();

  const update = db.prepare(`
    UPDATE overlays
    SET elements_json = ?, groups_json = ?, preview = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  for (const row of rows) {
    const nextElements = rewriteCachedValues(safeJsonParse(row.elements_json, []));
    const nextGroups = rewriteCachedValues(safeJsonParse(row.groups_json, []));
    const nextPreview = rewriteCachedPath(row.preview || '');

    const nextElementsJson = JSON.stringify(nextElements);
    const nextGroupsJson = JSON.stringify(nextGroups);

    if (
      nextElementsJson === row.elements_json &&
      nextGroupsJson === row.groups_json &&
      nextPreview === (row.preview || '')
    ) {
      continue;
    }

    update.run(nextElementsJson, nextGroupsJson, nextPreview, row.id);
  }
}

function runMigrations(db) {
  try {
    // Migración 1: Agregar columnas minecraft_version y folder a actions
    try {
      db.prepare(`ALTER TABLE actions ADD COLUMN minecraft_version TEXT DEFAULT ''`).run();
      logger.info('✅ Migración: Columna minecraft_version agregada a actions');
    } catch (err) {
      if (!err.message.includes('duplicate column')) {
        throw err;
      }
    }

    try {
      db.prepare(`ALTER TABLE actions ADD COLUMN folder TEXT DEFAULT ''`).run();
      logger.info('✅ Migración: Columna folder agregada a actions');
    } catch (err) {
      if (!err.message.includes('duplicate column')) {
        throw err;
      }
    }

    // Migración 2: Crear tabla action_folders si no existe
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS action_folders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          UNIQUE(user_id, name)
        );
        
        CREATE INDEX IF NOT EXISTS idx_folders_user_id ON action_folders(user_id);
      `);
      logger.info('✅ Migración: Tabla action_folders creada');
    } catch (err) {
      if (!err.message.includes('already exists')) {
        throw err;
      }
    }

    // Migración 3: Crear índices en actions
    try {
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_actions_user_folder ON actions(user_id, folder)`).run();
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_actions_enabled ON actions(enabled)`).run();
      logger.info('✅ Migración: Índices en actions creados');
    } catch (err) {
      // Índice podría ya existir
    }

    // Migración 4: mover caché vieja a subcarpetas nuevas y reescribir referencias guardadas
    moveLegacyCacheFiles();
    migrateActionAudioAssets(db);
    migrateOverlayCacheRefs(db);

    // Migración 5: Campos de audio por acción
    try {
      db.prepare(`ALTER TABLE actions ADD COLUMN audio_enabled INTEGER NOT NULL DEFAULT 0`).run();
      logger.info('✅ Migración: Columna audio_enabled agregada a actions');
    } catch (err) {
      if (!err.message.includes('duplicate column')) {
        throw err;
      }
    }

    try {
      db.prepare(`ALTER TABLE actions ADD COLUMN audio_asset TEXT NOT NULL DEFAULT ''`).run();
      logger.info('✅ Migración: Columna audio_asset agregada a actions');
    } catch (err) {
      if (!err.message.includes('duplicate column')) {
        throw err;
      }
    }

    try {
      db.prepare(`ALTER TABLE actions ADD COLUMN audio_volume INTEGER NOT NULL DEFAULT 70`).run();
      logger.info('✅ Migración: Columna audio_volume agregada a actions');
    } catch (err) {
      if (!err.message.includes('duplicate column')) {
        throw err;
      }
    }

    try {
      db.prepare(`ALTER TABLE actions ADD COLUMN audio_mode TEXT NOT NULL DEFAULT 'once_per_event'`).run();
      logger.info('✅ Migración: Columna audio_mode agregada a actions');
    } catch (err) {
      if (!err.message.includes('duplicate column')) {
        throw err;
      }
    }

    try {
      db.prepare(`ALTER TABLE actions ADD COLUMN audio_queue_policy TEXT NOT NULL DEFAULT 'enqueue'`).run();
      logger.info('✅ Migración: Columna audio_queue_policy agregada a actions');
    } catch (err) {
      if (!err.message.includes('duplicate column')) {
        throw err;
      }
    }

    try {
      db.prepare(`ALTER TABLE actions ADD COLUMN wait_for_audio_finish INTEGER NOT NULL DEFAULT 0`).run();
      logger.info('✅ Migración: Columna wait_for_audio_finish agregada a actions');
    } catch (err) {
      if (!err.message.includes('duplicate column')) {
        throw err;
      }
    }

    try {
      db.prepare(`ALTER TABLE actions ADD COLUMN audio_max_plays INTEGER NOT NULL DEFAULT 5`).run();
      logger.info('✅ Migración: Columna audio_max_plays agregada a actions');
    } catch (err) {
      if (!err.message.includes('duplicate column')) {
        throw err;
      }
    }

    // Migración 6: Campos de audio para galería
    try {
      db.prepare(`ALTER TABLE gallery_actions ADD COLUMN audio_enabled INTEGER NOT NULL DEFAULT 0`).run();
      logger.info('✅ Migración: Columna audio_enabled agregada a gallery_actions');
    } catch (err) {
      if (!err.message.includes('duplicate column')) {
        throw err;
      }
    }

    try {
      db.prepare(`ALTER TABLE gallery_actions ADD COLUMN audio_asset TEXT NOT NULL DEFAULT ''`).run();
      logger.info('✅ Migración: Columna audio_asset agregada a gallery_actions');
    } catch (err) {
      if (!err.message.includes('duplicate column')) {
        throw err;
      }
    }

    try {
      db.prepare(`ALTER TABLE gallery_actions ADD COLUMN audio_volume INTEGER NOT NULL DEFAULT 70`).run();
      logger.info('✅ Migración: Columna audio_volume agregada a gallery_actions');
    } catch (err) {
      if (!err.message.includes('duplicate column')) {
        throw err;
      }
    }

    try {
      db.prepare(`ALTER TABLE gallery_actions ADD COLUMN audio_wait_for_finish INTEGER NOT NULL DEFAULT 0`).run();
      logger.info('✅ Migración: Columna audio_wait_for_finish agregada a gallery_actions');
    } catch (err) {
      if (!err.message.includes('duplicate column')) {
        throw err;
      }
    }

    try {
      db.prepare(`ALTER TABLE gallery_actions ADD COLUMN audio_replace_current INTEGER NOT NULL DEFAULT 0`).run();
      logger.info('✅ Migración: Columna audio_replace_current agregada a gallery_actions');
    } catch (err) {
      if (!err.message.includes('duplicate column')) {
        throw err;
      }
    }

    try {
      db.prepare(`ALTER TABLE gallery_actions ADD COLUMN audio_play_once_per_combo INTEGER NOT NULL DEFAULT 1`).run();
      logger.info('✅ Migración: Columna audio_play_once_per_combo agregada a gallery_actions');
    } catch (err) {
      if (!err.message.includes('duplicate column')) {
        throw err;
      }
    }

    migrateGalleryAudioAssets(db);

    logger.info('✅ Todas las migraciones completadas');
  } catch (err) {
    logger.error('❌ Error en migraciones:', err);
    throw err;
  }
}

module.exports = {
  runMigrations
};
