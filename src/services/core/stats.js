// src/services/core/stats.js - Servicio para manejar estadísticas de eventos de TikTok LIVE por usuario
const EventEmitter = require("events");
const storage = require("../infra/storage");

const DEFAULT_USER_ID = 1;

class StatsService extends EventEmitter {
  normalizeUserId(userId) {
    return Number.isInteger(Number(userId)) ? Number(userId) : DEFAULT_USER_ID;
  }

  ensureShape(stats) {
    return {
      totalLikes: Number(stats?.totalLikes || 0),
      totalComments: Number(stats?.totalComments || 0),
      totalFollows: Number(stats?.totalFollows || 0),
      totalGifts: Number(stats?.totalGifts || 0),
      diamondsTotal: Number((stats?.diamondsTotal ?? stats?.totalDiamonds) || 0),
      users: stats?.users || {},
      giftTypes: stats?.giftTypes || {}
    };
  }

  toPublicStats(stats, userId = DEFAULT_USER_ID) {
    const safe = this.ensureShape(stats);
    return {
      userId: this.normalizeUserId(userId),
      totalLikes: safe.totalLikes,
      totalComments: safe.totalComments,
      totalFollows: safe.totalFollows,
      totalGifts: safe.totalGifts,
      totalDiamonds: safe.diamondsTotal,
      diamondsTotal: safe.diamondsTotal,
      users: safe.users,
      giftTypes: safe.giftTypes
    };
  }

  emitUpdate(stats, userId = DEFAULT_USER_ID) {
    const payload = this.toPublicStats(stats, userId);
    this.emit("stats:update", payload);
    return payload;
  }

  increment(type, data = {}, userId = DEFAULT_USER_ID) {
    const uid = this.normalizeUserId(userId);
    const stats = this.ensureShape(storage.loadStats(uid));
    const username = data.username || "unknown";

    if (!stats.users[username]) {
      stats.users[username] = {
        likes: 0,
        comments: 0,
        gifts: 0,
        follows: 0
      };
    }

    switch (type) {
      case "like": {
        const likeCount = Number.parseInt(data.likecount, 10) || 1;
        stats.totalLikes += likeCount;
        stats.users[username].likes += likeCount;
        break;
      }

      case "comment": {
        stats.totalComments += 1;
        stats.users[username].comments += 1;
        break;
      }

      case "follow": {
        stats.totalFollows += 1;
        stats.users[username].follows += 1;
        break;
      }

      case "gift": {
        const giftCount = Number.parseInt(data.repeatcount, 10) || 1;
        const diamonds = Number.parseInt(data.diamondCount, 10) || 0;
        const giftName = data.giftname || "unknown";

        stats.totalGifts += giftCount;
        stats.diamondsTotal += diamonds;
        stats.users[username].gifts += giftCount;

        if (!stats.giftTypes[giftName]) {
          stats.giftTypes[giftName] = 0;
        }

        stats.giftTypes[giftName] += giftCount;
        break;
      }

      default:
        break;
    }

    storage.saveStats(stats, uid);
    return this.emitUpdate(stats, uid);
  }

  get(userId = DEFAULT_USER_ID) {
    const uid = this.normalizeUserId(userId);
    return this.toPublicStats(storage.loadStats(uid), uid);
  }

  reset(userId = DEFAULT_USER_ID) {
    const uid = this.normalizeUserId(userId);

    const defaultStats = {
      totalLikes: 0,
      totalComments: 0,
      totalFollows: 0,
      totalGifts: 0,
      diamondsTotal: 0,
      users: {},
      giftTypes: {}
    };

    storage.saveStats(defaultStats, uid);
    return this.emitUpdate(defaultStats, uid);
  }
}

module.exports = new StatsService();