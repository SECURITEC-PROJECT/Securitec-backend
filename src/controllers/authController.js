const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
require('dotenv').config();

const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '7d';
const REFRESH_TOKEN_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

const generateAccessToken = (user) => {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    process.env.JWT_SECRET || 'securitec_access_secret_key_12345!',
    { expiresIn: ACCESS_TOKEN_EXPIRY }
  );
};

const generateRefreshToken = (user) => {
  return jwt.sign(
    { id: user.id },
    process.env.JWT_REFRESH_SECRET || 'securitec_refresh_secret_key_67890!',
    { expiresIn: REFRESH_TOKEN_EXPIRY }
  );
};

const login = async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Veuillez saisir votre identifiant et mot de passe.' });
  }

  try {
    const normalizedUsername = username.trim().toLowerCase();
    const result = await db.query('SELECT * FROM users WHERE LOWER(username) = $1', [normalizedUsername]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect.' });
    }

    const user = result.rows[0];
    const isPasswordValid = bcrypt.compareSync(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect.' });
    }

    // Generate tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // Save refresh token to database
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_MAX_AGE);
    await db.query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, refreshToken, expiresAt]
    );

    // Set cookie
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: REFRESH_TOKEN_MAX_AGE,
    });

    // Send user details and access token
    const userResponse = {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      roleLabel: user.role_label,
      vacation: user.vacation,
      avatar: user.avatar,
    };

    return res.json({
      accessToken,
      user: userResponse,
    });
  } catch (err) {
    console.error('Error logging in:', err.message);
    return res.status(500).json({ error: 'Erreur interne du serveur lors de la connexion.' });
  }
};

const refresh = async (req, res) => {
  const refreshToken = req.cookies.refreshToken || req.body.refreshToken;

  if (!refreshToken) {
    return res.status(401).json({ error: 'Refresh token manquant.' });
  }

  try {
    // 1. Check if token exists in DB
    const dbResult = await db.query('SELECT * FROM refresh_tokens WHERE token = $1', [refreshToken]);
    if (dbResult.rows.length === 0) {
      return res.status(403).json({ error: 'Refresh token invalide ou réutilisé.' });
    }

    const savedToken = dbResult.rows[0];

    // Check expiration in DB
    if (new Date() > new Date(savedToken.expires_at)) {
      await db.query('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken]);
      return res.status(403).json({ error: 'Refresh token expiré.' });
    }

    // 2. Verify signature
    jwt.verify(
      refreshToken,
      process.env.JWT_REFRESH_SECRET || 'securitec_refresh_secret_key_67890!',
      async (err, decoded) => {
        if (err) {
          // Token signature invalid or expired in JWT terms
          await db.query('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken]);
          return res.status(403).json({ error: 'Refresh token invalide.' });
        }

        // 3. Find user
        const userResult = await db.query('SELECT * FROM users WHERE id = $1', [decoded.id]);
        if (userResult.rows.length === 0) {
          return res.status(403).json({ error: 'Utilisateur introuvable.' });
        }

        const user = userResult.rows[0];

        // 4. Generate new tokens (Rotation)
        const newAccessToken = generateAccessToken(user);
        const newRefreshToken = generateRefreshToken(user);

        // 5. Update DB (Replace old refresh token)
        const expiresAt = new Date(Date.now() + REFRESH_TOKEN_MAX_AGE);
        await db.query('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken]);
        await db.query(
          'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
          [user.id, newRefreshToken, expiresAt]
        );

        // 6. Set cookie
        res.cookie('refreshToken', newRefreshToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: REFRESH_TOKEN_MAX_AGE,
        });

        return res.json({
          accessToken: newAccessToken,
        });
      }
    );
  } catch (err) {
    console.error('Error refreshing token:', err.message);
    return res.status(500).json({ error: 'Erreur interne du serveur lors du rafraîchissement du token.' });
  }
};

const logout = async (req, res) => {
  const refreshToken = req.cookies.refreshToken || req.body.refreshToken;

  if (refreshToken) {
    try {
      await db.query('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken]);
    } catch (err) {
      console.error('Error deleting refresh token during logout:', err.message);
    }
  }

  res.clearCookie('refreshToken');
  return res.json({ message: 'Déconnexion réussie.' });
};

const me = async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Profil introuvable.' });
    }

    const user = result.rows[0];
    return res.json({
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        roleLabel: user.role_label,
        vacation: user.vacation,
        avatar: user.avatar,
      },
    });
  } catch (err) {
    console.error('Error fetching user profile:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la récupération du profil.' });
  }
};

module.exports = {
  login,
  refresh,
  logout,
  me,
};
