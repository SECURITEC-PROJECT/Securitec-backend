const db = require('../config/db');

const getCameras = async (req, res) => {
  try {
    const result = await db.query('SELECT id, label, status FROM camera_feeds ORDER BY id ASC');
    return res.json(result.rows);
  } catch (err) {
    console.error('Error fetching cameras:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la récupération des caméras.' });
  }
};

const updateCameraStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  try {
    const check = await db.query('SELECT * FROM camera_feeds WHERE id = $1', [id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Caméra introuvable.' });
    }

    await db.query('UPDATE camera_feeds SET status = $1 WHERE id = $2', [status, id]);

    const result = await db.query('SELECT id, label, status FROM camera_feeds WHERE id = $1', [id]);
    return res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating camera status:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la modification de la caméra.' });
  }
};

module.exports = {
  getCameras,
  updateCameraStatus,
};
