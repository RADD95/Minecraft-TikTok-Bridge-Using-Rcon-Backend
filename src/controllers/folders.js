// src/controllers/folders.js - Controlador para manejar carpetas de acciones
const storage = require('../services/infra/storage');
const logger = require('../utils/logger');

module.exports = {
  // Obtener todas las carpetas del usuario
  list(req, res) {
    try {
      const userId = req.user?.id;
      const folders = storage.loadFolders(userId);

      return res.json({
        success: true,
        folders
      });
    } catch (error) {
      logger.error('Error obteniendo carpetas', error);
      return res.status(500).json({
        success: false,
        error: 'No se pudieron cargar las carpetas'
      });
    }
  },

  // Crear una nueva carpeta
  create(req, res) {
    try {
      const userId = req.user?.id;
      const { name } = req.body || {};

      if (!name || String(name).trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: 'El nombre de la carpeta es requerido'
        });
      }

      const result = storage.createFolder(String(name).trim(), userId);

      if (!result.success) {
        return res.status(400).json(result);
      }

      logger.info(`📁 Carpeta "${name}" creada para usuario #${userId}`);

      return res.json(result);
    } catch (error) {
      logger.error('Error creando carpeta', error);
      return res.status(500).json({
        success: false,
        error: 'No se pudo crear la carpeta'
      });
    }
  },

  // Alternar habilitación de carpeta
  toggle(req, res) {
    try {
      const userId = req.user?.id;
      const { id } = req.params || {};
      const { enabled } = req.body || {};

      if (!id) {
        return res.status(400).json({
          success: false,
          error: 'El ID de la carpeta es requerido'
        });
      }

      const folder = storage.toggleFolder(Number(id), enabled, userId);

      if (!folder) {
        return res.status(404).json({
          success: false,
          error: 'Carpeta no encontrada'
        });
      }

      logger.info(`📁 Carpeta #${id} ${enabled ? 'habilitada' : 'deshabilitada'} para usuario #${userId}`);

      return res.json({
        success: true,
        folder
      });
    } catch (error) {
      logger.error('Error alternando carpeta', error);
      return res.status(500).json({
        success: false,
        error: 'No se pudo alternar la carpeta'
      });
    }
  },

  // Renombrar carpeta
  rename(req, res) {
    try {
      const userId = req.user?.id;
      const { id } = req.params || {};
      const { name } = req.body || {};

      if (!id) {
        return res.status(400).json({
          success: false,
          error: 'El ID de la carpeta es requerido'
        });
      }

      if (!name || String(name).trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: 'El nombre de la carpeta es requerido'
        });
      }

      const result = storage.renameFolder(Number(id), String(name).trim(), userId);

      if (!result.success) {
        const status = result.error === 'Carpeta no encontrada' ? 404 : 400;
        return res.status(status).json(result);
      }

      logger.info(`✏️ Carpeta #${id} renombrada a "${result.folder.name}" para usuario #${userId}`);

      return res.json(result);
    } catch (error) {
      logger.error('Error renombrando carpeta', error);
      return res.status(500).json({
        success: false,
        error: 'No se pudo renombrar la carpeta'
      });
    }
  },

  // Eliminar una carpeta
  delete(req, res) {
    try {
      const userId = req.user?.id;
      const { id } = req.params || {};

      if (!id) {
        return res.status(400).json({
          success: false,
          error: 'El ID de la carpeta es requerido'
        });
      }

      storage.deleteFolder(Number(id), userId);

      logger.info(`🗑️ Carpeta #${id} eliminada para usuario #${userId}`);

      return res.json({
        success: true,
        message: 'Carpeta eliminada'
      });
    } catch (error) {
      logger.error('Error eliminando carpeta', error);
      return res.status(500).json({
        success: false,
        error: 'No se pudo eliminar la carpeta'
      });
    }
  }
};
