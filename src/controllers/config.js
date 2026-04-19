// src/controllers/config.js - Controlador para manejar configuración por usuario
const storage = require('../services/infra/storage');
const logger = require('../utils/logger');

module.exports = {
  get(req, res) {
    try {
      const userId = req.user?.id;

      const raw = storage.loadRawConfig(userId);
      const effective = storage.loadEffectiveConfig(userId);

      return res.json({
        success: true,
        config: raw,
        effectiveConfig: effective
      });
    } catch (error) {
      logger.error('Error obteniendo configuración', error);
      return res.status(500).json({
        success: false,
        error: 'No se pudo obtener la configuración'
      });
    }
  },

  save(req, res) {
    try {
      const userId = req.user?.id;
      const config = req.body || {};

      const saved = storage.saveConfig(config, userId);
      const effective = storage.loadEffectiveConfig(userId);

      logger.info(`⚙️ Configuración actualizada para usuario #${userId}`);

      return res.json({
        success: true,
        message: 'Configuración guardada',
        config: saved,
        effectiveConfig: effective
      });
    } catch (error) {
      logger.error('Error guardando configuración', error);
      return res.status(500).json({
        success: false,
        error: 'No se pudo guardar la configuración'
      });
    }
  }
};