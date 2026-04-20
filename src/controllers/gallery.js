// src/controllers/gallery.js - Controlador para galeria publica de acciones
const { getDb } = require("../services/infra/db");
const storage = require("../services/infra/storage");
const logger = require("../utils/logger");

const db = getDb();

function safeJsonParse(input, fallback) {
  try {
    return JSON.parse(input);
  } catch {
    return fallback;
  }
}

function normalizeType(value) {
  const type = String(value || "gift").trim().toLowerCase();
  return ["gift", "comment", "like", "follow"].includes(type) ? type : "gift";
}

function normalizeTags(value) {
  if (Array.isArray(value)) {
    return value
      .map((tag) => String(tag || "").trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 10);
  }

  return String(value || "")
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 10);
}

function normalizeGalleryAction(row, currentUser) {
  const tags = safeJsonParse(row.tags_json, []);
  const canDelete = currentUser && (Number(row.author_id) === Number(currentUser.id) || currentUser.role === "admin");

  return {
    id: row.id,
    authorId: row.author_id,
    authorName: row.author_username || "unknown",
    title: row.title || "Accion sin titulo",
    description: row.description || "",
    tags: Array.isArray(tags) ? tags : [],
    name: row.name || "",
    type: row.type || "gift",
    trigger: row.trigger || "",
    command: row.command || "",
    useQueue: !!row.use_queue,
    repeatPerUnit: !!row.repeat_per_unit,
    minecraftVersion: row.minecraft_version || "1.20",
    importsCount: Number(row.imports_count || 0),
    isPublic: row.is_public !== 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isOwner: currentUser ? Number(row.author_id) === Number(currentUser.id) : false,
    canDelete
  };
}

module.exports = {
  list(req, res) {
    try {
      const userId = req.user?.id;
      const rawType = String(req.query?.type || "all").trim().toLowerCase();
      const search = String(req.query?.search || "").trim().toLowerCase();
      const mineOnly = String(req.query?.mine || "").trim() === "1";

      const where = ["ga.is_public = 1"];
      const params = [];

      if (mineOnly) {
        where.push("ga.author_id = ?");
        params.push(userId);
      }

      if (rawType && rawType !== "all") {
        where.push("ga.type = ?");
        params.push(normalizeType(rawType));
      }

      if (search) {
        where.push("(LOWER(ga.title) LIKE ? OR LOWER(ga.description) LIKE ? OR LOWER(ga.trigger) LIKE ? OR LOWER(ga.command) LIKE ? OR LOWER(u.username) LIKE ?)");
        const token = `%${search}%`;
        params.push(token, token, token, token, token);
      }

      const rows = db.prepare(`
        SELECT
          ga.*, u.username as author_username
        FROM gallery_actions ga
        LEFT JOIN users u ON u.id = ga.author_id
        WHERE ${where.join(" AND ")}
        ORDER BY ga.created_at DESC
        LIMIT 200
      `).all(...params);

      return res.json({
        success: true,
        items: rows.map((row) => normalizeGalleryAction(row, req.user))
      });
    } catch (error) {
      logger.error("Error listando galeria", error);
      return res.status(500).json({
        success: false,
        error: "No se pudo cargar la galeria"
      });
    }
  },

  publish(req, res) {
    try {
      const userId = req.user?.id;
      const body = req.body || {};

      const title = String(body.title || "").trim();
      const description = String(body.description || "").trim();
      const minecraftVersion = String(body.minecraftVersion || "").trim();
      const action = body.action || {};

      if (!title) {
        return res.status(400).json({ success: false, error: "Titulo requerido" });
      }

      if (!minecraftVersion) {
        return res.status(400).json({ success: false, error: "Version de Minecraft requerida" });
      }

      const versionRegex = /^[\d.]+$/;
      if (!versionRegex.test(minecraftVersion)) {
        return res.status(400).json({ success: false, error: "Version invalida. Solo numeros y puntos (ej: 1.20, 1.20.1)" });
      }

      const type = normalizeType(action.type);
      const trigger = String(action.trigger || "").trim();
      const command = String(action.command || "").trim();

      if (!command) {
        return res.status(400).json({ success: false, error: "La accion requiere comando" });
      }

      if (command.length > 4000) {
        return res.status(400).json({ success: false, error: "Comando demasiado largo" });
      }

      const tags = normalizeTags(body.tags);

      const info = db.prepare(`
        INSERT INTO gallery_actions (
          author_id,
          title,
          description,
          tags_json,
          name,
          type,
          trigger,
          command,
          use_queue,
          repeat_per_unit,
          minecraft_version,
          is_public,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
      `).run(
        userId,
        title,
        description,
        JSON.stringify(tags),
        String(action.name || "").trim(),
        type,
        trigger,
        command,
        action.useQueue ? 1 : 0,
        action.repeatPerUnit ? 1 : 0,
        minecraftVersion
      );

      const row = db.prepare(`
        SELECT ga.*, u.username as author_username
        FROM gallery_actions ga
        LEFT JOIN users u ON u.id = ga.author_id
        WHERE ga.id = ?
      `).get(info.lastInsertRowid);

      logger.info(`🛍️ Accion publicada en galeria por usuario #${userId}`);

      return res.status(201).json({
        success: true,
        item: normalizeGalleryAction(row, req.user)
      });
    } catch (error) {
      logger.error("Error publicando accion en galeria", error);
      return res.status(500).json({
        success: false,
        error: "No se pudo publicar la accion"
      });
    }
  },

  update(req, res) {
    try {
      const userId = req.user?.id;
      const role = req.user?.role;
      const galleryId = Number.parseInt(req.params.id, 10);

      if (!Number.isInteger(galleryId) || galleryId <= 0) {
        return res.status(400).json({ success: false, error: "Id invalido" });
      }

      const row = db.prepare(`
        SELECT *
        FROM gallery_actions
        WHERE id = ?
      `).get(galleryId);

      if (!row) {
        return res.status(404).json({ success: false, error: "Accion no encontrada" });
      }

      const isOwner = Number(row.author_id) === Number(userId);
      const isAdmin = role === "admin";

      if (!isOwner && !isAdmin) {
        return res.status(403).json({ success: false, error: "No tienes permiso para editar esta accion" });
      }

      const body = req.body || {};

      const title = String(body.title || "").trim();
      const description = String(body.description || "").trim();
      const minecraftVersion = String(body.minecraftVersion || "").trim();
      const tags = normalizeTags(body.tags);

      if (!title) {
        return res.status(400).json({ success: false, error: "Titulo requerido" });
      }

      if (!minecraftVersion) {
        return res.status(400).json({ success: false, error: "Version de Minecraft requerida" });
      }

      const versionRegex = /^[\d.]+$/;
      if (!versionRegex.test(minecraftVersion)) {
        return res.status(400).json({ success: false, error: "Version invalida. Solo numeros y puntos (ej: 1.20, 1.20.1)" });
      }

      db.prepare(`
        UPDATE gallery_actions
        SET
          title = ?,
          description = ?,
          tags_json = ?,
          minecraft_version = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        title,
        description,
        JSON.stringify(tags),
        minecraftVersion,
        galleryId
      );

      const updatedRow = db.prepare(`
        SELECT ga.*, u.username as author_username
        FROM gallery_actions ga
        LEFT JOIN users u ON u.id = ga.author_id
        WHERE ga.id = ?
      `).get(galleryId);

      logger.info(`✏️ Accion de galeria #${galleryId} editada por usuario #${userId}`);

      return res.json({
        success: true,
        item: normalizeGalleryAction(updatedRow, req.user)
      });
    } catch (error) {
      logger.error("Error editando accion de galeria", error);
      return res.status(500).json({
        success: false,
        error: "No se pudo actualizar la accion"
      });
    }
  },

  import(req, res) {
    try {
      const userId = req.user?.id;
      const galleryId = Number.parseInt(req.params.id, 10);
      const folderName = String(req.body?.folder || "").trim();

      if (!Number.isInteger(galleryId) || galleryId <= 0) {
        return res.status(400).json({ success: false, error: "Id invalido" });
      }

      const row = db.prepare(`
        SELECT *
        FROM gallery_actions
        WHERE id = ? AND is_public = 1
      `).get(galleryId);

      if (!row) {
        return res.status(404).json({ success: false, error: "Accion no encontrada" });
      }

      if (folderName) {
        const createResult = storage.createFolder(folderName, userId);
        if (!createResult.success && createResult.error !== "La carpeta ya existe") {
          return res.status(400).json({ success: false, error: createResult.error || "No se pudo preparar la carpeta" });
        }
      }

      const actions = storage.loadActions(userId) || [];

      actions.push({
        name: row.name || row.title || "Accion importada",
        type: row.type || "gift",
        trigger: row.trigger || "",
        command: row.command || "",
        useQueue: !!row.use_queue,
        repeatPerUnit: !!row.repeat_per_unit,
        enabled: true,
        minecraftVersion: row.minecraft_version || "",
        folder: folderName
      });

      const saved = storage.saveActions(actions, userId);

      db.prepare(`
        UPDATE gallery_actions
        SET imports_count = imports_count + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(galleryId);

      logger.info(`📥 Accion de galeria #${galleryId} importada por usuario #${userId}`);

      return res.json({
        success: true,
        message: "Accion importada",
        folder: folderName,
        actions: saved
      });
    } catch (error) {
      logger.error("Error importando accion de galeria", error);
      return res.status(500).json({
        success: false,
        error: "No se pudo importar la accion"
      });
    }
  },

  remove(req, res) {
    try {
      const userId = req.user?.id;
      const role = req.user?.role;
      const galleryId = Number.parseInt(req.params.id, 10);

      if (!Number.isInteger(galleryId) || galleryId <= 0) {
        return res.status(400).json({ success: false, error: "Id invalido" });
      }

      const row = db.prepare(`
        SELECT *
        FROM gallery_actions
        WHERE id = ?
      `).get(galleryId);

      if (!row) {
        return res.status(404).json({ success: false, error: "Accion no encontrada" });
      }

      const isOwner = Number(row.author_id) === Number(userId);
      const isAdmin = role === "admin";

      if (!isOwner && !isAdmin) {
        return res.status(403).json({ success: false, error: "No tienes permiso para borrar esta accion" });
      }

      db.prepare(`DELETE FROM gallery_actions WHERE id = ?`).run(galleryId);

      logger.warn(`🗑️ Accion de galeria #${galleryId} borrada por usuario #${userId} (${isAdmin ? "admin" : "owner"})`);

      return res.json({
        success: true,
        deletedId: galleryId
      });
    } catch (error) {
      logger.error("Error borrando accion de galeria", error);
      return res.status(500).json({
        success: false,
        error: "No se pudo borrar la accion"
      });
    }
  }
};
