// src/controllers/admin-users.js
const authStore = require("../services/infra/auth-store");
const storage = require("../services/infra/storage");
const rconService = require("../services/infra/rcon");
const tiktokService = require("../services/platforms/tiktok");
const queue = require("../services/core/queue");

function hasOwn(obj, key) {
  return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
}

function toBoolean(value, fallback = false) {
  if (value === true || value === 1 || value === "1" || value === "true") {
    return true;
  }

  if (value === false || value === 0 || value === "0" || value === "false") {
    return false;
  }

  return fallback;
}

module.exports = {
  list(req, res) {
    try {
      return res.json({
        success: true,
        users: authStore.listUsersWithSettings()
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: err.message || "Error listando usuarios"
      });
    }
  },

  create(req, res) {
    try {
      const body = req.body || {};
      const role = String(body.role || "user").trim();

      if (!["admin", "user"].includes(role)) {
        return res.status(400).json({
          success: false,
          error: "Rol inválido"
        });
      }

      const created = authStore.createUser({
        username: body.username,
        password: body.password,
        role
      });

      const configPatch = {};

      if (hasOwn(body, "useGlobalRcon")) {
        configPatch.rcon = {
          useGlobal: toBoolean(body.useGlobalRcon, false)
        };
      }

      if (hasOwn(body, "useGlobalTikTok")) {
        configPatch.tiktok = {
          useGlobal: toBoolean(body.useGlobalTikTok, false)
        };
      }

      if (Object.keys(configPatch).length > 0) {
        storage.saveConfig(configPatch, created.id);
      }

      return res.status(201).json({
        success: true,
        user: authStore.findUserWithSettingsById(created.id)
      });
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: err.message || "Error creando usuario"
      });
    }
  },

  update(req, res) {
    try {
      const userId = Number(req.params.id);
      const body = req.body || {};

      const updated = authStore.updateUserAdmin(userId, {
        username: hasOwn(body, "username") ? body.username : undefined,
        role: hasOwn(body, "role") ? body.role : undefined,
        is_active: hasOwn(body, "isActive") ? toBoolean(body.isActive, true) : undefined,
        password: hasOwn(body, "password") ? body.password : undefined
      });

      const configPatch = {};

      if (hasOwn(body, "useGlobalRcon")) {
        configPatch.rcon = {
          useGlobal: toBoolean(body.useGlobalRcon, false)
        };
      }

      if (hasOwn(body, "useGlobalTikTok")) {
        configPatch.tiktok = {
          useGlobal: toBoolean(body.useGlobalTikTok, false)
        };
      }

      if (Object.keys(configPatch).length > 0) {
        storage.saveConfig(configPatch, userId);
      }

      return res.json({
        success: true,
        user: authStore.findUserWithSettingsById(updated.id)
      });
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: err.message || "Error actualizando usuario"
      });
    }
  },

  async remove(req, res) {
    try {
      const userId = Number(req.params.id);

      try {
        if (typeof queue.clear === "function") {
          queue.clear(userId);
        }
      } catch (_) {}

      try {
        if (typeof rconService.disconnect === "function") {
          await rconService.disconnect(userId);
        }
      } catch (_) {}

      try {
        if (typeof tiktokService.stop === "function") {
          await tiktokService.stop(userId);
        }
      } catch (_) {}

      authStore.deleteUser(userId);

      return res.json({
        success: true,
        deletedId: userId
      });
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: err.message || "Error borrando usuario"
      });
    }
  }
};