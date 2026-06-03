// src/services/core/actions.js - Lógica principal para manejar eventos de TikTok, parsear comandos y decidir ejecución directa o en cola por usuario
const storage = require("../infra/storage");
const statsService = require("./stats");
const rconService = require("../infra/rcon");
const logger = require("../../utils/logger");
const queue = require("./queue");
const audioService = require("./audio");

const DEFAULT_USER_ID = 1;

class ActionsService {
  constructor() {
    this.userEventChains = new Map();
    this.activeExecutions = new Map();
  }

  normalizeUserId(userId) {
    return Number.isInteger(Number(userId)) ? Number(userId) : DEFAULT_USER_ID;
  }

  logForUser(type, message, userId) {
    const uid = this.normalizeUserId(userId);

    if (typeof logger.push === "function") {
      return logger.push(type, message, { userId: uid });
    }

    if (type === "error" && typeof logger.error === "function") {
      return logger.error(message, { userId: uid });
    }

    if (type === "command" && typeof logger.command === "function") {
      return logger.command(message, { userId: uid });
    }

    if (typeof logger.info === "function") {
      return logger.info(message, { userId: uid });
    }
  }

  parseCommand(template, data, userId = DEFAULT_USER_ID) {
    const uid = this.normalizeUserId(userId);
    const config = storage.loadEffectiveConfig(uid);
    const stats = statsService.get(uid);

    const username = data.username || "";
    const userStats = stats.users?.[username] || {
      likes: 0,
      comments: 0,
      gifts: 0,
      follows: 0
    };

    const escapeQuotes = (str) => String(str || "").replace(/"/g, '\\"');
    const totalDiamonds = (stats.totalDiamonds ?? stats.diamondsTotal) || 0;

    return String(template || "")
      .replace(/{{username}}/g, escapeQuotes(username).replace(/@/g, "＠"))
      .replace(/{{giftname}}/g, escapeQuotes(data.giftname))
      .replace(/{{repeatcount}}/g, String(data.repeatcount || "1"))
      .replace(/{{likecount}}/g, String(data.likecount || "1"))
      .replace(/{{comment}}/g, escapeQuotes(data.comment))
      .replace(/{{nickname}}/g, escapeQuotes(data.nickname).replace(/@/g, "＠"))
      .replace(/{{playername}}/g, config.minecraft?.playername || "@a")
      .replace(/{{diamondcount}}/g, String(data.diamondCount || "0"))
      .replace(/{{totallikes}}/g, String(stats.totalLikes || 0))
      .replace(/{{totalcomments}}/g, String(stats.totalComments || 0))
      .replace(/{{totalfollows}}/g, String(stats.totalFollows || 0))
      .replace(/{{totalgifts}}/g, String(stats.totalGifts || 0))
      .replace(/{{totaldiamonds}}/g, String(totalDiamonds))
      .replace(/{{userlikes}}/g, String(userStats.likes || 0))
      .replace(/{{usercomments}}/g, String(userStats.comments || 0))
      .replace(/{{usergifts}}/g, String(userStats.gifts || 0))
      .replace(/{{userfollows}}/g, String(userStats.follows || 0));
  }

  splitCommands(input) {
    const s = String(input ?? "").trim();
    if (!s) return [];

    const out = [];
    let buf = "";
    let depth = 0;
    let inS = false;
    let inD = false;
    let esc = false;
    let inComment = false;

    for (let i = 0; i < s.length; i++) {
      const ch = s[i];

      if (esc) {
        buf += ch;
        esc = false;
        continue;
      }

      if ((inS || inD) && ch === "\\") {
        buf += ch;
        esc = true;
        continue;
      }

      if (!inD && ch === "'") {
        inS = !inS;
        buf += ch;
        continue;
      }

      if (!inS && ch === '"') {
        inD = !inD;
        buf += ch;
        continue;
      }

      if (!inS && !inD && !inComment && ch === "/" && i + 1 < s.length && s[i + 1] === "/") {
        inComment = true;
        i++;
        continue;
      }

      if (inComment && (ch === "\n" || ch === "\r")) {
        inComment = false;
        const t = buf.trim();
        if (t) out.push(t);
        buf = "";

        if (ch === "\r" && i + 1 < s.length && s[i + 1] === "\n") i++;
        continue;
      }

      if (inComment) continue;

      if (!inS && !inD) {
        if (ch === "{" || ch === "[") depth++;
        else if (ch === "}" || ch === "]") depth = Math.max(0, depth - 1);

        if (depth === 0 && (ch === ";" || ch === "\n" || ch === "\r")) {
          const t = buf.trim();
          if (t) out.push(t);
          buf = "";

          if (ch === "\r" && i + 1 < s.length && s[i + 1] === "\n") i++;
          continue;
        }
      }

      buf += ch;
    }

    const last = buf.trim();
    if (last) out.push(last);

    return out
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => c.replace(/^\s*\/+\s*/, ""));
  }

  _getAudioPlayCount(type, data, action, actionRepeatMultiplier = 1) {
    if (type === "gift" && action?.repeatPerUnit) {
      return Math.max(1, Number.parseInt(data?.repeatcount, 10) || 1);
    }

    if (type === "like" && action?.repeatPerUnit) {
      return Math.max(1, Number.parseInt(actionRepeatMultiplier, 10) || 1);
    }

    return 1;
  }

  _getExecutionList(userId) {
    const uid = this.normalizeUserId(userId);

    if (!this.activeExecutions.has(uid)) {
      this.activeExecutions.set(uid, new Map());
    }

    return this.activeExecutions.get(uid);
  }

  _registerExecution(userId, payload = {}) {
    const uid = this.normalizeUserId(userId);
    const executionList = this._getExecutionList(uid);
    const executionId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const entry = {
      id: executionId,
      userId: uid,
      source: String(payload.source || 'event').trim() || 'event',
      type: String(payload.type || 'event').trim() || 'event',
      actionName: String(payload.actionName || '').trim(),
      triggeredBy: String(payload.triggeredBy || '').trim(),
      mode: String(payload.mode || 'direct').trim() || 'direct',
      comboIterations: Math.max(1, Number.parseInt(payload.comboIterations, 10) || 1),
      totalCommands: Math.max(0, Number.parseInt(payload.totalCommands, 10) || 0),
      totalIterations: Math.max(1, Number.parseInt(payload.totalIterations, 10) || 1),
      progress: {
        completedCommands: 0,
        totalCommands: Math.max(0, Number.parseInt(payload.totalCommands, 10) || 0),
        completedIterations: 0,
        totalIterations: Math.max(1, Number.parseInt(payload.totalIterations, 10) || 1)
      },
      startedAt: Date.now(),
      status: 'running'
    };

    executionList.set(executionId, entry);
    return entry;
  }

  _updateExecution(userId, executionId, updates = {}) {
    const uid = this.normalizeUserId(userId);
    const executionList = this.activeExecutions.get(uid);
    if (!executionList) return null;

    const id = String(executionId || '').trim();
    if (!id || !executionList.has(id)) return null;

    const entry = executionList.get(id);
    Object.assign(entry, updates);
    return entry;
  }

  _finishExecution(userId, executionId, payload = {}) {
    const uid = this.normalizeUserId(userId);
    const executionList = this.activeExecutions.get(uid);
    if (!executionList) return null;

    const id = String(executionId || '').trim();
    if (!id || !executionList.has(id)) return null;

    const entry = executionList.get(id);
    entry.status = String(payload.status || 'finished').trim() || 'finished';
    entry.finishedAt = Date.now();
    entry.durationMs = entry.startedAt ? entry.finishedAt - entry.startedAt : 0;

    if (payload.executed != null) entry.executed = Number(payload.executed || 0);
    if (payload.queued != null) entry.queued = Number(payload.queued || 0);
    if (payload.detail) entry.detail = String(payload.detail);

    executionList.delete(id);

    if (executionList.size === 0) {
      this.activeExecutions.delete(uid);
    }

    return entry;
  }

  getActiveExecutions(userId = DEFAULT_USER_ID) {
    const uid = this.normalizeUserId(userId);
    const executionList = this.activeExecutions.get(uid);

    return Array.isArray(executionList)
      ? executionList
      : Array.from(executionList?.values?.() || []).map((entry) => ({
          ...entry
        }));
  }

  async _playAudioForAction(action, type, uid, count = 1, options = {}) {
    if (!action?.audioEnabled) return { triggered: 0, skipped: true };

    const asset = String(action.audioAsset || "").trim();
    if (!asset) return { triggered: 0, skipped: true };

    const planned = Math.max(1, Number.parseInt(count, 10) || 1);
    const waitForFinish = options.waitForFinish ?? !!action.audioWaitForFinish;
    const replaceCurrent = !!action.audioReplaceCurrent;
    // Si audioPlayOncePerCombo es true, reproducir solo 1 vez. Por defecto reproducir por unidad (false)
    const repeatCount = action.audioPlayOncePerCombo === true ? 1 : planned;

    let accepted = 0;

    for (let i = 0; i < repeatCount; i++) {
      const result = await audioService.enqueue({
        userId: uid,
        asset,
        volume: action.audioVolume,
        actionName: action.name,
        eventType: type,
        waitForFinish,
        replaceCurrent
      });

      if (result?.accepted) {
        accepted++;
      }
    }

    if (accepted > 0) {
      this.logForUser(
        "info",
        `🔊 Audio [${action.name || type}] enviado ${accepted}/${repeatCount} vez/veces${waitForFinish ? " (espera fin)" : ""}${replaceCurrent ? " (reemplaza actuales)" : ""}${action.audioPlayOncePerCombo !== false ? " (1 por combo)" : ""}`,
        uid
      );
    }

    return {
      triggered: accepted,
      requested: repeatCount,
      skipped: accepted === 0
    };
  }

  async _handleEvent(type, data = {}, userId = DEFAULT_USER_ID, options = {}) {
    const uid = this.normalizeUserId(userId);
    const actions = storage.loadActions(uid) || [];
    const execution = this._registerExecution(uid, {
      source: options?.source || 'event',
      type,
      actionName: options?.actionName || '',
      triggeredBy: options?.triggeredBy || (options?.source?.startsWith('manual-test') ? 'Manual test' : (data.nickname || data.username || 'TikTok')),
      mode: options?.parallel ? 'parallel' : 'serial'
    });
    let executed = 0;
    let queued = 0;
    const onlyActionIndex = Number.parseInt(options?.onlyActionIndex, 10);
    const hasOnlyActionIndex = Number.isInteger(onlyActionIndex) && onlyActionIndex >= 0;

    const stats = statsService.increment(type, data, uid);

    let hasSpecificGiftMatch = false;
    if (type === "gift" && data.giftname) {
      const giftName = String(data.giftname).toLowerCase();
      hasSpecificGiftMatch = actions.some((a) =>
        a.type === "gift" &&
        a.trigger &&
        a.trigger.trim() !== "" &&
        String(a.trigger).toLowerCase() === giftName
      );
    }

    const username = data.username || "unknown";
    const userStats = stats.users?.[username] || {
      likes: 0,
      comments: 0,
      gifts: 0,
      follows: 0
    };

    const likesAdded = Number.parseInt(data.likecount, 10) || 1;
    const userLikesBefore = (userStats.likes || 0) - likesAdded;

    if (type === "like") {
      this.logForUser(
        "like",
        `❤️ ${data.nickname} dio ${data.likecount || 1} likes (Total: ${userStats.likes || 0})`,
        uid
      );
    } else if (type === "comment") {
      this.logForUser(
        "comment",
        `💬 ${data.nickname}: ${data.comment} (Comentario #${userStats.comments || 0})`,
        uid
      );
    } else if (type === "gift") {
      this.logForUser(
        "gift",
        `🎁 ${data.nickname} envió ${data.giftname} x${data.repeatcount || 1} (Total: ${userStats.gifts || 0})`,
        uid
      );
    } else if (type === "follow") {
      this.logForUser(
        "follow",
        `➕ ${data.nickname} siguió (Follow #${stats.totalFollows || 0})`,
        uid
      );
    }

    try {
      for (let actionIndex = 0; actionIndex < actions.length; actionIndex++) {
        const action = actions[actionIndex];

        if (hasOnlyActionIndex && actionIndex !== onlyActionIndex) continue;
        if (action.enabled === false) continue;
        if (action.type !== type) continue;

        if (type === "gift" && hasSpecificGiftMatch) {
          const trig = (action.trigger || "").trim();
          if (trig === "") continue;
        }

        if (
          type === "comment" &&
          action.trigger &&
          !String(data.comment || "").toLowerCase().includes(String(action.trigger).toLowerCase())
        ) {
          continue;
        }

        if (
          type === "gift" &&
          action.trigger &&
          String(data.giftname || "").toLowerCase() !== String(action.trigger).toLowerCase()
        ) {
          continue;
        }

        let actionRepeatMultiplier = 1;

          if (type === "like" && action.trigger) {
            const triggerVal = Number.parseInt(action.trigger, 10);
            if (Number.isNaN(triggerVal) || triggerVal <= 0) continue;

            const currentLikes = userStats.likes || 0;
            const prevMilestone = Math.floor(userLikesBefore / triggerVal);
            const currMilestone = Math.floor(currentLikes / triggerVal);
            const crossedMilestones = currMilestone - prevMilestone;

            if (crossedMilestones <= 0) continue;

            actionRepeatMultiplier = crossedMilestones;

            this.logForUser(
              "info",
              `🎯 ${username} cruzó ${crossedMilestones} umbral(es) de ${triggerVal} like(s) (${userLikesBefore} → ${currentLikes})`,
              uid
            );
          }

        const parsedCommand = this.parseCommand(action.command, data, uid);
        let commands = this.splitCommands(parsedCommand);

        if (!commands.length) continue;

        const resolvedActionName = String(action.name || action.trigger || type).trim() || type;
        execution.actionName = execution.actionName || resolvedActionName;
        execution.triggeredBy = execution.triggeredBy || String(data.nickname || data.username || 'TikTok').trim() || 'TikTok';

        const sourceName =
          action.name ||
          `${type}-${data.giftname || String(data.comment || "").slice(0, 10) || "event"}-u${uid}`;

        // Determinar si es combo y cuántas iteraciones
        let isCombo = false;
        let comboIterations = 1;

        if (type === "gift" && action.repeatPerUnit) {
          const repeat = Number.parseInt(data.repeatcount, 10) || 1;
          if (repeat > 1) {
            isCombo = true;
            comboIterations = repeat;
          }
        }

        if (type === "like" && actionRepeatMultiplier > 1) {
          isCombo = true;
          comboIterations = actionRepeatMultiplier;
        }

        const totalIterations = isCombo ? comboIterations : 1;
        const totalCommands = commands.length * totalIterations;
        this._updateExecution(uid, execution.id, {
          actionName: execution.actionName || resolvedActionName,
          triggeredBy: execution.triggeredBy,
          comboIterations,
          totalCommands,
          totalIterations,
          progress: {
            completedCommands: 0,
            totalCommands,
            completedIterations: 0,
            totalIterations
          }
        });
        // Indicar si la acción tiene audio configurado para que el frontend no muestre ETA
        this._updateExecution(uid, execution.id, {
          hasAudio: !!action.audioEnabled && String(action.audioAsset || '').trim() !== ''
        });

        // Determinar si encolamos o ejecutamos directo
        // En combos intentamos ejecución directa, pero si RCON no está, igual encolamos
        let shouldQueue = (action.useQueue ?? false) || !rconService.isConnected(uid);

        if (isCombo) {
          // Ejecución por iteraciones: cada iteración es comandos + audio
          this.logForUser(
            "info",
            `🔁 ${comboIterations} iteración(es) para acción [${action.name || action.trigger || type}]`,
            uid
          );

        if (shouldQueue) {
          // Si hay que encolar el combo, encolamos TODO como un bloque (sin audio)
          const allCommands = [];
          for (let iter = 0; iter < comboIterations; iter++) {
            allCommands.push(...commands);
          }

          const iterLabel = `[1/${comboIterations}]`;
          const iterSource = `${sourceName} ${iterLabel}`;
          queue.add(allCommands, iterSource, uid);
          queued++;

          this.logForUser(
            "info",
            `📋 ${iterSource} a cola (${allCommands.length} comandos, ${comboIterations} iteraciones)`,
            uid
          );
        } else {
          // Ejecución directa: cada iteración con sus comandos + audio
          for (let iter = 0; iter < comboIterations; iter++) {
            const iterLabel = `[${iter + 1}/${comboIterations}]`;
            const iterSource = `${sourceName} ${iterLabel}`;

            // Ejecutar comandos de esta iteración
            for (let i = 0; i < commands.length; i++) {
              const cmd = commands[i];

              try {
                this.logForUser(
                  "command",
                  `${iterSource} ${cmd}`,
                  uid
                );

                await rconService.send(cmd, uid);
                executed++;

                this._updateExecution(uid, execution.id, {
                  progress: {
                    ...(execution.progress || {}),
                    completedCommands: executed,
                    totalCommands,
                    completedIterations: iter,
                    totalIterations
                  }
                });
                // también actualizar estado hasAudio por si no se estableció antes
                this._updateExecution(uid, execution.id, {
                  hasAudio: !!action.audioEnabled && String(action.audioAsset || '').trim() !== ''
                });

                if (i < commands.length - 1) {
                  await new Promise((resolve) => setTimeout(resolve, 100));
                }
              } catch (err) {
                this.logForUser(
                  "error",
                  `❌ Error ejecutando comando: ${err?.message || err}`,
                  uid
                );
              }
            }

            // Reproducir audio para esta iteración (respeta audioPlayOncePerCombo)
            const shouldPlayAudio = !action.audioPlayOncePerCombo || iter === 0;
            if (shouldPlayAudio) {
              const audioPlayCount = 1; // 1 audio por iteración (cuando aplicable)
              await this._playAudioForAction(action, type, uid, audioPlayCount, {
                waitForFinish: true
              });
            }

            this._updateExecution(uid, execution.id, {
              progress: {
                ...(execution.progress || {}),
                completedCommands: executed,
                totalCommands,
                completedIterations: iter + 1,
                totalIterations
              }
            });
            this._updateExecution(uid, execution.id, {
              hasAudio: !!action.audioEnabled && String(action.audioAsset || '').trim() !== ''
            });

            // Pequeño delay entre iteraciones
            if (iter < comboIterations - 1) {
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
          }
        }
        } else {
          // Ejecución normal (sin combo): 1 grupo de comandos + audio
          if (shouldQueue) {
            queue.add([...commands], sourceName, uid);
            queued++;

            this.logForUser(
              "info",
              `📋 [${sourceName}] grupo a cola (${commands.length} comandos)`,
              uid
            );
          } else {
            for (let i = 0; i < commands.length; i++) {
              const cmd = commands[i];

              try {
                this.logForUser(
                  "command",
                  `[${action.name || sourceName}] ${cmd}`,
                  uid
                );

                await rconService.send(cmd, uid);
                executed++;

                this._updateExecution(uid, execution.id, {
                  progress: {
                    ...(execution.progress || {}),
                    completedCommands: executed,
                    totalCommands,
                    completedIterations: 1,
                    totalIterations: 1
                  }
                });
                this._updateExecution(uid, execution.id, {
                  hasAudio: !!action.audioEnabled && String(action.audioAsset || '').trim() !== ''
                });

                if (i < commands.length - 1) {
                  await new Promise((resolve) => setTimeout(resolve, 100));
                }
              } catch (err) {
                this.logForUser(
                  "error",
                  `❌ Error ejecutando comando: ${err?.message || err}`,
                  uid
                );
              }
            }

            // Reproducir audio una sola vez (sin combo) - SOLO si se ejecutó directo
            const audioPlayCount = this._getAudioPlayCount(type, data, action, actionRepeatMultiplier);
            await this._playAudioForAction(action, type, uid, audioPlayCount, {
              waitForFinish: !!action.audioWaitForFinish
            });
          }
        }
      }
    } finally {
      this._finishExecution(uid, execution.id, {
        status: 'finished',
        executed,
        queued
      });
    }

    if (queued > 0) {
      this.logForUser("info", `📋 ${queued} grupo(s) en cola`, uid);
    }

    if (executed > 0) {
      this.logForUser("info", `✅ ${executed} comando(s) ejecutado(s)`, uid);
    }

    return {
      success: true,
      userId: uid,
      executed,
      queued,
      stats
    };
  }

  async handleEvent(type, data = {}, userId = DEFAULT_USER_ID, options = {}) {
    const uid = this.normalizeUserId(userId);

    // Procesar cada evento de forma independiente para no bloquear chat
    // ni otras donaciones mientras una acción con audio sigue ejecutándose.
    return this._handleEvent(type, data, uid, options);
  }

  getStatus(userId = DEFAULT_USER_ID) {
    const uid = this.normalizeUserId(userId);
    return {
      activeExecutions: this.getActiveExecutions(uid)
    };
  }
}

module.exports = new ActionsService();