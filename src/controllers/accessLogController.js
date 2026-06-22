const db = require('../config/db');

const genId = (p) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const getAccessLogs = async (req, res) => {
  try {
    const result = await db.query('SELECT id, name, badge, type, zone, time, detail FROM access_logs ORDER BY time DESC, id DESC');
    return res.json(result.rows);
  } catch (err) {
    console.error('Error fetching access logs:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la récupération des logs d\'accès.' });
  }
};

const addAccessLog = async (req, res) => {
  const { name, badge, type, zone, time, detail } = req.body;
  const id = genId('L');

  try {
    await db.query(
      'INSERT INTO access_logs (id, name, badge, type, zone, time, detail) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [id, name, badge, type, zone, time, detail]
    );

    const result = await db.query('SELECT id, name, badge, type, zone, time, detail FROM access_logs WHERE id = $1', [id]);
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error adding access log:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la création du log d\'accès.' });
  }
};

const removeAccessLog = async (req, res) => {
  const { id } = req.params;

  try {
    const check = await db.query('SELECT * FROM access_logs WHERE id = $1', [id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Log d\'accès introuvable.' });
    }

    await db.query('DELETE FROM access_logs WHERE id = $1', [id]);
    return res.json({ message: 'Log d\'accès supprimé avec succès.', id });
  } catch (err) {
    console.error('Error removing access log:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la suppression du log d\'accès.' });
  }
};

module.exports = {
  getAccessLogs,
  addAccessLog,
  removeAccessLog,
};
