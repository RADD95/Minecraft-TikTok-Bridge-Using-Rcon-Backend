// src/services/infra/rcon.js - Servicio multiusuario para manejar conexiones RCON por usuario
const { Rcon } = require("rcon-client");
const storage = require("./storage");
const logger = require("../../utils/logger");

const DEFAULT_USER_ID = 1;

class RconServiceManager {
  constructor() {
    this.runtimes = new Map();
  }

  normalizeUserId(userId) {
    return Number.isInteger(Number(userId)) ? Number(userId) : DEFAULT_USER_ID;
  }

  ensureRuntime(userId = DEFAULT_USER_ID) {
    const uid = this.normalizeUserId(userId);

    if (!this.runtimes.has(uid)) {
      this.runtimes.set(uid, {
        client: null,
        connected: false,
        connectedUserId: null
      });
    }

    return this.runtimes.get(uid);
  }

  async connect(userId = DEFAULT_USER_ID) {
    const uid = this.normalizeUserId(userId);
    const runtime = this.ensureRuntime(uid);
    const config = storage.loadEffectiveConfig(uid);

    if (!config?.rcon?.host || !config?.rcon?.password) {
      throw new Error("RCON no configurado");
    }

    if (runtime.client) {
      const oldClient = runtime.client;
      runtime.client = null;
      runtime.connected = false;
      runtime.connectedUserId = null;

      oldClient.removeAllListeners?.();

      try {
        await oldClient.end();
      } catch (_) {}
    }

    try {
      const client = await Rcon.connect({
        host: config.rcon.host,
        port: config.rcon.port || 25575,
        password: config.rcon.password
      });

      runtime.client = client;
      runtime.connected = true;
      runtime.connectedUserId = uid;

      client.on("error", (err) => {
        logger.error(`RCON error usuario #${uid}`, err);

        if (runtime.client === client) {
          runtime.connected = false;
          runtime.connectedUserId = null;
          runtime.client = null;
        }
      });

      client.on("end", () => {
        logger.info(`RCON desconectado para usuario #${uid}`);

        if (runtime.client === client) {
          runtime.connected = false;
          runtime.connectedUserId = null;
          runtime.client = null;
        }
      });

      await client.send("say §a[RCON] §fConectado correctamente");
      logger.info(`RCON conectado para usuario #${uid}`);

      return true;
    } catch (err) {
      logger.error(`Error RCON usuario #${uid}`, err);
      runtime.client = null;
      runtime.connected = false;
      runtime.connectedUserId = null;
      throw err;
    }
  }

  async send(command, userId = DEFAULT_USER_ID) {
    const uid = this.normalizeUserId(userId);
    const runtime = this.ensureRuntime(uid);

    if (!runtime.connected || !runtime.client) {
      throw new Error("RCON no conectado");
    }

    return runtime.client.send(command);
  }

  async disconnect(userId = DEFAULT_USER_ID) {
    const uid = this.normalizeUserId(userId);
    const runtime = this.ensureRuntime(uid);

    logger.info(`Desconectando RCON de usuario #${uid}...`);

    if (runtime.client) {
      const client = runtime.client;
      runtime.client = null;

      client.removeAllListeners?.();

      try {
        await client.end();
      } catch (err) {
        logger.warn(`⚠️ Error al cerrar RCON usuario #${uid}`, err?.message || err);
      }
    }

    runtime.connected = false;
    runtime.connectedUserId = null;

    return true;
  }

  async disconnectAll() {
    const jobs = [];

    for (const uid of this.runtimes.keys()) {
      jobs.push(this.disconnect(uid));
    }

    await Promise.all(jobs);
    return true;
  }

  isConnected(userId = DEFAULT_USER_ID) {
    const uid = this.normalizeUserId(userId);
    const runtime = this.ensureRuntime(uid);
    return !!runtime.connected;
  }

  getStatus(userId = DEFAULT_USER_ID) {
    const uid = this.normalizeUserId(userId);
    const runtime = this.ensureRuntime(uid);

    return {
      connected: !!runtime.connected,
      connectedUserId: runtime.connectedUserId,
      userId: uid
    };
  }

  getAllStatuses() {
    const output = {};

    for (const [uid, runtime] of this.runtimes.entries()) {
      output[uid] = {
        connected: !!runtime.connected,
        connectedUserId: runtime.connectedUserId,
        userId: uid
      };
    }

    return output;
  }
}

module.exports = new RconServiceManager();