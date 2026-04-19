// src/controllers/rcon.js - Controlador para manejar rutas relacionadas con la conexión RCON, envío de comandos y pruebas de conexión por usuario autenticado
const rconService = require("../services/infra/rcon");
const storage = require("../services/infra/storage");
const logger = require("../utils/logger");
const queue = require("../services/core/queue");
const actionsService = require("../services/core/actions");

module.exports = {
  async connect(req, res) {
    try {
      const userId = req.user?.id;
      const config = storage.loadEffectiveConfig(userId);

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "Usuario no autenticado",
          connected: false
        });
      }

      if (!config?.rcon?.host || !config?.rcon?.port || !config?.rcon?.password) {
        return res.status(400).json({
          success: false,
          error: "Falta configurar host, port o password de RCON",
          connected: false
        });
      }

      await rconService.connect(userId);

      logger.info(`🔌 RCON connect solicitado por usuario #${userId}`);

      return res.json({
        success: true,
        connected: rconService.isConnected(userId),
        rcon: typeof rconService.getStatus === "function"
          ? rconService.getStatus(userId)
          : { connected: true, userId }
      });
    } catch (error) {
      logger.error(`Error conectando RCON para usuario #${req.user?.id}`, error);
      return res.status(500).json({
        success: false,
        error: error.message,
        connected: false
      });
    }
  },

  async disconnect(req, res) {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "Usuario no autenticado",
          connected: false
        });
      }

      await rconService.disconnect(userId);
      logger.warn(`🛑 RCON desconectado manualmente por usuario #${userId}`);

      return res.json({
        success: true,
        connected: false,
        rcon: typeof rconService.getStatus === "function"
          ? rconService.getStatus(userId)
          : { connected: false, userId }
      });
    } catch (error) {
      logger.error(`Error desconectando RCON para usuario #${req.user?.id}`, error);
      return res.status(500).json({
        success: false,
        error: error.message,
        connected: !!rconService.isConnected(req.user?.id)
      });
    }
  },

  async test(req, res) {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Usuario no autenticado"
      });
    }

    if (!rconService.isConnected(userId)) {
      return res.status(400).json({
        success: false,
        error: "RCON no conectado"
      });
    }

    try {
      const response = await rconService.send("list", userId);

      return res.json({
        success: true,
        response
      });
    } catch (err) {
      logger.error(`Error probando RCON para usuario #${userId}`, err);
      return res.status(500).json({
        success: false,
        error: err.message
      });
    }
  },

  async command(req, res) {
    const userId = req.user?.id;
    const { command, useQueue = false } = req.body || {};

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Usuario no autenticado"
      });
    }

    if (!command || !String(command).trim()) {
      return res.status(400).json({
        success: false,
        error: "command requerido"
      });
    }

    if (!rconService.isConnected(userId)) {
      return res.status(400).json({
        success: false,
        error: "RCON no conectado"
      });
    }

    try {
      const fakeData = {
        username: "TestUser",
        nickname: "TestUser",
        giftname: "Rose",
        repeatcount: 1,
        likecount: 1,
        comment: "mensaje de prueba",
        diamondCount: 1,
        platform: "manual"
      };

      const parsed = actionsService.parseCommand(command, fakeData, userId);
      const commands = actionsService.splitCommands(parsed);

      if (!commands.length) {
        return res.status(400).json({
          success: false,
          error: "No se generaron comandos válidos"
        });
      }

      if (useQueue) {
        queue.add(commands, `manual-u${userId}`, userId);

        return res.json({
          success: true,
          queued: commands.length,
          totalPending: queue.getStatus
            ? queue.getStatus(userId).pendingGroups
            : 0
        });
      }

      let lastResponse = null;

      for (let i = 0; i < commands.length; i++) {
        const cmd = commands[i];
        logger.command(`🚀 Directo [${userId}]: ${cmd}`, { userId });
        lastResponse = await rconService.send(cmd, userId);

        if (i < commands.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      return res.json({
        success: true,
        executed: commands.length,
        response: lastResponse
      });
    } catch (err) {
      logger.error(`Error enviando comando RCON para usuario #${userId}`, err);
      return res.status(500).json({
        success: false,
        error: err.message
      });
    }
  }
};