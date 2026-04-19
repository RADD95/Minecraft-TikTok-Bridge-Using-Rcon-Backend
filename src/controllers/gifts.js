// src/controllers/gifts.js - Controlador para manejar rutas relacionadas con los regalos de TikTok LIVE
const path = require("path");
const fs = require("fs/promises");
const logger = require("../utils/logger");

const GIFTS_FILE = path.join(__dirname, "../../regalos_tiktok.json");

module.exports = {
  async get(req, res) {
    try {
      const raw = await fs.readFile(GIFTS_FILE, "utf8");
      const data = JSON.parse(raw);

      return res.json(data);
    } catch (err) {
      logger.error("Error cargando regalos_tiktok.json", err);

      if (err.code === "ENOENT") {
        return res.status(404).json({
          success: false,
          error: "No se encontró el archivo de regalos"
        });
      }

      return res.status(500).json({
        success: false,
        error: "No se pudieron cargar los regalos"
      });
    }
  }
};