// src/controllers/tiktok.js - Controlador para manejar rutas relacionadas con TikTok LIVE por usuario autenticado
const tiktokService = require("../services/platforms/tiktok");
const storage = require("../services/infra/storage");
const logger = require("../utils/logger");

module.exports = {
  async start(req, res) {
    try {
      const userId = req.user?.id;
      const { username } = req.body || {};

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "Usuario no autenticado"
        });
      }

      if (!username || !String(username).trim()) {
        return res.status(400).json({
          success: false,
          error: "Username requerido"
        });
      }

      const cleanUsername = String(username).trim().replace(/^@/, "");
      const rawConfig = storage.loadRawConfig(userId) || {};

      if (!rawConfig.tiktok) {
        rawConfig.tiktok = {};
      }

      rawConfig.tiktok.username = cleanUsername;
      storage.saveConfig(rawConfig, userId);

      logger.info(`🎵 Iniciando conexión TikTok para usuario #${userId} → @${cleanUsername}`);

      const started = await tiktokService.start(cleanUsername, userId);

      const status = typeof tiktokService.getStatus === "function"
        ? tiktokService.getStatus(userId)
        : { connected: false, username: cleanUsername, connectedUserId: userId };

      return res.json({
        success: !!started,
        message: started
          ? `Conectado o conectando a ${cleanUsername}`
          : `Intentando conectar a ${cleanUsername}`,
        tiktok: {
          ...status,
          username: status.username || cleanUsername
        }
      });
    } catch (error) {
      logger.error(`Error iniciando TikTok LIVE para usuario #${req.user?.id}`, error);
      return res.status(500).json({
        success: false,
        error: "No se pudo iniciar TikTok LIVE"
      });
    }
  },

  async stop(req, res) {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "Usuario no autenticado"
        });
      }

      await tiktokService.stop(userId);
      logger.warn(`🛑 Conexión TikTok detenida manualmente por usuario #${userId}`);

      return res.json({
        success: true,
        message: "Detenido",
        tiktok: typeof tiktokService.getStatus === "function"
          ? tiktokService.getStatus(userId)
          : { connected: false, connectedUserId: userId }
      });
    } catch (error) {
      logger.error(`Error deteniendo TikTok LIVE para usuario #${req.user?.id}`, error);
      return res.status(500).json({
        success: false,
        error: "No se pudo detener TikTok LIVE"
      });
    }
  },

  getStatus(req, res) {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "Usuario no autenticado"
        });
      }

      const config = storage.loadEffectiveConfig(userId) || {};
      const serviceStatus = typeof tiktokService.getStatus === "function"
        ? tiktokService.getStatus(userId)
        : { connected: false, connectedUserId: userId };

      return res.json({
        success: true,
        tiktok: {
          ...serviceStatus,
          username: serviceStatus.username || config?.tiktok?.username || ""
        }
      });
    } catch (error) {
      logger.error(`Error obteniendo estado de TikTok para usuario #${req.user?.id}`, error);
      return res.status(500).json({
        success: false,
        error: "No se pudo obtener el estado de TikTok"
      });
    }
  }
};