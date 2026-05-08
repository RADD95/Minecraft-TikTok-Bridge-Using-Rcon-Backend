// src/controllers/overlays.js
const { getDb } = require('../services/infra/db');
const { cleanupRemovedOverlayAssets, getOverlayImageAssetPaths, cleanupOrphanImageAsset } = require('../services/infra/cache-assets');
const storage = require('../services/infra/storage');
const logger = require('../utils/logger');

const db = getDb();

function normalizeId(raw) {
  return String(raw || '').trim();
}

function normalizeOverlayPayload(input = {}, forcedId = '') {
  const id = normalizeId(forcedId || input.id);

  return {
    id,
    name: String(input.name || 'Nuevo overlay'),
    canvas: input && typeof input.canvas === 'object' && input.canvas
      ? {
          width: parseInt(input.canvas.width, 10) || 1080,
          height: parseInt(input.canvas.height, 10) || 1920,
          background: String(input.canvas.background || 'transparent')
        }
      : {
          width: 1080,
          height: 1920,
          background: 'transparent'
        },
    elements: Array.isArray(input.elements) ? input.elements : [],
    groups: Array.isArray(input.groups) ? input.groups : [],
    preview: input.preview ? String(input.preview) : ''
  };
}

module.exports = {
  // GET /api/overlays
  list(req, res) {
    try {
      const userId = req.user?.id;
      const overlays = storage.loadOverlays(userId);

      return res.json(overlays);
    } catch (error) {
      logger.error('Error listando overlays', error);
      return res.status(500).json({
        success: false,
        error: 'No se pudieron cargar los overlays'
      });
    }
  },

  // GET /api/overlays/:id
  get(req, res) {
    try {
      const userId = req.user?.id;
      const id = normalizeId(req.params.id);
      const overlays = storage.loadOverlays(userId);
      const overlay = overlays.find(o => normalizeId(o.id) === id);

      if (!overlay) {
        return res.status(404).json({
          success: false,
          error: 'Overlay no encontrado'
        });
      }

      return res.json(overlay);
    } catch (error) {
      logger.error('Error obteniendo overlay', error);
      return res.status(500).json({
        success: false,
        error: 'No se pudo obtener el overlay'
      });
    }
  },

  // GET /api/public/overlays/:id
  getPublic(req, res) {
    try {
      const id = normalizeId(req.params.id);
      const overlay = storage.loadOverlayPublicById(id);

      if (!overlay) {
        return res.status(404).json({
          success: false,
          error: 'Overlay no encontrado'
        });
      }

      return res.json(overlay);
    } catch (error) {
      logger.error('Error obteniendo overlay público', error);
      return res.status(500).json({
        success: false,
        error: 'No se pudo obtener el overlay'
      });
    }
  },

  // POST /api/overlays
  // PUT /api/overlays/:id
  upsert(req, res) {
    try {
      const userId = req.user?.id;
      const payload = req.body || {};
      const id = normalizeId(payload.id || req.params.id);

      if (!id) {
        return res.status(400).json({
          success: false,
          error: 'ID del overlay requerido'
        });
      }

      const normalizedOverlay = normalizeOverlayPayload(payload, id);

      const overlays = storage.loadOverlays(userId);
      const idx = overlays.findIndex(o => normalizeId(o.id) === id);
      const previousOverlay = idx >= 0 ? overlays[idx] : null;

      if (idx >= 0) {
        overlays[idx] = {
          ...overlays[idx],
          ...normalizedOverlay
        };
      } else {
        overlays.push(normalizedOverlay);
      }

      storage.saveOverlays(overlays, userId);
      cleanupRemovedOverlayAssets(db, previousOverlay, normalizedOverlay);

      logger.info(`🖼️ Overlay guardado para usuario #${userId}: ${id}`);

      return res.json({
        success: true,
        overlay: normalizedOverlay
      });
    } catch (error) {
      logger.error('Error guardando overlay', error);
      return res.status(500).json({
        success: false,
        error: 'No se pudo guardar el overlay'
      });
    }
  },

  // DELETE /api/overlays/:id
  delete(req, res) {
    try {
      const userId = req.user?.id;
      const id = normalizeId(req.params.id);
      const overlays = storage.loadOverlays(userId);
      const idx = overlays.findIndex(o => normalizeId(o.id) === id);

      if (idx < 0) {
        return res.status(404).json({
          success: false,
          error: 'Overlay no encontrado'
        });
      }

      const removed = overlays[idx];
      overlays.splice(idx, 1);
      storage.saveOverlays(overlays, userId);

      for (const assetPath of getOverlayImageAssetPaths(removed)) {
        cleanupOrphanImageAsset(db, assetPath);
      }

      logger.info(`🗑️ Overlay eliminado para usuario #${userId}: ${id}`);

      return res.json({ success: true });
    } catch (error) {
      logger.error('Error eliminando overlay', error);
      return res.status(500).json({
        success: false,
        error: 'No se pudo eliminar el overlay'
      });
    }
  }
};