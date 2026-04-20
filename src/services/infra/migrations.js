// src/services/infra/migrations.js - Migraciones de base de datos
const logger = require('../../utils/logger');

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

    logger.info('✅ Todas las migraciones completadas');
  } catch (err) {
    logger.error('❌ Error en migraciones:', err);
    throw err;
  }
}

module.exports = {
  runMigrations
};
