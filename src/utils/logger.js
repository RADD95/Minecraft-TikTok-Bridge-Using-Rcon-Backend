// src/utils/logger.js - Logger personalizado con soporte para SSE y buffer observable por usuario
const EventEmitter = require("events");

class Logger extends EventEmitter {
  constructor() {
    super();
    this.logs = [];
    this.maxLogs = 200;
  }

  getTime() {
    return new Date().toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  }

  normalizeType(type = "system") {
    const allowed = new Set([
      "system",
      "info",
      "warn",
      "error",
      "event",
      "gift",
      "comment",
      "like",
      "follow",
      "command",
      "tiktok",
      "rcon",
      "queue"
    ]);

    return allowed.has(type) ? type : "system";
  }

  safePreview(data) {
    if (typeof data === "string") return data;

    try {
      return JSON.stringify(data).slice(0, 220);
    } catch {
      return "[unserializable-event]";
    }
  }

  normalizeExtra(extra = {}) {
    if (!extra || typeof extra !== "object" || Array.isArray(extra)) {
      return {};
    }

    const clean = { ...extra };

    if (clean.userId != null) {
      clean.userId = Number(clean.userId) || clean.userId;
    }

    return clean;
  }

  getLogs(userId = null) {
    if (userId == null) {
      return [...this.logs];
    }

    return this.logs.filter((log) => String(log?.userId) === String(userId));
  }

  getState(userId = null) {
    const logs = this.getLogs(userId);

    return {
      total: logs.length,
      maxLogs: this.maxLogs,
      logs
    };
  }

  push(type, message, extra = {}) {
    const normalizedExtra = this.normalizeExtra(extra);

    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      time: this.getTime(),
      ts: Date.now(),
      type: this.normalizeType(type),
      message: String(message || ""),
      ...normalizedExtra
    };

    this.logs.unshift(entry);

    if (this.logs.length > this.maxLogs) {
      this.logs.pop();
    }

    this.emit("newLog", entry);
    this.emit("updated", this.getState(entry.userId ?? null));

    return entry;
  }

  info(message, extra = {}) {
    const time = this.getTime();
    console.log(`[${time}] [INFO] ${message}`);
    return this.push("info", message, { level: "info", ...this.normalizeExtra(extra) });
  }

  warn(message, extra = {}) {
    const time = this.getTime();
    console.warn(`[${time}] [WARN] ${message}`);
    return this.push("warn", message, { level: "warn", ...this.normalizeExtra(extra) });
  }

  error(message, errOrExtra, maybeExtra = {}) {
    const time = this.getTime();

    let err = null;
    let extra = {};

    if (
      errOrExtra &&
      typeof errOrExtra === "object" &&
      !Array.isArray(errOrExtra) &&
      !("message" in errOrExtra) &&
      Object.keys(maybeExtra || {}).length === 0
    ) {
      extra = errOrExtra;
    } else {
      err = errOrExtra;
      extra = maybeExtra || {};
    }

    console.error(`[${time}] [ERROR] ${message}`, err || "");

    const errorText =
      err?.message ? ` ${err.message}` :
      typeof err === "string" ? ` ${err}` :
      "";

    return this.push("error", `${message}${errorText}`, {
      level: "error",
      ...this.normalizeExtra(extra)
    });
  }

  command(message, extra = {}) {
    const time = this.getTime();
    console.log(`[${time}] [COMMAND] ${message}`);
    return this.push("command", message, this.normalizeExtra(extra));
  }

  event(platform, type, data = {}, extra = {}) {
    const time = this.getTime();
    console.log(`[${time}] [${String(platform).toUpperCase()}] ${type}:`, data);

    const mappedType =
      type === "gift" || type === "comment" || type === "like" || type === "follow"
        ? type
        : platform === "rcon"
          ? "rcon"
          : platform === "tiktok"
            ? "tiktok"
            : "event";

    const preview = this.safePreview(data);

    const derivedUserId =
      data?.userId ??
      data?.raw?.userId ??
      extra?.userId ??
      null;

    return this.push(mappedType, `[${platform}] ${type}: ${preview}`, {
      platform,
      eventType: type,
      raw: data,
      ...this.normalizeExtra(extra),
      ...(derivedUserId != null ? { userId: derivedUserId } : {})
    });
  }

  clear(userId = null) {
    if (userId == null) {
      this.logs = [];
      this.emit("logs:cleared", { success: true });
      this.emit("updated", this.getState());
      return { success: true, cleared: "all" };
    }

    const before = this.logs.length;
    this.logs = this.logs.filter((log) => String(log?.userId) !== String(userId));
    const removed = before - this.logs.length;

    this.emit("logs:cleared", { success: true, userId, removed });
    this.emit("updated", this.getState(userId));

    return {
      success: true,
      userId,
      removed
    };
  }
}

module.exports = new Logger();