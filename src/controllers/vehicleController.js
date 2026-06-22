const db = require('../config/db');

const genId = (p) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const getVehicles = async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, type, plate, category, driver, company, motif, parking_spot as "parkingSpot", date, time, agent FROM vehicle_movements ORDER BY date DESC, time DESC'
    );
    return res.json(result.rows);
  } catch (err) {
    console.error('Error fetching vehicles:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la récupération des mouvements de véhicules.' });
  }
};

const addVehicle = async (req, res) => {
  const { type, plate, category, driver, company, motif, parkingSpot, date, time, agent } = req.body;
  const id = genId('VM');

  try {
    await db.query(
      'INSERT INTO vehicle_movements (id, type, plate, category, driver, company, motif, parking_spot, date, time, agent) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
      [id, type, plate, category, driver, company, motif, parkingSpot, date, time, agent]
    );

    const result = await db.query(
      'SELECT id, type, plate, category, driver, company, motif, parking_spot as "parkingSpot", date, time, agent FROM vehicle_movements WHERE id = $1',
      [id]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error adding vehicle movement:', err.message);
    return res.status(500).json({ error: 'Erreur lors de l\'ajout du mouvement de véhicule.' });
  }
};

const updateVehicle = async (req, res) => {
  const { id } = req.params;
  const { type, plate, category, driver, company, motif, parkingSpot, date, time, agent } = req.body;

  try {
    const check = await db.query('SELECT * FROM vehicle_movements WHERE id = $1', [id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Mouvement de véhicule introuvable.' });
    }

    await db.query(
      `UPDATE vehicle_movements SET 
        type = COALESCE($1, type), 
        plate = COALESCE($2, plate), 
        category = COALESCE($3, category), 
        driver = COALESCE($4, driver), 
        company = COALESCE($5, company), 
        motif = COALESCE($6, motif), 
        parking_spot = COALESCE($7, parking_spot), 
        date = COALESCE($8, date), 
        time = COALESCE($9, time), 
        agent = COALESCE($10, agent)
      WHERE id = $11`,
      [type, plate, category, driver, company, motif, parkingSpot, date, time, agent, id]
    );

    const result = await db.query(
      'SELECT id, type, plate, category, driver, company, motif, parking_spot as "parkingSpot", date, time, agent FROM vehicle_movements WHERE id = $1',
      [id]
    );
    return res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating vehicle movement:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la modification du mouvement de véhicule.' });
  }
};

const removeVehicle = async (req, res) => {
  const { id } = req.params;
  try {
    const check = await db.query('SELECT * FROM vehicle_movements WHERE id = $1', [id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Mouvement de véhicule introuvable.' });
    }

    await db.query('DELETE FROM vehicle_movements WHERE id = $1', [id]);
    return res.json({ message: 'Mouvement de véhicule supprimé avec succès.', id });
  } catch (err) {
    console.error('Error removing vehicle movement:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la suppression du mouvement de véhicule.' });
  }
};

module.exports = {
  getVehicles,
  addVehicle,
  updateVehicle,
  removeVehicle,
};
