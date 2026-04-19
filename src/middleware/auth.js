const jwt = require('jsonwebtoken');
const authStore = require('../services/infra/auth-store');

const JWT_SECRET = process.env.JWT_SECRET || 'cambia-esto-por-un-secreto-largo';
const COOKIE_NAME = 'mtb_token';

function getTokenFromRequest(req) {
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }

  if (req.cookies && req.cookies[COOKIE_NAME]) {
    return req.cookies[COOKIE_NAME];
  }

  return null;
}

function requireAuth(req, res, next) {
  try {
    const token = getTokenFromRequest(req);

    if (!token) {
      return res.status(401).json({ success: false, error: 'No autenticado' });
    }

    const payload = jwt.verify(token, JWT_SECRET);
    const user = authStore.findUserById(payload.userId);

    if (!user || user.is_active !== 1) {
      return res.status(401).json({ success: false, error: 'Sesión inválida' });
    }

    req.user = {
      id: user.id,
      username: user.username,
      role: user.role
    };

    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Token inválido o expirado' });
  }
}

function signAuthToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      username: user.username,
      role: user.role
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

module.exports = {
  requireAuth,
  signAuthToken,
  COOKIE_NAME,
  JWT_SECRET
};