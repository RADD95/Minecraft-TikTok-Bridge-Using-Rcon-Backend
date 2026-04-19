// src/middleware/admin.js
function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: "No autenticado"
    });
  }

  if (req.user.role !== "admin") {
    return res.status(403).json({
      success: false,
      error: "Acceso solo para administradores"
    });
  }

  next();
}

module.exports = {
  requireAdmin
};