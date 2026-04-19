const authStore = require('../services/infra/auth-store');
const { signAuthToken, COOKIE_NAME } = require('../middleware/auth');

function buildSafeUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role
  };
}

module.exports = {
  login(req, res) {
    try {
      const { username, password } = req.body || {};

      if (!username || !password) {
        return res.status(400).json({
          success: false,
          error: 'Username y password requeridos'
        });
      }

      const user = authStore.verifyUser(username, password);

      if (!user) {
        return res.status(401).json({
          success: false,
          error: 'Credenciales inválidas'
        });
      }

      const token = signAuthToken(user);

      res.cookie(COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        maxAge: 7 * 24 * 60 * 60 * 1000
      });

      return res.json({
        success: true,
        user: buildSafeUser(user),
        token
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: err.message || 'Error interno en login'
      });
    }
  },

  logout(req, res) {
    res.clearCookie(COOKIE_NAME);
    return res.json({
      success: true,
      message: 'Sesión cerrada'
    });
  },

  me(req, res) {
    return res.json({
      success: true,
      user: buildSafeUser(req.user)
    });
  }
};