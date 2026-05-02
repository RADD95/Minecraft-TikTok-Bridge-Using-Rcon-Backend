// src/services/infra/storage.js - Abstracción de almacenamiento para configuración, acciones, estadísticas y overlays.
const fs = require('fs');
const path = require('path');
const logger = require('../../utils/logger');
const { getDb } = require('./db');

const LEGACY_FILES = {
  config: path.join(process.cwd(), 'config.json'),
  actions: path.join(process.cwd(), 'actions.json'),
  stats: path.join(process.cwd(), 'stats.json'),
  overlays: path.join(process.cwd(), 'overlays.json')
};

const DEFAULT_USER_ID = 1;

class Storage {
  constructor() {
    this.db = getDb();
    this._ensureDefaultUser();
    this._ensureUserBaseData(DEFAULT_USER_ID);
    this._runLegacyMigrationOnce(DEFAULT_USER_ID);
  }

  _normalizeAudioMode(value) {
    const allowed = new Set(['once_per_event', 'per_unit', 'once_after_combo']);
    const normalized = String(value || '').trim();
    return allowed.has(normalized) ? normalized : 'once_per_event';
  }

  _normalizeAudioQueuePolicy(value) {
    const allowed = new Set(['enqueue', 'replace_current', 'drop_if_busy']);
    const normalized = String(value || '').trim();
    return allowed.has(normalized) ? normalized : 'enqueue';
  }

  _normalizeAudioVolume(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return 70;
    return Math.max(0, Math.min(100, parsed));
  }

  _normalizeAudioMaxPlays(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return 5;
    return Math.max(1, Math.min(50, parsed));
  }

  _ensureDefaultUser() {
    const existing = this.db.prepare(`SELECT id FROM users WHERE id = ?`).get(DEFAULT_USER_ID);
    if (existing) return;

    this.db.prepare(`
      INSERT INTO users (id, username, password_hash, role, is_active)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      DEFAULT_USER_ID,
      'admin',
      'TEMP_HASH_REEMPLAZAR',
      'admin',
      1
    );
  }

  _ensureUserBaseData(userId) {
    const settings = this.db.prepare(`
      SELECT id FROM user_settings WHERE user_id = ?
    `).get(userId);

      if (!settings) {
        this.db.prepare(`
          INSERT INTO user_settings (
            user_id,
            rcon_host,
            rcon_port,
            rcon_password,
            minecraft_playername,
            tiktok_username,
            use_global_rcon,
            use_global_tiktok
          ) VALUES (?, '', 25575, '', '@a', '', 0, 0)
        `).run(userId);
      }

    const stats = this.db.prepare(`
      SELECT id FROM stats WHERE user_id = ?
    `).get(userId);

    if (!stats) {
      this.db.prepare(`
        INSERT INTO stats (
          user_id,
          total_likes,
          total_comments,
          total_follows,
          total_gifts,
          diamonds_total,
          users_json,
          gift_types_json
        ) VALUES (?, 0, 0, 0, 0, 0, '{}', '{}')
      `).run(userId);
    }
  }

  _readLegacyJson(file, defaultValue) {
    try {
      if (!fs.existsSync(file)) return defaultValue;
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      logger.error(`Error leyendo legacy ${file}:`, err);
      return defaultValue;
    }
  }

  _runLegacyMigrationOnce(userId) {
    try {
      const hasActions = this.db.prepare(`SELECT COUNT(*) as count FROM actions WHERE user_id = ?`).get(userId).count;
      const hasOverlays = this.db.prepare(`SELECT COUNT(*) as count FROM overlays WHERE user_id = ?`).get(userId).count;

      const settings = this.db.prepare(`
        SELECT * FROM user_settings WHERE user_id = ?
      `).get(userId);

      const stats = this.db.prepare(`
        SELECT * FROM stats WHERE user_id = ?
      `).get(userId);

      const shouldImportConfig =
        settings &&
        !settings.rcon_host &&
        !settings.rcon_password &&
        (settings.minecraft_playername || '@a') === '@a' &&
        !settings.tiktok_username;

      const shouldImportStats =
        stats &&
        stats.total_likes === 0 &&
        stats.total_comments === 0 &&
        stats.total_follows === 0 &&
        stats.total_gifts === 0 &&
        stats.diamonds_total === 0 &&
        stats.users_json === '{}' &&
        stats.gift_types_json === '{}';

      if (shouldImportConfig) {
        const legacyConfig = this._readLegacyJson(LEGACY_FILES.config, null);
        if (legacyConfig) {
          this.saveConfig(legacyConfig, userId);
        }
      }

      if (hasActions === 0) {
        const legacyActions = this._readLegacyJson(LEGACY_FILES.actions, []);
        if (Array.isArray(legacyActions) && legacyActions.length > 0) {
          this.saveActions(legacyActions, userId);
        }
      }

      if (shouldImportStats) {
        const legacyStats = this._readLegacyJson(LEGACY_FILES.stats, null);
        if (legacyStats) {
          this.saveStats(legacyStats, userId);
        }
      }

      if (hasOverlays === 0) {
        const legacyOverlays = this._readLegacyJson(LEGACY_FILES.overlays, []);
        if (Array.isArray(legacyOverlays) && legacyOverlays.length > 0) {
          this.saveOverlays(legacyOverlays, userId);
        }
      }
    } catch (err) {
      logger.error('Error en migración legacy inicial:', err);
    }
  }

  _normalizeUserId(userId) {
    return Number.isInteger(Number(userId)) ? Number(userId) : DEFAULT_USER_ID;
  }

  loadRawConfig(userId = DEFAULT_USER_ID) {
    const uid = this._normalizeUserId(userId);
    this._ensureUserBaseData(uid);

    const row = this.db.prepare(`
      SELECT *
      FROM user_settings
      WHERE user_id = ?
    `).get(uid);

    return {
      rcon: {
        host: row?.rcon_host || '',
        port: row?.rcon_port || 25575,
        password: row?.rcon_password || '',
        useGlobal: row?.use_global_rcon !== 0
      },
      minecraft: {
        playername: row?.minecraft_playername || '@a'
      },
      tiktok: {
        username: row?.tiktok_username || '',
        useGlobal: row?.use_global_tiktok !== 0
      }
    };
  }

  loadEffectiveConfig(userId = DEFAULT_USER_ID) {
    const uid = this._normalizeUserId(userId);
    this._ensureUserBaseData(uid);

    const own = this.loadRawConfig(uid);
    const admin = uid === DEFAULT_USER_ID ? own : this.loadRawConfig(DEFAULT_USER_ID);

    return {
      rcon: {
        host: own.rcon.useGlobal ? admin.rcon.host : own.rcon.host,
        port: own.rcon.useGlobal ? admin.rcon.port : own.rcon.port,
        password: own.rcon.useGlobal ? admin.rcon.password : own.rcon.password,
        useGlobal: own.rcon.useGlobal
      },
      minecraft: {
        playername: own.minecraft.playername || '@a'
      },
      tiktok: {
        username: own.tiktok.useGlobal ? admin.tiktok.username : own.tiktok.username,
        useGlobal: own.tiktok.useGlobal
      }
    };
  }

  loadConfig(userId = DEFAULT_USER_ID) {
    return this.loadEffectiveConfig(userId);
  }

  saveConfig(config, userId = DEFAULT_USER_ID) {
    const uid = this._normalizeUserId(userId);
    this._ensureUserBaseData(uid);

    const previous = this.loadRawConfig(uid);
    const effective = this.loadEffectiveConfig(uid);

    const hasOwn = (obj, key) =>
      !!obj && Object.prototype.hasOwnProperty.call(obj, key);

    const incomingRcon = config?.rcon || {};
    const incomingMinecraft = config?.minecraft || {};
    const incomingTikTok = config?.tiktok || {};

    const explicitRconUseGlobal =
      typeof incomingRcon.useGlobal === 'boolean'
        ? incomingRcon.useGlobal
        : undefined;

    const explicitTikTokUseGlobal =
      typeof incomingTikTok.useGlobal === 'boolean'
        ? incomingTikTok.useGlobal
        : undefined;

    const shouldBreakRconGlobal =
      uid !== DEFAULT_USER_ID &&
      previous.rcon.useGlobal === true &&
      explicitRconUseGlobal === undefined &&
      (
        (hasOwn(incomingRcon, 'host') &&
          String(incomingRcon.host || '') !== String(effective.rcon.host || '')) ||
        (hasOwn(incomingRcon, 'port') &&
          (parseInt(incomingRcon.port, 10) || 25575) !== Number(effective.rcon.port || 25575)) ||
        (hasOwn(incomingRcon, 'password') &&
          String(incomingRcon.password || '') !== String(effective.rcon.password || ''))
      );

    const shouldBreakTikTokGlobal =
      uid !== DEFAULT_USER_ID &&
      previous.tiktok.useGlobal === true &&
      explicitTikTokUseGlobal === undefined &&
      hasOwn(incomingTikTok, 'username') &&
      String(incomingTikTok.username || '') !== String(effective.tiktok.username || '');

    const finalRconUseGlobal =
      explicitRconUseGlobal !== undefined
        ? explicitRconUseGlobal
        : shouldBreakRconGlobal
          ? false
          : previous.rcon.useGlobal;

    const finalTikTokUseGlobal =
      explicitTikTokUseGlobal !== undefined
        ? explicitTikTokUseGlobal
        : shouldBreakTikTokGlobal
          ? false
          : previous.tiktok.useGlobal;

    const normalized = {
      rcon: {
        host: finalRconUseGlobal
          ? previous.rcon.host
          : hasOwn(incomingRcon, 'host')
            ? String(incomingRcon.host || '')
            : previous.rcon.host,
        port: finalRconUseGlobal
          ? previous.rcon.port
          : hasOwn(incomingRcon, 'port')
            ? parseInt(incomingRcon.port, 10) || 25575
            : previous.rcon.port,
        password: finalRconUseGlobal
          ? previous.rcon.password
          : hasOwn(incomingRcon, 'password')
            ? String(incomingRcon.password || '')
            : previous.rcon.password,
        useGlobal: finalRconUseGlobal
      },
      minecraft: {
        playername: hasOwn(incomingMinecraft, 'playername')
          ? String(incomingMinecraft.playername || '@a')
          : previous.minecraft.playername || '@a'
      },
      tiktok: {
        username: finalTikTokUseGlobal
          ? previous.tiktok.username
          : hasOwn(incomingTikTok, 'username')
            ? String(incomingTikTok.username || '')
            : previous.tiktok.username,
        useGlobal: finalTikTokUseGlobal
      }
    };

    this.db.prepare(`
      UPDATE user_settings
      SET
        rcon_host = ?,
        rcon_port = ?,
        rcon_password = ?,
        minecraft_playername = ?,
        tiktok_username = ?,
        use_global_rcon = ?,
        use_global_tiktok = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `).run(
      normalized.rcon.host,
      normalized.rcon.port,
      normalized.rcon.password,
      normalized.minecraft.playername,
      normalized.tiktok.username,
      normalized.rcon.useGlobal ? 1 : 0,
      normalized.tiktok.useGlobal ? 1 : 0,
      uid
    );

    return this.loadRawConfig(uid);
  }

  loadActions(userId = DEFAULT_USER_ID) {
    const uid = this._normalizeUserId(userId);

    return this.db.prepare(`
      SELECT
        id,
        name,
        type,
        trigger,
        command,
        use_queue,
        repeat_per_unit,
        audio_enabled,
        audio_asset,
        audio_volume,
        audio_wait_for_finish,
        audio_replace_current,
        audio_play_once_per_combo,
        enabled,
        minecraft_version,
        folder,
        created_at,
        updated_at
      FROM actions
      WHERE user_id = ?
      ORDER BY id ASC
    `).all(uid).map(row => ({
      id: row.id,
      name: row.name || '',
      type: row.type,
      trigger: row.trigger || '',
      command: row.command || '',
      useQueue: !!row.use_queue,
      repeatPerUnit: !!row.repeat_per_unit,
      audioEnabled: !!row.audio_enabled,
      audioAsset: row.audio_asset || '',
      audioVolume: row.audio_volume || 70,
      audioWaitForFinish: !!row.audio_wait_for_finish,
      audioReplaceCurrent: !!row.audio_replace_current,
      audioPlayOncePerCombo: row.audio_play_once_per_combo !== 0,
      enabled: row.enabled !== 0,
      minecraftVersion: row.minecraft_version || '',
      folder: row.folder || '',
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  saveActions(actions, userId = DEFAULT_USER_ID) {
    const uid = this._normalizeUserId(userId);

    const insert = this.db.prepare(`
      INSERT INTO actions (
        user_id,
        name,
        type,
        trigger,
        command,
        use_queue,
        repeat_per_unit,
        audio_enabled,
        audio_asset,
        audio_volume,
        audio_wait_for_finish,
        audio_replace_current,
        audio_play_once_per_combo,
        enabled,
        minecraft_version,
        folder
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const replaceAll = this.db.transaction((items) => {
      this.db.prepare(`DELETE FROM actions WHERE user_id = ?`).run(uid);

      for (const action of items) {
        insert.run(
          uid,
          action?.name || '',
          action?.type || 'gift',
          action?.trigger || '',
          action?.command || '',
          action?.useQueue ? 1 : 0,
          action?.repeatPerUnit ? 1 : 0,
          action?.audioEnabled ? 1 : 0,
          action?.audioAsset || '',
          Math.max(0, Math.min(100, Number.parseInt(action?.audioVolume, 10) || 70)),
          action?.audioWaitForFinish ? 1 : 0,
          action?.audioReplaceCurrent ? 1 : 0,
          action?.audioPlayOncePerCombo === false ? 0 : 1,
          action?.enabled === false ? 0 : 1,
          action?.minecraftVersion || '',
          action?.folder || ''
        );
      }
    });

    replaceAll(Array.isArray(actions) ? actions : []);
    return this.loadActions(uid);
  }

  loadStats(userId = DEFAULT_USER_ID) {
    const uid = this._normalizeUserId(userId);
    this._ensureUserBaseData(uid);

    const row = this.db.prepare(`
      SELECT *
      FROM stats
      WHERE user_id = ?
    `).get(uid);

    return {
      totalLikes: row?.total_likes || 0,
      totalComments: row?.total_comments || 0,
      totalFollows: row?.total_follows || 0,
      totalGifts: row?.total_gifts || 0,
      diamondsTotal: row?.diamonds_total || 0,
      totalDiamonds: row?.diamonds_total || 0,
      users: this._safeJsonParse(row?.users_json, {}),
      giftTypes: this._safeJsonParse(row?.gift_types_json, {})
    };
  }

  saveStats(stats, userId = DEFAULT_USER_ID) {
    const uid = this._normalizeUserId(userId);
    this._ensureUserBaseData(uid);

    const normalized = {
      totalLikes: parseInt(stats?.totalLikes, 10) || 0,
      totalComments: parseInt(stats?.totalComments, 10) || 0,
      totalFollows: parseInt(stats?.totalFollows, 10) || 0,
      totalGifts: parseInt(stats?.totalGifts, 10) || 0,
      diamondsTotal: parseInt(stats?.diamondsTotal ?? stats?.totalDiamonds, 10) || 0,
      users: stats?.users || {},
      giftTypes: stats?.giftTypes || {}
    };

    this.db.prepare(`
      UPDATE stats
      SET
        total_likes = ?,
        total_comments = ?,
        total_follows = ?,
        total_gifts = ?,
        diamonds_total = ?,
        users_json = ?,
        gift_types_json = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `).run(
      normalized.totalLikes,
      normalized.totalComments,
      normalized.totalFollows,
      normalized.totalGifts,
      normalized.diamondsTotal,
      JSON.stringify(normalized.users || {}),
      JSON.stringify(normalized.giftTypes || {}),
      uid
    );

    return {
      ...normalized,
      totalDiamonds: normalized.diamondsTotal
    };
  }

  loadOverlays(userId = DEFAULT_USER_ID) {
    const uid = this._normalizeUserId(userId);

    return this.db.prepare(`
      SELECT *
      FROM overlays
      WHERE user_id = ?
      ORDER BY created_at ASC
    `).all(uid).map(row => ({
      id: row.id,
      name: row.name || 'Nuevo overlay',
      canvas: this._safeJsonParse(row.canvas_json, {
        width: 1080,
        height: 1920,
        background: 'transparent'
      }),
      elements: this._safeJsonParse(row.elements_json, []),
      groups: this._safeJsonParse(row.groups_json, []),
      preview: row.preview || ''
    }));
  }

  loadOverlayPublicById(overlayId) {
    const id = String(overlayId || '').trim();
    if (!id) return null;

    const row = this.db.prepare(`
      SELECT *
      FROM overlays
      WHERE id = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(id);

    if (!row) return null;

    return {
      id: row.id,
      name: row.name || 'Nuevo overlay',
      canvas: this._safeJsonParse(row.canvas_json, {
        width: 1080,
        height: 1920,
        background: 'transparent'
      }),
      elements: this._safeJsonParse(row.elements_json, []),
      groups: this._safeJsonParse(row.groups_json, []),
      preview: row.preview || ''
    };
  }

  saveOverlays(overlays, userId = DEFAULT_USER_ID) {
    const uid = this._normalizeUserId(userId);

    const insert = this.db.prepare(`
      INSERT INTO overlays (
        id,
        user_id,
        name,
        canvas_json,
        elements_json,
        groups_json,
        preview,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);

    const replaceAll = this.db.transaction((items) => {
      this.db.prepare(`DELETE FROM overlays WHERE user_id = ?`).run(uid);

      for (const overlay of items) {
        insert.run(
          overlay?.id,
          uid,
          overlay?.name || 'Nuevo overlay',
          JSON.stringify(overlay?.canvas || {
            width: 1080,
            height: 1920,
            background: 'transparent'
          }),
          JSON.stringify(Array.isArray(overlay?.elements) ? overlay.elements : []),
          JSON.stringify(Array.isArray(overlay?.groups) ? overlay.groups : []),
          overlay?.preview ? String(overlay.preview) : ''
        );
      }
    });

    replaceAll(Array.isArray(overlays) ? overlays : []);
    return this.loadOverlays(uid);
  }

  loadFolders(userId = DEFAULT_USER_ID) {
    const uid = this._normalizeUserId(userId);

    return this.db.prepare(`
      SELECT id, name, enabled, created_at, updated_at
      FROM action_folders
      WHERE user_id = ?
      ORDER BY datetime(created_at) ASC, id ASC
    `).all(uid).map(row => ({
      id: row.id,
      name: row.name,
      enabled: row.enabled !== 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  createFolder(folderName, userId = DEFAULT_USER_ID) {
    const uid = this._normalizeUserId(userId);

    try {
      this.db.prepare(`
        INSERT INTO action_folders (user_id, name, enabled, created_at, updated_at)
        VALUES (?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(uid, folderName);

      const inserted = this.db.prepare(`
        SELECT id, name, enabled, created_at, updated_at
        FROM action_folders
        WHERE user_id = ? AND name = ?
      `).get(uid, folderName);

      return {
        success: true,
        folder: {
          id: inserted.id,
          name: inserted.name,
          enabled: inserted.enabled !== 0,
          createdAt: inserted.created_at,
          updatedAt: inserted.updated_at
        }
      };
    } catch (err) {
      if (err.message.includes('UNIQUE constraint failed')) {
        return {
          success: false,
          error: 'La carpeta ya existe'
        };
      }
      throw err;
    }
  }

  toggleFolder(folderId, enabled, userId = DEFAULT_USER_ID) {
    const uid = this._normalizeUserId(userId);

    this.db.prepare(`
      UPDATE action_folders
      SET enabled = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `).run(enabled ? 1 : 0, folderId, uid);

    const updated = this.db.prepare(`
      SELECT id, name, enabled, created_at, updated_at
      FROM action_folders
      WHERE id = ? AND user_id = ?
    `).get(folderId, uid);

    return updated ? {
      id: updated.id,
      name: updated.name,
      enabled: updated.enabled !== 0,
      createdAt: updated.created_at,
      updatedAt: updated.updated_at
    } : null;
  }

  renameFolder(folderId, newName, userId = DEFAULT_USER_ID) {
    const uid = this._normalizeUserId(userId);
    const trimmedName = String(newName || '').trim();

    if (!trimmedName) {
      return {
        success: false,
        error: 'El nombre de la carpeta es requerido'
      };
    }

    const existing = this.db.prepare(`
      SELECT id, name
      FROM action_folders
      WHERE id = ? AND user_id = ?
    `).get(folderId, uid);

    if (!existing) {
      return {
        success: false,
        error: 'Carpeta no encontrada'
      };
    }

    try {
      this.db.prepare(`
        UPDATE action_folders
        SET name = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?
      `).run(trimmedName, folderId, uid);

      this.db.prepare(`
        UPDATE actions
        SET folder = ?, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND folder = ?
      `).run(trimmedName, uid, existing.name);

      const updated = this.db.prepare(`
        SELECT id, name, enabled, created_at, updated_at
        FROM action_folders
        WHERE id = ? AND user_id = ?
      `).get(folderId, uid);

      return {
        success: true,
        folder: {
          id: updated.id,
          name: updated.name,
          enabled: updated.enabled !== 0,
          createdAt: updated.created_at,
          updatedAt: updated.updated_at
        }
      };
    } catch (err) {
      if (err.message.includes('UNIQUE constraint failed')) {
        return {
          success: false,
          error: 'La carpeta ya existe'
        };
      }
      throw err;
    }
  }

  deleteFolder(folderId, userId = DEFAULT_USER_ID) {
    const uid = this._normalizeUserId(userId);

    // Remover la carpeta de las acciones antes de eliminarla
    this.db.prepare(`
      UPDATE actions
      SET folder = '', updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND folder IN (
        SELECT name FROM action_folders WHERE id = ? AND user_id = ?
      )
    `).run(uid, folderId, uid);

    this.db.prepare(`
      DELETE FROM action_folders
      WHERE id = ? AND user_id = ?
    `).run(folderId, uid);
  }

  _safeJsonParse(value, fallback) {
    try {
      return value ? JSON.parse(value) : fallback;
    } catch (err) {
      return fallback;
    }
  }
}

module.exports = new Storage();