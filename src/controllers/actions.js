// src/controllers/actions.js - Controlador para manejar acciones por usuario autenticado
const fs = require('fs');
const path = require('path');
const storage = require('../services/infra/storage');
const logger = require('../utils/logger');
const actionsService = require('../services/core/actions');

const CACHE_DIR = path.join(process.cwd(), 'data', 'cache');

function isManagedAudioAsset(assetPath) {
  const value = String(assetPath || '').trim();
  return value.startsWith('/cache/audio_');
}

function cleanupOrphanAudioAsset(assetPath, allActions = []) {
  if (!isManagedAudioAsset(assetPath)) return;

  const stillReferenced = (Array.isArray(allActions) ? allActions : [])
    .some((action) => String(action?.audioAsset || '').trim() === String(assetPath || '').trim());

  if (stillReferenced) return;

  const baseName = path.basename(String(assetPath || '').replace(/^\/cache\//, ''));
  if (!baseName || baseName === '.' || baseName === '..') return;

  const abs = path.join(CACHE_DIR, baseName);
  if (!abs.startsWith(CACHE_DIR)) return;

  try {
    if (fs.existsSync(abs)) {
      fs.unlinkSync(abs);
    }
  } catch (err) {
    logger.warn(`No se pudo borrar audio huerfano ${baseName}: ${err?.message || err}`);
  }
}

function buildDefaultTestData(action = {}, options = {}) {
  const type = String(action.type || 'gift').toLowerCase();
  const trigger = String(action.trigger || '').trim();
  const now = Date.now();
  const comboMultiplier = Math.max(1, Number.parseInt(options.comboMultiplier, 10) || 1);

  const base = {
    username: 'test_user',
    nickname: 'Test User',
    comment: 'mensaje de prueba',
    giftname: trigger || 'Rose',
    repeatcount: 1,
    likecount: 1,
    diamondCount: 1,
    eventId: `manual-test-${now}`
  };

  if (type === 'comment') {
    base.comment = trigger || 'comentario de prueba';
  }

  if (type === 'like') {
    const triggerLikes = Number.parseInt(trigger, 10);
    const likesPerEvent = Number.isFinite(triggerLikes) && triggerLikes > 0 ? triggerLikes : 10;
    const likes = likesPerEvent * comboMultiplier;
    base.likecount = likes;
  }

  if (type === 'gift') {
    base.giftname = trigger || 'Rose';
    base.repeatcount = comboMultiplier;
    base.diamondCount = 1;
  }

  return base;
}

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

      const previousAsset = actions[index]?.audioAsset || '';
      actions[index] = {
        ...actions[index],
        ...(req.body || {})
      };

      const saved = storage.saveActions(actions, userId);
      cleanupOrphanAudioAsset(previousAsset, saved);

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
      cleanupOrphanAudioAsset(removed?.audioAsset || '', saved);

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
  },

  async test(req, res) {
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

      const action = actions[index] || {};
      const type = String(action.type || 'gift').toLowerCase();
      const isComboTest = !!req.body?.combo;
      const comboMultiplier = isComboTest ? 10 : 1;
      const comboEventCount = isComboTest && type === 'comment' ? 10 : 1;

      if (!action.command || !String(action.command).trim()) {
        return res.status(400).json({
          success: false,
          error: 'La acción no tiene comandos para probar'
        });
      }

      const payload = buildDefaultTestData(action, { comboMultiplier });
      payload.platform = 'tiktok';

      const estimatedBaseCommands = actionsService.splitCommands(
        actionsService.parseCommand(action.command, payload, userId)
      );

      if (!estimatedBaseCommands.length) {
        return res.status(400).json({
          success: false,
          error: 'No se pudieron generar comandos válidos para la prueba'
        });
      }

      let runtimeResult;

      if (comboEventCount > 1) {
        const testRuns = [];

        for (let iteration = 0; iteration < comboEventCount; iteration++) {
          testRuns.push(
            actionsService.handleEvent(type, {
              ...payload,
              eventId: `${payload.eventId}-${iteration + 1}`
            }, userId, {
              onlyActionIndex: index,
              source: `manual-test-${iteration + 1}`,
              actionName: action.name || action.trigger || type,
              parallel: true
            })
          );
        }

        const results = await Promise.all(testRuns);
        runtimeResult = results.reduce((acc, result) => {
          acc.executed += Number(result?.executed || 0);
          acc.queued += Number(result?.queued || 0);
          return acc;
        }, { executed: 0, queued: 0 });
      } else {
        runtimeResult = await actionsService.handleEvent(type, payload, userId, {
          onlyActionIndex: index,
          source: 'manual-test',
          actionName: action.name || action.trigger || type,
          parallel: true
        });
      }

      const estimatedMultiplier = type === 'gift' && action.repeatPerUnit
        ? Number.parseInt(payload.repeatcount, 10) || 1
        : isComboTest && type === 'comment'
          ? comboEventCount
        : 1;

      const estimatedCommands = estimatedBaseCommands.length * Math.max(1, estimatedMultiplier);

      logger.info(`▶️ Test manual de acción #${index} para usuario #${userId}`);

      return res.json({
        success: true,
        message: 'Prueba ejecutada',
        actionIndex: index,
        type,
        mode: isComboTest ? 'combo-x10' : 'single',
        comboMultiplier,
        executed: Number(runtimeResult?.executed || 0),
        queued: Number(runtimeResult?.queued || 0),
        estimatedCommands,
        payload
      });
    } catch (error) {
      logger.error('Error probando acción', error);
      return res.status(500).json({
        success: false,
        error: 'No se pudo ejecutar la prueba de la acción'
      });
    }
  }
};