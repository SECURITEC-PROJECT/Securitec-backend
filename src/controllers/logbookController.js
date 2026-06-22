const db = require('../config/db');

const genId = (p) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const getLogs = async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, date, time, category, zone, description, severity, agent FROM logbook_entries ORDER BY date DESC, time DESC'
    );
    return res.json(result.rows);
  } catch (err) {
    console.error('Error fetching logbook entries:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la récupération du journal.' });
  }
};

const addLog = async (req, res) => {
  const { date, time, category, zone, description, severity, agent } = req.body;
  const id = genId('LB');

  try {
    await db.query(
      'INSERT INTO logbook_entries (id, date, time, category, zone, description, severity, agent) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [id, date, time, category, zone, description, severity, agent]
    );

    const result = await db.query(
      'SELECT id, date, time, category, zone, description, severity, agent FROM logbook_entries WHERE id = $1',
      [id]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error adding logbook entry:', err.message);
    return res.status(500).json({ error: 'Erreur lors de l\'ajout de l\'entrée dans le journal.' });
  }
};

const removeLog = async (req, res) => {
  const { id } = req.params;
  try {
    const check = await db.query('SELECT * FROM logbook_entries WHERE id = $1', [id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Entrée du journal introuvable.' });
    }

    await db.query('DELETE FROM logbook_entries WHERE id = $1', [id]);
    return res.json({ message: 'Entrée supprimée avec succès.', id });
  } catch (err) {
    console.error('Error removing logbook entry:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la suppression de l\'entrée du journal.' });
  }
};

module.exports = {
  getLogs,
  addLog,
  removeLog,
};
