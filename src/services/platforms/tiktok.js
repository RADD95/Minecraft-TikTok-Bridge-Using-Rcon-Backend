// src/services/platforms/tiktok.js - Servicio multiusuario para conectar con TikTok LIVE y manejar eventos en tiempo real
const { TikTokLiveConnection } = require("tiktok-live-connector");
const actionsService = require("../core/actions");
const logger = require("../../utils/logger");

const DEFAULT_USER_ID = 1;

class TikTokClient {
  constructor(userId) {
    this.userId = userId;
    this.connection = null;
    this.isConnected = false;
    this.isConnecting = false;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 5000;
    this.autoReconnect = true;
    this.connectTime = 0;
    this.currentUsername = null;
    this.lastAttempt = 0;
    this.lastError = null;
  }

  async start(username) {
    const cleanUsername = String(username || "").trim().replace(/^@/, "");

    if (!cleanUsername) {
      throw new Error("Username de TikTok requerido");
    }

    if (Date.now() - this.lastAttempt < 10000) {
      logger.info(`⏳ [TikTok user:${this.userId}] Bloqueado 10s anti-spam activo...`);
      return false;
    }

    this.lastAttempt = Date.now();

    if (this.isConnecting) {
      logger.info(`⏳ [TikTok user:${this.userId}] Conexión en progreso...`);
      return false;
    }

    if (this.isConnected && this.currentUsername === cleanUsername) {
      logger.info(`⚠️ [TikTok user:${this.userId}] Ya conectado a ${cleanUsername}`);
      return true;
    }

    this.isConnecting = true;
    this.reconnectAttempts = 0;
    this.lastError = null;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.connection) {
      await this.stop();
    }

    this.currentUsername = null;
    logger.info(`🎥 [TikTok user:${this.userId}] Conectando a TikTok LIVE de: ${cleanUsername}`);

    this.currentUsername = cleanUsername;
    this.connectTime = Date.now();
    this.autoReconnect = true;

    try {
      this.connection = new TikTokLiveConnection(cleanUsername, {
        processInitialData: false,
        enableExtendedGiftInfo: true,
        disableEulerFallbacks: false
      });

      this._setupListeners();

      await this.connection.connect();

      this.isConnected = true;
      this.isConnecting = false;
      this.reconnectAttempts = 0;
      this.lastError = null;

      logger.info(`✅ [TikTok user:${this.userId}] Conectado a TikTok LIVE de: ${cleanUsername}`);
      return true;
    } catch (err) {
      this.isConnecting = false;
      this.isConnected = false;

      const errorMsg = err?.message || String(err);
      this.lastError = errorMsg;

      if (errorMsg.includes("user_not_found")) {
        logger.error(`❌ [TikTok user:${this.userId}] Usuario no encontrado o no está en vivo: ${cleanUsername}`);
        this.autoReconnect = false;
        return false;
      }

      if (errorMsg.includes("blocked by TikTok") || errorMsg.includes("SIGI_STATE")) {
        logger.error(`❌ [TikTok user:${this.userId}] TikTok está bloqueando la conexión. Intenta más tarde.`);
        this._scheduleReconnect(30000);
        return false;
      }

      logger.error(`❌ [TikTok user:${this.userId}] Error conectando a TikTok:`, err);
      this._scheduleReconnect();
      return false;
    }
  }

  async _emitEvent(type, payload) {
    try {
      await actionsService.handleEvent(type, payload, this.userId);
      logger.event("tiktok", type, { ...payload, userId: this.userId });
    } catch (err) {
      logger.error(`Error procesando evento TikTok ${type} user:${this.userId}`, err);
    }
  }

  _setupListeners() {
    if (!this.connection) return;

    this.connection.on("chat", (data) => {
      const username = data.user?.uniqueId || "unknown";
      const nickname = data.user?.nickname || username;
      const msgTime = parseInt(data.createTime || "0", 10);

      if (msgTime && msgTime < this.connectTime - 5000) return;

      this._emitEvent("comment", {
        username,
        nickname,
        comment: data.comment,
        platform: "tiktok"
      });
    });

    this.connection.on("gift", (data) => {
      const username = data.user?.uniqueId || "unknown";
      const nickname = data.user?.nickname || username;
      const giftType = data.giftDetails?.giftType ?? data.extendedGiftInfo?.type ?? 0;

      if (giftType === 1 && !data.repeatEnd) return;

      const msgTime = parseInt(data.common?.createTime || "0", 10);
      if (msgTime && msgTime < this.connectTime - 5000) return;

      this._emitEvent("gift", {
        username,
        nickname,
        giftname: data.giftDetails?.giftName || data.extendedGiftInfo?.name || "Gift",
        repeatcount: data.repeatCount || 1,
        diamondCount: data.diamondCount || data.giftDetails?.diamondCount || 0,
        platform: "tiktok"
      });
    });

    this.connection.on("like", (data) => {
      this._emitEvent("like", {
        username: data.user?.uniqueId || "unknown",
        nickname: data.user?.nickname || data.user?.uniqueId || "unknown",
        likecount: data.likeCount || 1,
        platform: "tiktok"
      });
    });

    this.connection.on("follow", (data) => {
      const username = data.user?.uniqueId || "unknown";
      const nickname = data.user?.nickname || username;

      if (username === "unknown") {
        logger.warn(`⚠️ [TikTok user:${this.userId}] Evento follow sin usuario válido`);
        return;
      }

      this._emitEvent("follow", {
        username,
        nickname,
        platform: "tiktok"
      });
    });

    this.connection.on("error", (err) => {
      this.isConnected = false;
      this.isConnecting = false;
      this.lastError = err?.message || String(err);

      if (this._isFatalError(err)) {
        logger.info(`⛔ [TikTok user:${this.userId}] Error fatal, deteniendo reconexiones`);
        this.autoReconnect = false;
        return;
      }

      logger.error(`⚠️ [TikTok user:${this.userId}] Error TikTok`, err);
      this._scheduleReconnect();
    });

    this.connection.on("disconnected", () => {
      logger.info(`🔌 [TikTok user:${this.userId}] Desconectado de TikTok LIVE`);
      this.isConnected = false;
      this.isConnecting = false;

      if (this.autoReconnect) {
        this._scheduleReconnect();
      }
    });

    this.connection.on("connected", () => {
      this.isConnected = true;
      this.isConnecting = false;
      this.lastError = null;
      logger.info(`✅ [TikTok user:${this.userId}] Evento connected recibido desde TikTok`);
    });
  }

  _isFatalError(err) {
    const msg = String(err?.message || err);
    return (
      msg.includes("user_not_found") ||
      msg.includes("blocked") ||
      msg.includes("Failed to retrieve Room ID from all sources")
    );
  }

  _scheduleReconnect(delay = null) {
    if (!this.autoReconnect || !this.currentUsername) return;

    if (this.lastError?.includes("user isn't online")) {
      logger.info(`⏹️ [TikTok user:${this.userId}] No reintentando: streamer offline`);
      return;
    }

    if (this.reconnectTimer) {
      logger.info(`⏳ [TikTok user:${this.userId}] Ya existe un reconnection timer activo`);
      return;
    }

    this.reconnectAttempts++;

    if (this.reconnectAttempts > this.maxReconnectAttempts) {
      logger.info(`⛔ [TikTok user:${this.userId}] Máximo de reintentos (${this.maxReconnectAttempts}) alcanzado. Deteniendo.`);
      this.autoReconnect = false;
      return;
    }

    const actualDelay = delay || this.reconnectDelay;
    logger.info(`🔁 [TikTok user:${this.userId}] Reintento ${this.reconnectAttempts}/${this.maxReconnectAttempts} en ${actualDelay / 1000}s...`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;

      if (this.autoReconnect && this.currentUsername) {
        this.start(this.currentUsername);
      }
    }, actualDelay);
  }

  async stop() {
    logger.info(`🛑 [TikTok user:${this.userId}] Deteniendo TikTok...`);
    this.autoReconnect = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.connection) {
      this.connection.removeAllListeners();

      try {
        await this.connection.disconnect();
      } catch (err) {
        logger.warn(`⚠️ [TikTok user:${this.userId}] Error al disconnect: ${err?.message || err}`);
      }

      this.connection = null;
    }

    this.currentUsername = null;
    this.isConnected = false;
    this.isConnecting = false;
    this.reconnectAttempts = 0;
    this.lastError = null;

    logger.info(`✅ [TikTok user:${this.userId}] TikTok detenido completamente`);
    return true;
  }

  getStatus() {
    return {
      connected: this.isConnected,
      connecting: this.isConnecting,
      username: this.currentUsername,
      reconnectAttempts: this.reconnectAttempts,
      maxReconnectAttempts: this.maxReconnectAttempts,
      autoReconnect: this.autoReconnect,
      lastError: this.lastError,
      connectedUserId: this.userId
    };
  }
}

class TikTokServiceManager {
  constructor() {
    this.clients = new Map();
  }

  normalizeUserId(userId) {
    return Number.isInteger(Number(userId)) ? Number(userId) : DEFAULT_USER_ID;
  }

  getClient(userId = DEFAULT_USER_ID) {
    const uid = this.normalizeUserId(userId);

    if (!this.clients.has(uid)) {
      this.clients.set(uid, new TikTokClient(uid));
    }

    return this.clients.get(uid);
  }

  getEmptyStatus(userId = DEFAULT_USER_ID) {
    const uid = this.normalizeUserId(userId);

    return {
      connected: false,
      connecting: false,
      username: null,
      reconnectAttempts: 0,
      maxReconnectAttempts: 5,
      autoReconnect: false,
      lastError: null,
      connectedUserId: uid
    };
  }

  async start(username, userId = DEFAULT_USER_ID) {
    return this.getClient(userId).start(username);
  }

  async stop(userId = DEFAULT_USER_ID) {
    const uid = this.normalizeUserId(userId);
    const client = this.clients.get(uid);

    if (!client) {
      return true;
    }

    return client.stop();
  }

  async stopAll() {
    const jobs = [];

    for (const client of this.clients.values()) {
      jobs.push(client.stop());
    }

    await Promise.all(jobs);
    return true;
  }

  getStatus(userId = DEFAULT_USER_ID) {
    const uid = this.normalizeUserId(userId);
    const client = this.clients.get(uid);

    if (!client) {
      return this.getEmptyStatus(uid);
    }

    return client.getStatus();
  }

  getAllStatuses() {
    const out = {};

    for (const [uid, client] of this.clients.entries()) {
      out[uid] = client.getStatus();
    }

    return out;
  }

  isConnected(userId = DEFAULT_USER_ID) {
    return !!this.getStatus(userId).connected;
  }
}

module.exports = new TikTokServiceManager();