// src/services/core/actions.js - Lógica principal para manejar eventos de TikTok, parsear comandos y decidir ejecución directa o en cola por usuario
const storage = require("../infra/storage");
const statsService = require("./stats");
const rconService = require("../infra/rcon");
const logger = require("../../utils/logger");
const queue = require("./queue");

const DEFAULT_USER_ID = 1;

class ActionsService {
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

  async handleEvent(type, data = {}, userId = DEFAULT_USER_ID) {
    const uid = this.normalizeUserId(userId);
    const actions = storage.loadActions(uid) || [];
    let executed = 0;
    let queued = 0;

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

    for (const action of actions) {
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

      let commandGroups = [commands];

      if (type === "like" && actionRepeatMultiplier > 1) {
        commandGroups = Array.from(
          { length: actionRepeatMultiplier },
          () => [...commands]
        );

        this.logForUser(
          "info",
          `🔁 Likes separados: ${actionRepeatMultiplier} grupo(s) para acción [${action.name || action.trigger || "like"}]`,
          uid
        );
      }

      if (type === "gift" && action.repeatPerUnit) {
        const repeat = Number.parseInt(data.repeatcount, 10) || 1;

        if (repeat > 1) {
          const expanded = [];
          for (let i = 0; i < repeat; i++) {
            expanded.push(...commands);
          }
          commands = expanded;

          this.logForUser(
            "info",
            `🔁 Combo expandido: ${repeat}x para acción [${action.name || action.trigger || "gift"}]`,
            uid
          );
        }
      }

        const shouldQueue = (action.useQueue ?? false) || !rconService.isConnected(uid);

        const sourceName =
          action.name ||
          `${type}-${data.giftname || String(data.comment || "").slice(0, 10) || "event"}-u${uid}`;

        if (shouldQueue) {
          for (let groupIndex = 0; groupIndex < commandGroups.length; groupIndex++) {
            const groupCommands = commandGroups[groupIndex];
            const groupSource =
              commandGroups.length > 1
                ? `${sourceName} [${groupIndex + 1}/${commandGroups.length}]`
                : sourceName;

            queue.add(groupCommands, groupSource, uid);
            queued++;

            this.logForUser(
              "info",
              `📋 [${groupSource}] grupo a cola (${groupCommands.length} comandos)`,
              uid
            );
          }
        } else {
          for (let groupIndex = 0; groupIndex < commandGroups.length; groupIndex++) {
            const groupCommands = commandGroups[groupIndex];
            const groupSource =
              commandGroups.length > 1
                ? `${sourceName} [${groupIndex + 1}/${commandGroups.length}]`
                : sourceName;

            for (let i = 0; i < groupCommands.length; i++) {
              const cmd = groupCommands[i];

              try {
                this.logForUser(
                  "command",
                  `[${action.name || groupSource}] ${cmd}`,
                  uid
                );

                await rconService.send(cmd, uid);
                executed++;

                if (i < groupCommands.length - 1) {
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

            if (groupIndex < commandGroups.length - 1) {
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
          }
        }
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
}

module.exports = new ActionsService();