// src/controllers/actions.js - Controlador para manejar acciones por usuario autenticado
const storage = require('../services/infra/storage');
const logger = require('../utils/logger');
const actionsService = require('../services/core/actions');
const queue = require('../services/core/queue');
const rconService = require('../services/infra/rcon');

function buildDefaultTestData(action = {}) {
  const type = String(action.type || 'gift').toLowerCase();
  const trigger = String(action.trigger || '').trim();
  const now = Date.now();

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
    const likes = Number.isFinite(triggerLikes) && triggerLikes > 0 ? triggerLikes : 10;
    base.likecount = likes;
  }

  if (type === 'gift') {
    base.giftname = trigger || 'Rose';
    base.repeatcount = 1;
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

      if (!action.command || !String(action.command).trim()) {
        return res.status(400).json({
          success: false,
          error: 'La acción no tiene comandos para probar'
        });
      }

      const payload = buildDefaultTestData(action);
      const parsedCommand = actionsService.parseCommand(action.command, payload, userId);
      let commands = actionsService.splitCommands(parsedCommand);

      if (!commands.length) {
        return res.status(400).json({
          success: false,
          error: 'No se pudieron generar comandos válidos para la prueba'
        });
      }

      if (type === 'gift' && action.repeatPerUnit) {
        const repeat = Number.parseInt(payload.repeatcount, 10) || 1;
        if (repeat > 1) {
          const expanded = [];
          for (let i = 0; i < repeat; i++) {
            expanded.push(...commands);
          }
          commands = expanded;
        }
      }

      const sourceName = action.name || `${type}-manual-test-${index}`;
      const shouldQueue = (action.useQueue ?? false) || !rconService.isConnected(userId);

      let executed = 0;
      let queued = 0;

      if (shouldQueue) {
        queue.add(commands, `${sourceName} [manual-test]`, userId);
        queued = 1;
      } else {
        for (let i = 0; i < commands.length; i++) {
          await rconService.send(commands[i], userId);
          executed++;

          if (i < commands.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }
      }

      logger.info(`▶️ Test manual de acción #${index} para usuario #${userId}`);

      return res.json({
        success: true,
        message: 'Prueba ejecutada',
        actionIndex: index,
        type,
        executed,
        queued,
        commands,
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