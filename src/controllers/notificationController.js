const db = require('../config/db');

const genId = (p) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const getNotifications = async (req, res) => {
  try {
    const result = await db.query('SELECT id, text, time, type FROM notifications ORDER BY id DESC');
    return res.json(result.rows);
  } catch (err) {
    console.error('Error fetching notifications:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la récupération des notifications.' });
  }
};

const addNotification = async (req, res) => {
  const { text, time, type } = req.body;
  const id = genId('N');

  try {
    await db.query(
      'INSERT INTO notifications (id, text, time, type) VALUES ($1, $2, $3, $4)',
      [id, text, time, type || 'info']
    );

    const result = await db.query('SELECT id, text, time, type FROM notifications WHERE id = $1', [id]);
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error adding notification:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la création de la notification.' });
  }
};

const removeNotification = async (req, res) => {
  const { id } = req.params;

  try {
    const check = await db.query('SELECT * FROM notifications WHERE id = $1', [id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Notification introuvable.' });
    }

    await db.query('DELETE FROM notifications WHERE id = $1', [id]);
    return res.json({ message: 'Notification supprimée avec succès.', id });
  } catch (err) {
    console.error('Error removing notification:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la suppression de la notification.' });
  }
};

module.exports = {
  getNotifications,
  addNotification,
  removeNotification,
};
