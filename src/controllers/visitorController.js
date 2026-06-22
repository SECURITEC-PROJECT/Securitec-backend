const db = require('../config/db');

const genId = (p) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const getVisitors = async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, name, company, motif, badge, host_agent as "hostAgent", arrival, expected_duration as "expectedDuration", status FROM visitors ORDER BY arrival DESC'
    );
    return res.json(result.rows);
  } catch (err) {
    console.error('Error fetching visitors:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la récupération des visiteurs.' });
  }
};

const addVisitor = async (req, res) => {
  const { name, company, motif, badge, hostAgent, arrival, expectedDuration, status } = req.body;
  const id = genId('V');

  try {
    await db.query(
      'INSERT INTO visitors (id, name, company, motif, badge, host_agent, arrival, expected_duration, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [id, name, company, motif, badge, hostAgent, arrival, expectedDuration, status || 'attente']
    );

    const result = await db.query(
      'SELECT id, name, company, motif, badge, host_agent as "hostAgent", arrival, expected_duration as "expectedDuration", status FROM visitors WHERE id = $1',
      [id]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error adding visitor:', err.message);
    return res.status(500).json({ error: 'Erreur lors de l\'ajout du visiteur.' });
  }
};

const updateVisitor = async (req, res) => {
  const { id } = req.params;
  const { name, company, motif, badge, hostAgent, arrival, expectedDuration, status } = req.body;

  try {
    const check = await db.query('SELECT * FROM visitors WHERE id = $1', [id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Visiteur introuvable.' });
    }

    await db.query(
      `UPDATE visitors SET 
        name = COALESCE($1, name), 
        company = COALESCE($2, company), 
        motif = COALESCE($3, motif), 
        badge = COALESCE($4, badge), 
        host_agent = COALESCE($5, host_agent), 
        arrival = COALESCE($6, arrival), 
        expected_duration = COALESCE($7, expected_duration), 
        status = COALESCE($8, status)
      WHERE id = $9`,
      [name, company, motif, badge, hostAgent, arrival, expectedDuration, status, id]
    );

    const result = await db.query(
      'SELECT id, name, company, motif, badge, host_agent as "hostAgent", arrival, expected_duration as "expectedDuration", status FROM visitors WHERE id = $1',
      [id]
    );
    return res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating visitor:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la modification du visiteur.' });
  }
};

const removeVisitor = async (req, res) => {
  const { id } = req.params;
  try {
    const check = await db.query('SELECT * FROM visitors WHERE id = $1', [id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Visiteur introuvable.' });
    }

    await db.query('DELETE FROM visitors WHERE id = $1', [id]);
    return res.json({ message: 'Visiteur supprimé avec succès.', id });
  } catch (err) {
    console.error('Error removing visitor:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la suppression du visiteur.' });
  }
};

module.exports = {
  getVisitors,
  addVisitor,
  updateVisitor,
  removeVisitor,
};
