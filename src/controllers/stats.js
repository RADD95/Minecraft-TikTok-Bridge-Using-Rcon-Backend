// src/controllers/stats.js - Controlador para manejar estadísticas por usuario autenticado
const statsService = require("../services/core/stats");
const logger = require("../utils/logger");

module.exports = {
  get(req, res) {
    try {
      const userId = req.user?.id;
      const stats = statsService.get(userId);

      return res.json({
        success: true,
        stats
      });
    } catch (error) {
      logger.error("Error obteniendo estadísticas", error);
      return res.status(500).json({
        success: false,
        error: "No se pudieron obtener las estadísticas"
      });
    }
  },

  reset(req, res) {
    try {
      const userId = req.user?.id;
      const stats = statsService.reset(userId);

      logger.info(`📊 Estadísticas reseteadas para usuario #${userId}`);

      return res.json({
        success: true,
        message: "Estadísticas reseteadas",
        stats
      });
    } catch (error) {
      logger.error("Error reseteando estadísticas", error);
      return res.status(500).json({
        success: false,
        error: "No se pudieron resetear las estadísticas"
      });
    }
  }
};