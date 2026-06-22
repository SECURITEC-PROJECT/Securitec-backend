const bcrypt = require('bcryptjs');
const db = require('../config/db');

const sanitizeUser = (user) => ({
  id: user.id,
  username: user.username,
  name: user.name,
  role: user.role,
  roleLabel: user.role_label,
  vacation: user.vacation,
  avatar: user.avatar,
});

const listUsers = async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, username, name, role, role_label, vacation, avatar FROM users ORDER BY name ASC'
    );
    return res.json(result.rows);
  } catch (err) {
    console.error('Error fetching users:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la récupération des utilisateurs.' });
  }
};

const createUser = async (req, res) => {
  const { username, password, name, role, roleLabel, vacation, avatar } = req.body;

  if (!username || !password || !name || !role || !roleLabel || !vacation || !avatar) {
    return res.status(400).json({ error: 'Tous les champs utilisateur sont obligatoires.' });
  }

  try {
    const existing = await db.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [username]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Cet identifiant existe déjà.' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    const id = `U-${Date.now().toString(36)}`;

    await db.query(
      'INSERT INTO users (id, username, password, name, role, role_label, vacation, avatar) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [id, username.trim(), hashedPassword, name.trim(), role, roleLabel.trim(), vacation, avatar.trim()]
    );

    const result = await db.query(
      'SELECT id, username, name, role, role_label, vacation, avatar FROM users WHERE id = $1',
      [id]
    );

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating user:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la création de l\'utilisateur.' });
  }
};

const updateUser = async (req, res) => {
  const { id } = req.params;
  const { username, password, name, role, roleLabel, vacation, avatar } = req.body;

  try {
    const check = await db.query('SELECT * FROM users WHERE id = $1', [id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur introuvable.' });
    }

    if (username) {
      const duplicate = await db.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND id <> $2', [username, id]);
      if (duplicate.rows.length > 0) {
        return res.status(409).json({ error: 'Cet identifiant est déjà utilisé.' });
      }
    }

    const nextPassword = password ? bcrypt.hashSync(password, 10) : check.rows[0].password;

    await db.query(
      `UPDATE users SET
        username = COALESCE($1, username),
        password = $2,
        name = COALESCE($3, name),
        role = COALESCE($4, role),
        role_label = COALESCE($5, role_label),
        vacation = COALESCE($6, vacation),
        avatar = COALESCE($7, avatar)
      WHERE id = $8`,
      [
        username ? username.trim() : null,
        nextPassword,
        name ? name.trim() : null,
        role || null,
        roleLabel ? roleLabel.trim() : null,
        vacation || null,
        avatar ? avatar.trim() : null,
        id,
      ]
    );

    const result = await db.query(
      'SELECT id, username, name, role, role_label, vacation, avatar FROM users WHERE id = $1',
      [id]
    );

    return res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating user:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la modification de l\'utilisateur.' });
  }
};

const deleteUser = async (req, res) => {
  const { id } = req.params;

  try {
    const check = await db.query('SELECT * FROM users WHERE id = $1', [id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur introuvable.' });
    }

    if (check.rows[0].username === 'superviseur') {
      return res.status(400).json({ error: 'Le compte superviseur principal ne peut pas être supprimé.' });
    }

    await db.query('DELETE FROM users WHERE id = $1', [id]);
    return res.json({ message: 'Utilisateur supprimé avec succès.', id });
  } catch (err) {
    console.error('Error deleting user:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la suppression de l\'utilisateur.' });
  }
};

module.exports = {
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  sanitizeUser,
};