// src/services/infra/auth-store.js - Servicio para manejar autenticación, creación de usuarios, actualización y eliminación, con soporte para roles y configuración de usuario
const bcrypt = require("bcryptjs");
const { getDb } = require("./db");

const SALT_ROUNDS = 10;

function mapAdminUser(row) {
  if (!row) return null;

  return {
    id: row.id,
    username: row.username,
    role: row.role,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    settings: {
      useGlobalRcon: row.use_global_rcon === 1,
      useGlobalTikTok: row.use_global_tiktok === 1,
      rconHost: row.rcon_host || "",
      rconPort: Number(row.rcon_port || 25575),
      minecraftPlayername: row.minecraft_playername || "@a",
      tiktokUsername: row.tiktok_username || ""
    }
  };
}

class AuthStore {
  constructor() {
    this.db = getDb();
  }

  findUserByUsername(username) {
    return this.db.prepare(`
      SELECT id, username, password_hash, role, is_active, created_at
      FROM users
      WHERE username = ?
      LIMIT 1
    `).get(String(username || "").trim());
  }

  findUserById(id) {
    return this.db.prepare(`
      SELECT id, username, role, is_active, created_at
      FROM users
      WHERE id = ?
      LIMIT 1
    `).get(Number(id));
  }

  findUserWithSettingsById(id) {
    const row = this.db.prepare(`
      SELECT
        u.id,
        u.username,
        u.role,
        u.is_active,
        u.created_at,
        us.use_global_rcon,
        us.use_global_tiktok,
        us.rcon_host,
        us.rcon_port,
        us.minecraft_playername,
        us.tiktok_username
      FROM users u
      LEFT JOIN user_settings us ON us.user_id = u.id
      WHERE u.id = ?
      LIMIT 1
    `).get(Number(id));

    return mapAdminUser(row);
  }

  listUsers() {
    return this.db.prepare(`
      SELECT id, username, role, is_active, created_at
      FROM users
      ORDER BY id ASC
    `).all();
  }

  listUsersWithSettings() {
    const rows = this.db.prepare(`
      SELECT
        u.id,
        u.username,
        u.role,
        u.is_active,
        u.created_at,
        us.use_global_rcon,
        us.use_global_tiktok,
        us.rcon_host,
        us.rcon_port,
        us.minecraft_playername,
        us.tiktok_username
      FROM users u
      LEFT JOIN user_settings us ON us.user_id = u.id
      ORDER BY u.id ASC
    `).all();

    return rows.map(mapAdminUser);
  }

  createUser({ username, password, role = "user" }) {
    const cleanUsername = String(username || "").trim();
    const cleanPassword = String(password || "");
    const cleanRole = String(role || "user").trim();

    if (!cleanUsername) {
      throw new Error("Username requerido");
    }

    if (!cleanPassword || cleanPassword.length < 4) {
      throw new Error("La contraseña debe tener al menos 4 caracteres");
    }

    if (!["admin", "user"].includes(cleanRole)) {
      throw new Error("Rol inválido");
    }

    const exists = this.findUserByUsername(cleanUsername);
    if (exists) {
      throw new Error("Ese usuario ya existe");
    }

    const passwordHash = bcrypt.hashSync(cleanPassword, SALT_ROUNDS);

    const result = this.db.prepare(`
      INSERT INTO users (username, password_hash, role, is_active)
      VALUES (?, ?, ?, 1)
    `).run(cleanUsername, passwordHash, cleanRole);

    const userId = result.lastInsertRowid;

    this.db.prepare(`
      INSERT OR IGNORE INTO user_settings (
        user_id,
        rcon_host,
        rcon_port,
        rcon_password,
        minecraft_playername,
        tiktok_username,
        use_global_rcon,
        use_global_tiktok
      ) VALUES (?, '', 25575, '', '@a', '', 0, 0)
    `).run(userId);

    this.db.prepare(`
      INSERT OR IGNORE INTO stats (
        user_id,
        total_likes,
        total_comments,
        total_follows,
        total_gifts,
        diamonds_total,
        users_json,
        gift_types_json
      ) VALUES (?, 0, 0, 0, 0, 0, '{}', '{}')
    `).run(userId);

    return this.findUserById(userId);
  }

  updateUserAdmin(userId, payload = {}) {
    const uid = Number(userId);

    if (!Number.isInteger(uid) || uid <= 0) {
      throw new Error("ID de usuario inválido");
    }

    const current = this.findUserById(uid);
    if (!current) {
      throw new Error("Usuario no encontrado");
    }

    const nextUsername = payload.username != null
      ? String(payload.username || "").trim()
      : current.username;

    if (!nextUsername) {
      throw new Error("Username requerido");
    }

    const usernameExists = this.findUserByUsername(nextUsername);
    if (usernameExists && Number(usernameExists.id) !== uid) {
      throw new Error("Ese usuario ya existe");
    }

    const nextRole = payload.role != null
      ? String(payload.role || "").trim()
      : current.role;

    if (!["admin", "user"].includes(nextRole)) {
      throw new Error("Rol inválido");
    }

    const nextIsActive = payload.is_active == null
      ? Number(current.is_active)
      : (payload.is_active ? 1 : 0);

    const otherActiveAdmins = this.db.prepare(`
      SELECT COUNT(*) AS total
      FROM users
      WHERE role = 'admin' AND is_active = 1 AND id != ?
    `).get(uid);

    const wouldRemoveAdminAccess =
      current.role === "admin" &&
      (nextRole !== "admin" || nextIsActive !== 1);

    if (uid === 1 && nextRole !== "admin") {
      throw new Error("No puedes quitarle el rol admin al usuario principal");
    }

    if (uid === 1 && nextIsActive !== 1) {
      throw new Error("No puedes desactivar el usuario admin principal");
    }

    if (wouldRemoveAdminAccess && Number(otherActiveAdmins?.total || 0) === 0) {
      throw new Error("No puedes dejar el sistema sin un admin activo");
    }

    const cleanPassword = payload.password == null
      ? null
      : String(payload.password || "");

    const tx = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE users
        SET username = ?, role = ?, is_active = ?
        WHERE id = ?
      `).run(nextUsername, nextRole, nextIsActive, uid);

      if (cleanPassword !== null && cleanPassword !== "") {
        if (cleanPassword.length < 4) {
          throw new Error("La contraseña debe tener al menos 4 caracteres");
        }

        const passwordHash = bcrypt.hashSync(cleanPassword, SALT_ROUNDS);

        this.db.prepare(`
          UPDATE users
          SET password_hash = ?
          WHERE id = ?
        `).run(passwordHash, uid);
      }
    });

    tx();

    return this.findUserWithSettingsById(uid);
  }

  deleteUser(userId) {
    const uid = Number(userId);

    if (!Number.isInteger(uid) || uid <= 0) {
      throw new Error("ID de usuario inválido");
    }

    if (uid === 1) {
      throw new Error("No puedes borrar el admin principal");
    }

    const current = this.findUserById(uid);
    if (!current) {
      throw new Error("Usuario no encontrado");
    }

    const otherActiveAdmins = this.db.prepare(`
      SELECT COUNT(*) AS total
      FROM users
      WHERE role = 'admin' AND is_active = 1 AND id != ?
    `).get(uid);

    if (
      current.role === "admin" &&
      Number(otherActiveAdmins?.total || 0) === 0
    ) {
      throw new Error("No puedes borrar el último admin activo");
    }

    this.db.prepare(`
      DELETE FROM users
      WHERE id = ?
    `).run(uid);

    return true;
  }

  verifyUser(username, password) {
    const user = this.findUserByUsername(username);

    if (!user || user.is_active !== 1) {
      return null;
    }

    const ok = bcrypt.compareSync(String(password || ""), user.password_hash);
    if (!ok) {
      return null;
    }

    return {
      id: user.id,
      username: user.username,
      role: user.role,
      is_active: user.is_active,
      created_at: user.created_at
    };
  }

  setPassword(userId, newPassword) {
    const cleanPassword = String(newPassword || "");
    if (!cleanPassword || cleanPassword.length < 4) {
      throw new Error("La contraseña debe tener al menos 4 caracteres");
    }

    const passwordHash = bcrypt.hashSync(cleanPassword, SALT_ROUNDS);

    this.db.prepare(`
      UPDATE users
      SET password_hash = ?
      WHERE id = ?
    `).run(passwordHash, Number(userId));

    return true;
  }

  deactivateUser(userId) {
    this.db.prepare(`
      UPDATE users
      SET is_active = 0
      WHERE id = ?
    `).run(Number(userId));
  }
}

module.exports = new AuthStore();