// src/controllers/actions.js - Controlador para manejar acciones por usuario autenticado
const storage = require('../services/infra/storage');
const logger = require('../utils/logger');

module.exports = {
  get(req, res) {
    try {
      const userId = req.user?.id;
      const actions = storage.loadActions(userId);

      return res.json({
        success: true,
        actions
      });
    } catch (error) {
      logger.error('Error obteniendo acciones', error);
      return res.status(500).json({
        success: false,
        error: 'No se pudieron cargar las acciones'
      });
    }
  },

  add(req, res) {
    try {
      const userId = req.user?.id;
      const actions = storage.loadActions(userId);
      actions.push(req.body || {});

      const saved = storage.saveActions(actions, userId);

      logger.info(`⚡ Acción agregada para usuario #${userId}`);

      return res.json({
        success: true,
        message: 'Acción agregada',
        actions: saved
      });
    } catch (error) {
      logger.error('Error agregando acción', error);
      return res.status(500).json({
        success: false,
        error: 'No se pudo agregar la acción'
      });
    }
  },

  update(req, res) {
    try {
      const userId = req.user?.id;
      const actions = storage.loadActions(userId);
      const index = Number.parseInt(req.params.index, 10);

      if (!Number.isInteger(index) || index < 0 || index >= actions.length) {
        return res.status(400).json({
          success: false,
          error: 'Índice inválido'
        });
      }

      actions[index] = {
        ...actions[index],
        ...(req.body || {})
      };

      const saved = storage.saveActions(actions, userId);

      logger.info(`✏️ Acción actualizada para usuario #${userId}, índice ${index}`);

      return res.json({
        success: true,
        message: 'Acción actualizada',
        actions: saved
      });
    } catch (error) {
      logger.error('Error actualizando acción', error);
      return res.status(500).json({
        success: false,
        error: 'No se pudo actualizar la acción'
      });
    }
  },

  delete(req, res) {
    try {
      const userId = req.user?.id;
      const actions = storage.loadActions(userId);
      const index = Number.parseInt(req.params.index, 10);

      if (!Number.isInteger(index) || index < 0 || index >= actions.length) {
        return res.status(400).json({
          success: false,
          error: 'Índice inválido'
        });
      }

      const removed = actions[index];
      actions.splice(index, 1);

      const saved = storage.saveActions(actions, userId);

      logger.info(`🗑️ Acción eliminada para usuario #${userId}, índice ${index}`);

      return res.json({
        success: true,
        message: 'Acción eliminada',
        removed,
        actions: saved
      });
    } catch (error) {
      logger.error('Error eliminando acción', error);
      return res.status(500).json({
        success: false,
        error: 'No se pudo eliminar la acción'
      });
    }
  }
};