// src/services/core/queue.js - Cola de comandos RCON con estado observable y eventos de actualización
const { EventEmitter } = require("events");
const rconService = require("../infra/rcon");
const logger = require("../../utils/logger");

const DEFAULT_USER_ID = 1;

class CommandQueue extends EventEmitter {
  constructor() {
    super();

    this.runtimes = new Map(); // userId -> { queue, isProcessing, currentGroup, lastGroupFinishedAt }
    this.GROUP_DELAY_MS = 5000;
    this.COMMAND_DELAY_MS = 100;
  }

    normalizeUserId(userId) {
    return Number.isInteger(Number(userId)) ? Number(userId) : DEFAULT_USER_ID;
  }

  ensureRuntime(userId = DEFAULT_USER_ID) {
    const uid = this.normalizeUserId(userId);

    if (!this.runtimes) {
      this.runtimes = new Map();
    }

    if (!this.runtimes.has(uid)) {
      this.runtimes.set(uid, {
        queue: [],
        isProcessing: false,
        currentGroup: null,
        lastGroupFinishedAt: null
      });
    }

    return this.runtimes.get(uid);
  }

  _emitUpdate(reason = "update", userId = DEFAULT_USER_ID) {
    const uid = this.normalizeUserId(userId);

    this.emit("update", {
      userId: uid,
      reason,
      ...this.getStatus(uid)
    });
  }

  getStatus(userId = DEFAULT_USER_ID) {
    const uid = this.normalizeUserId(userId);
    const runtime = this.ensureRuntime(uid);

    return {
      userId: uid,
      pendingGroups: runtime.queue.length,
      pendingList: runtime.queue.map((group, index) => ({
        position: index + 1,
        source: group.source,
        totalCommands: Array.isArray(group.commands) ? group.commands.length : 0,
        createdAt: group.createdAt || null
      })),
      isProcessing: runtime.isProcessing,
      currentGroup: runtime.currentGroup
        ? {
            source: runtime.currentGroup.source,
            totalCommands: runtime.currentGroup.commands.length,
            startedAt: runtime.currentGroup.startedAt || null
          }
        : null,
      lastGroupFinishedAt: runtime.lastGroupFinishedAt
    };
  }

  add(commands, source = "unknown", userId = DEFAULT_USER_ID) {
    if (!Array.isArray(commands) || commands.length === 0) return false;

    const uid = this.normalizeUserId(userId);
    const runtime = this.ensureRuntime(uid);

    runtime.queue.push({
      commands,
      source,
      createdAt: Date.now()
    });

    logger.info(
      `📋 Cola +1 grupo (${source}) → grupos pendientes: ${runtime.queue.length}`,
      { userId: uid }
    );

    this._emitUpdate("add", uid);
    this.processNext(uid);

    return true;
  }

  clear(userId = DEFAULT_USER_ID) {
    const uid = this.normalizeUserId(userId);
    const runtime = this.ensureRuntime(uid);

    const removed = runtime.queue.length;
    runtime.queue = [];

    logger.warn(
      `🧹 Cola limpiada manualmente (${removed} grupo(s) eliminados)`,
      { userId: uid }
    );

    this._emitUpdate("clear", uid);

    return {
      success: true,
      userId: uid,
      removed
    };
  }

  async processNext(userId = DEFAULT_USER_ID) {
    const uid = this.normalizeUserId(userId);
    const runtime = this.ensureRuntime(uid);

    if (runtime.isProcessing) return;

    if (runtime.queue.length === 0) {
      runtime.currentGroup = null;
      this._emitUpdate("empty", uid);
      logger.info("📭 Cola vacía", { userId: uid });
      return;
    }

    if (!rconService.isConnected(uid)) {
      logger.warn(
        `⚠️ RCON offline. Cola retenida con ${runtime.queue.length} grupo(s) pendiente(s).`,
        { userId: uid }
      );
      runtime.currentGroup = null;
      this._emitUpdate("paused-rcon-offline", uid);
      return;
    }

    runtime.isProcessing = true;
    this._emitUpdate("processing-start", uid);

    try {
      while (runtime.queue.length > 0) {
        if (!rconService.isConnected(uid)) {
          logger.warn(
            `⚠️ RCON se desconectó durante la cola. Quedan ${runtime.queue.length} grupo(s).`,
            { userId: uid }
          );
          runtime.currentGroup = null;
          this._emitUpdate("paused-mid-process", uid);
          break;
        }

        const next = runtime.queue.shift();
        const { commands, source } = next;

        runtime.currentGroup = {
          ...next,
          startedAt: Date.now()
        };
        this._emitUpdate("group-start", uid);

        if (runtime.lastGroupFinishedAt && this.GROUP_DELAY_MS > 0) {
          const elapsed = Date.now() - runtime.lastGroupFinishedAt;
          const remaining = this.GROUP_DELAY_MS - elapsed;

          if (remaining > 0) {
            logger.info(
              `⏳ Esperando ${remaining / 1000}s antes de grupo [${source}]...`,
              { userId: uid }
            );
            await new Promise((r) => setTimeout(r, remaining));
          }
        }

        logger.info(
          `🚀 Grupo cola [${source}] (${commands.length} cmds, grupos restantes: ${runtime.queue.length})`,
          { userId: uid }
        );

        for (let i = 0; i < commands.length; i++) {
          const cmd = commands[i];

          if (!rconService.isConnected(uid)) {
            logger.warn(
              `⚠️ RCON cayó durante grupo [${source}]. Reencolando comandos restantes.`,
              { userId: uid }
            );

            const remainingCommands = commands.slice(i);

            runtime.queue.unshift({
              commands: remainingCommands,
              source: `${source}-resume`,
              createdAt: Date.now()
            });

            runtime.currentGroup = null;
            this._emitUpdate("requeue-on-rcon-drop", uid);
            return;
          }

          logger.command(
            `🚀 Cola cmd [${source} ${i + 1}/${commands.length}]: ${cmd}`,
            { userId: uid }
          );

          try {
            await rconService.send(cmd, uid);
            logger.info(`✅ Cola OK [${source}]: ${cmd}`, { userId: uid });
          } catch (err) {
            logger.error(`❌ Cola FAIL [${source}]: ${cmd}`, err);
          }

          this._emitUpdate("command-sent", uid);

          if (i < commands.length - 1 && this.COMMAND_DELAY_MS > 0) {
            await new Promise((r) => setTimeout(r, this.COMMAND_DELAY_MS));
          }
        }

        runtime.lastGroupFinishedAt = Date.now();
        logger.info(`📦 Grupo completado [${source}]`, { userId: uid });
        runtime.currentGroup = null;
        this._emitUpdate("group-finished", uid);
      }
    } finally {
      runtime.isProcessing = false;
      runtime.currentGroup = null;
      this._emitUpdate(runtime.queue.length ? "idle-with-pending" : "idle-empty", uid);

      if (runtime.queue.length === 0) {
        logger.info("📭 Cola vacía", { userId: uid });
      }
    }
  }

  retry(userId = DEFAULT_USER_ID) {
    const uid = this.normalizeUserId(userId);

    logger.info("🔄 Revisión manual de cola solicitada", { userId: uid });
    this._emitUpdate("retry", uid);
    this.processNext(uid);
  }
}

module.exports = new CommandQueue();