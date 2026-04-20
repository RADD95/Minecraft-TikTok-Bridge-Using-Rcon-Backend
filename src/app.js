// src/app.js - Servidor Express para Minecraft TikTok Bridge
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const cookieParser = require("cookie-parser");

const { initDb } = require("./services/infra/db");
initDb();

const configController = require("./controllers/config");
const rconController = require("./controllers/rcon");
const tiktokController = require("./controllers/tiktok");
const actionsController = require("./controllers/actions");
const statsController = require("./controllers/stats");
const giftsController = require("./controllers/gifts");
const overlaysController = require("./controllers/overlays");
const authController = require("./controllers/auth");
const adminUsersController = require("./controllers/admin-users");

const logger = require("./utils/logger");

const storage = require("./services/infra/storage");
const rconService = require("./services/infra/rcon");
const tiktokService = require("./services/platforms/tiktok");
const queue = require("./services/core/queue");

const { requireAuth } = require("./middleware/auth");
const { requireAdmin } = require("./middleware/admin");

const app = express();
const PORT = Number(process.env.PORT || 4567);
const CACHE_DIR = path.join(process.cwd(), "data", "cache");
const CORS_ORIGIN_RAW = String(process.env.CORS_ORIGIN || "").trim();

const allowedCorsOrigins = CORS_ORIGIN_RAW
  ? CORS_ORIGIN_RAW.split(",").map((origin) => origin.trim()).filter(Boolean)
  : [];

const corsOptions = {
  credentials: true,
  origin: true
};

if (allowedCorsOrigins.length > 0) {
  corsOptions.origin = function resolveCorsOrigin(origin, callback) {
    if (!origin || allowedCorsOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error("Origen no permitido por CORS"));
  };
}

if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());
app.use("/cache", express.static(CACHE_DIR, {
  maxAge: "30d",
  etag: true,
  lastModified: true,
  immutable: true,
  setHeaders(res) {
    res.setHeader("Cache-Control", "public, max-age=2592000, immutable");
  }
}));

app.get("/data/minecraft_renders.json", (req, res) => {
  res.sendFile(path.join(process.cwd(), "minecraft_renders.json"));
});

app.get("/data/regalos_tiktok.json", (req, res) => {
  res.sendFile(path.join(process.cwd(), "regalos_tiktok.json"));
});

function safeCall(fn, ...args) {
  if (typeof fn !== "function") return undefined;
  try {
    return fn(...args);
  } catch {
    try {
      return fn();
    } catch {
      return undefined;
    }
  }
}

function getScopedConfig(userId) {
  try {
    if (typeof storage.loadEffectiveConfig === "function") {
      return storage.loadEffectiveConfig(userId) || {};
    }

    if (typeof storage.loadConfig === "function") {
      return storage.loadConfig(userId) || {};
    }

    return {};
  } catch {
    return {};
  }
}

function getScopedQueueStatus(userId) {
  try {
    const status = queue.getStatus(userId);

    if (status && typeof status === "object") {
      return {
        pendingGroups: Number(status.pendingGroups || 0),
        pendingList: Array.isArray(status.pendingList) ? status.pendingList : [],
        isProcessing: !!status.isProcessing,
        currentGroup: status.currentGroup || null,
        lastGroupFinishedAt: status.lastGroupFinishedAt || null
      };
    }
  } catch (error) {
    logger.error(`Error obteniendo estado de cola para usuario #${userId}`, error);
  }

  return {
    pendingGroups: 0,
    pendingList: [],
    isProcessing: false,
    currentGroup: null,
    lastGroupFinishedAt: null
  };
}

function getScopedRconDetails(userId) {
  let detailed;

  try {
    detailed = typeof rconService.getStatus === "function"
      ? rconService.getStatus(userId)
      : undefined;
  } catch {
    detailed = undefined;
  }

  if (detailed && typeof detailed === "object") {
    return {
      ...detailed,
      connected: !!(
        detailed.connected ??
        detailed.isConnected ??
        detailed.online
      )
    };
  }

  let connected = false;

  try {
    if (typeof rconService.isConnected === "function") {
      connected = !!rconService.isConnected(userId);
    } else if (typeof rconService.isConnected === "boolean") {
      connected = !!rconService.isConnected;
    }
  } catch {
    connected = false;
  }

  return {
    connected,
    userId
  };
}

function getScopedTikTokDetails(userId) {
  let detailed;

  try {
    detailed = typeof tiktokService.getStatus === "function"
      ? tiktokService.getStatus(userId)
      : undefined;
  } catch {
    detailed = undefined;
  }

  if (detailed && typeof detailed === "object") {
    return {
      ...detailed,
      connected: !!(
        detailed.connected ??
        detailed.isConnected ??
        detailed.online ??
        detailed.active ??
        detailed.running
      ),
      username: detailed.username || ""
    };
  }

  if (typeof detailed === "boolean") {
    return {
      connected: detailed,
      username: "",
      userId
    };
  }

  let connected = false;

  try {
    if (typeof tiktokService.isConnected === "function") {
      connected = !!tiktokService.isConnected(userId);
    }
  } catch {
    connected = false;
  }

  return {
    connected,
    username: "",
    userId
  };
}

function getRuntimeStatus(userId) {
  const rconDetails = getScopedRconDetails(userId);
  const tiktokDetails = getScopedTikTokDetails(userId);
  const queueStatus = getScopedQueueStatus(userId);

  return {
    rcon: !!rconDetails.connected,
    tiktok: !!tiktokDetails.connected,
    rconDetails,
    tiktokDetails,
    queue: queueStatus,
    config: getScopedConfig(userId)
  };
}

function getRuntimeStats(userId) {
  try {
    const statsService = require("./services/core/stats");
    const wrapped = typeof statsService.get === "function"
      ? statsService.get(userId)
      : {};
    const stats = wrapped?.stats || wrapped || {};

    return {
      totalLikes: Number(stats.totalLikes || 0),
      totalComments: Number(stats.totalComments || 0),
      totalGifts: Number(stats.totalGifts || 0),
      totalDiamonds: Number((stats.totalDiamonds ?? stats.diamondsTotal) || 0),
      totalFollows: Number(stats.totalFollows || 0),
      users: stats.users || {}
    };
  } catch {
    return {
      totalLikes: 0,
      totalComments: 0,
      totalGifts: 0,
      totalDiamonds: 0,
      totalFollows: 0,
      users: {}
    };
  }
}

function writeSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function getAllLogs() {
  try {
    if (typeof logger.getLogs === "function") {
      return logger.getLogs() || [];
    }

    if (Array.isArray(logger.logs)) {
      return logger.logs;
    }

    if (Array.isArray(logger.getLogs)) {
      return logger.getLogs;
    }

    return [];
  } catch {
    return [];
  }
}

function isLogForUser(log, userId) {
  if (!log || typeof log !== "object") return false;
  if (log.userId == null) return false;
  return String(log.userId) === String(userId);
}

function getLogsForUser(userId) {
  return getAllLogs()
    .filter((log) => isLogForUser(log, userId))
    .slice(-50);
}

// Routes
app.get("/api/status", requireAuth, (req, res) => {
  return res.json(getRuntimeStatus(req.user?.id));
});

// Auth
app.post("/api/auth/login", authController.login);
app.post("/api/auth/logout", authController.logout);
app.get("/api/auth/me", requireAuth, authController.me);

// Admin Users
app.get("/api/admin/users", requireAuth, requireAdmin, adminUsersController.list);
app.post("/api/admin/users", requireAuth, requireAdmin, adminUsersController.create);
app.patch("/api/admin/users/:id", requireAuth, requireAdmin, adminUsersController.update);
app.delete("/api/admin/users/:id", requireAuth, requireAdmin, adminUsersController.remove);

// Config
app.get("/api/config", requireAuth, configController.get);
app.post("/api/config", requireAuth, configController.save);

// Actions
app.get("/api/actions", requireAuth, actionsController.get);
app.post("/api/actions", requireAuth, actionsController.add);
app.post("/api/actions/:index", requireAuth, actionsController.update);
app.put("/api/actions/:index", requireAuth, actionsController.update);
app.delete("/api/actions/:index", requireAuth, actionsController.delete);
app.post("/api/actions/:index/test", requireAuth, actionsController.test);
app.get("/api/gifts", requireAuth, giftsController.get);

// Overlays
app.get("/api/overlays", requireAuth, overlaysController.list);
app.get("/api/overlays/:id", requireAuth, overlaysController.get);
app.get("/api/public/overlays/:id", overlaysController.getPublic);
app.post("/api/overlays", requireAuth, overlaysController.upsert);
app.put("/api/overlays/:id", requireAuth, overlaysController.upsert);
app.delete("/api/overlays/:id", requireAuth, overlaysController.delete);

// RCON
app.post("/api/rcon/connect", requireAuth, rconController.connect);
app.post("/api/rcon/disconnect", requireAuth, rconController.disconnect);
app.post("/api/rcon/test", requireAuth, rconController.test);
app.post("/api/rcon/command", requireAuth, rconController.command);

// TikTok
app.post("/api/tiktok/start", requireAuth, tiktokController.start);
app.post("/api/tiktok/stop", requireAuth, tiktokController.stop);
app.get("/api/tiktok/status", requireAuth, tiktokController.getStatus);

// Stats
app.get("/api/stats", requireAuth, statsController.get);
app.post("/api/stats/reset", requireAuth, statsController.reset);

// Queue
app.get("/api/queue/status", requireAuth, (req, res) => {
  return res.json({
    success: true,
    queue: getScopedQueueStatus(req.user?.id)
  });
});

app.post("/api/queue/clear", requireAuth, (req, res) => {
  if (typeof queue.clear !== "function") {
    return res.status(400).json({
      success: false,
      error: "La cola no soporta clear() todavía"
    });
  }

  const userId = req.user?.id;
  const result = queue.clear(userId);

  return res.json({
    success: true,
    ...(result && typeof result === "object" ? result : {}),
    queue: getScopedQueueStatus(userId)
  });
});

app.post("/api/queue/retry", requireAuth, (req, res) => {
  if (typeof queue.retry !== "function") {
    return res.status(400).json({
      success: false,
      error: "La cola no soporta retry() todavía"
    });
  }

  const userId = req.user?.id;
  queue.retry(userId);

  return res.json({
    success: true,
    queue: getScopedQueueStatus(userId)
  });
});

// SSE endpoint
app.get("/api/logs/stream", requireAuth, (req, res) => {
  const userId = req.user?.id;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  });

  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  res.write(": connected\n\n");

  writeSse(res, "logsinit", getLogsForUser(userId));
  writeSse(res, "statsupdate", getRuntimeStats(userId));
  writeSse(res, "statusupdate", getRuntimeStatus(userId));
  writeSse(res, "queueupdate", getScopedQueueStatus(userId));

  const pushStatus = () => {
    writeSse(res, "statusupdate", getRuntimeStatus(userId));
  };

  const pushStats = () => {
    writeSse(res, "statsupdate", getRuntimeStats(userId));
  };

  const pushQueue = () => {
    writeSse(res, "queueupdate", getScopedQueueStatus(userId));
  };

const onNewLog = (newLog) => {
  if (!isLogForUser(newLog, userId)) return;

  const msg = String(newLog?.message || "");
  const isRawTikTokPayload =
    msg.startsWith("[tiktok] like:") ||
    msg.startsWith("[tiktok] comment:") ||
    msg.startsWith("[tiktok] gift:") ||
    msg.startsWith("[tiktok] follow:");

  if (isRawTikTokPayload) return;

  writeSse(res, "log", newLog);

  if (["gift", "comment", "like", "follow"].includes(newLog?.type)) pushStats();
  if (["command", "rcon", "tiktok", "warn", "error", "info", "system"].includes(newLog?.type)) pushStatus();
};

  const onLogsCleared = (payload) => {
    if (payload?.userId != null && String(payload.userId) !== String(userId)) {
      return;
    }

    writeSse(res, "logscleared", { success: true });
    writeSse(res, "logsinit", []);
  };

  const onQueueUpdate = (payload) => {
    if (payload?.userId != null && String(payload.userId) !== String(userId)) {
      return;
    }

    pushQueue();
    pushStatus();
  };

  logger.on("newLog", onNewLog);
  logger.on("logs:cleared", onLogsCleared);

  if (typeof queue.on === "function") {
    queue.on("update", onQueueUpdate);
  }

  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 25000);

  const syncInterval = setInterval(() => {
    pushStatus();
    pushStats();
    pushQueue();
  }, 3000);

  req.on("close", () => {
    clearInterval(heartbeat);
    clearInterval(syncInterval);

    if (typeof logger.off === "function") {
      logger.off("newLog", onNewLog);
      logger.off("logs:cleared", onLogsCleared);
    }

    if (typeof queue.off === "function") {
      queue.off("update", onQueueUpdate);
    }

    res.end();
  });
});

// Cache de imágenes TikTok / Minecraft para el editor
app.post("/api/cache-image", requireAuth, async (req, res) => {
  try {
    const { url } = req.body || {};

    if (!url) {
      return res.status(400).json({ success: false, error: "url requerida" });
    }

    const hash = crypto.createHash("sha1").update(url).digest("hex");
    const extFromUrl = path.extname(new URL(url).pathname) || ".png";
    const ext = extFromUrl.toLowerCase().split("?")[0] || ".png";

    const fileName = `${hash}${ext}`;
    const filePath = path.join(CACHE_DIR, fileName);

    if (!fs.existsSync(filePath)) {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const buf = resp.arrayBuffer
        ? Buffer.from(await resp.arrayBuffer())
        : await resp.buffer();

      fs.writeFileSync(filePath, buf);
    }

    return res.json({
      success: true,
      cachedUrl: `/cache/${fileName}`
    });
  } catch (e) {
    console.error("Error cacheando imagen", e);
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("╔═══════════════════════════════════════╗");
  console.log("║   🎮 Minecraft TikTok Bridge         ║");
  console.log("║   Panel: http://localhost:" + PORT + "         ║");
  console.log("╚═══════════════════════════════════════╝");
  console.log("");
  console.log("📋 Pasos:");
  console.log("   1. Abre http://localhost:" + PORT + " en tu navegador");
  console.log("   2. Configura RCON (IP, puerto, password)");
  console.log("   3. Conecta RCON");
  console.log("   4. Agrega acciones");
  console.log("   5. Inicia TikTok LIVE");
  console.log("");

  const config = getScopedConfig(1);
  if (config?.rcon?.host && config?.rcon?.password) {
    logger.info("⚙️ Config RCON detectada. Conecta desde panel.");
  }
});