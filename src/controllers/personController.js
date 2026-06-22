const db = require('../config/db');

const genId = (p) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const getPersons = async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, type, person_type as "personType", full_name as "fullName", badge, badge_color as "badgeColor", zone, motif, date, time, agent, linked_to as "linkedTo" FROM person_movements ORDER BY date DESC, time DESC'
    );
    return res.json(result.rows);
  } catch (err) {
    console.error('Error fetching persons:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la récupération des mouvements de personnes.' });
  }
};

const addPerson = async (req, res) => {
  const { type, personType, fullName, badge, badgeColor, zone, motif, date, time, agent, linkedTo } = req.body;
  const id = genId('PM');

  try {
    await db.query(
      'INSERT INTO person_movements (id, type, person_type, full_name, badge, badge_color, zone, motif, date, time, agent, linked_to) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)',
      [id, type, personType, fullName, badge, badgeColor, zone, motif, date, time, agent, linkedTo]
    );

    const result = await db.query(
      'SELECT id, type, person_type as "personType", full_name as "fullName", badge, badge_color as "badgeColor", zone, motif, date, time, agent, linked_to as "linkedTo" FROM person_movements WHERE id = $1',
      [id]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error adding person movement:', err.message);
    return res.status(500).json({ error: 'Erreur lors de l\'ajout du mouvement de personne.' });
  }
};

const updatePerson = async (req, res) => {
  const { id } = req.params;
  const { type, personType, fullName, badge, badgeColor, zone, motif, date, time, agent, linkedTo } = req.body;

  try {
    // Check if exists
    const check = await db.query('SELECT * FROM person_movements WHERE id = $1', [id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Mouvement introuvable.' });
    }

    await db.query(
      `UPDATE person_movements SET 
        type = COALESCE($1, type), 
        person_type = COALESCE($2, person_type), 
        full_name = COALESCE($3, full_name), 
        badge = COALESCE($4, badge), 
        badge_color = COALESCE($5, badge_color), 
        zone = COALESCE($6, zone), 
        motif = COALESCE($7, motif), 
        date = COALESCE($8, date), 
        time = COALESCE($9, time), 
        agent = COALESCE($10, agent), 
        linked_to = COALESCE($11, linked_to)
      WHERE id = $12`,
      [type, personType, fullName, badge, badgeColor, zone, motif, date, time, agent, linkedTo, id]
    );

    const result = await db.query(
      'SELECT id, type, person_type as "personType", full_name as "fullName", badge, badge_color as "badgeColor", zone, motif, date, time, agent, linked_to as "linkedTo" FROM person_movements WHERE id = $1',
      [id]
    );
    return res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating person movement:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la modification du mouvement de personne.' });
  }
};

const removePerson = async (req, res) => {
  const { id } = req.params;
  try {
    const check = await db.query('SELECT * FROM person_movements WHERE id = $1', [id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Mouvement introuvable.' });
    }

    await db.query('DELETE FROM person_movements WHERE id = $1', [id]);
    return res.json({ message: 'Mouvement supprimé avec succès.', id });
  } catch (err) {
    console.error('Error removing person movement:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la suppression du mouvement de personne.' });
  }
};

module.exports = {
  getPersons,
  addPerson,
  updatePerson,
  removePerson,
};
