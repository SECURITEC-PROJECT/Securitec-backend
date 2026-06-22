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

const getCameraExtractions = async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, camera_id as "cameraId", camera_label as "cameraLabel", requested_by as "requestedBy", requested_at as "requestedAt", start_time as "startTime", end_time as "endTime", reason, status, created_at as "createdAt" FROM camera_extractions ORDER BY created_at DESC'
    );
    return res.json(result.rows);
  } catch (err) {
    console.error('Error fetching camera extractions:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la récupération des extraits caméra.' });
  }
};

const addCamera = async (req, res) => {
  const { label, status } = req.body;
  const id = req.body.id || `CAM-${Date.now().toString(36)}`;

  if (!label || !status) {
    return res.status(400).json({ error: 'Le libellé et le statut de la caméra sont obligatoires.' });
  }

  try {
    await db.query(
      'INSERT INTO camera_feeds (id, label, status) VALUES ($1, $2, $3)',
      [id, label, status]
    );

    const result = await db.query('SELECT id, label, status FROM camera_feeds WHERE id = $1', [id]);
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating camera:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la création de la caméra.' });
  }
};

const extractSequence = async (req, res) => {
  const { id } = req.params;
  const { startTime, endTime, reason } = req.body;

  if (!startTime || !endTime || !reason) {
    return res.status(400).json({ error: 'La période et la raison sont obligatoires.' });
  }

  try {
    const cameraResult = await db.query('SELECT * FROM camera_feeds WHERE id = $1', [id]);
    if (cameraResult.rows.length === 0) {
      return res.status(404).json({ error: 'Caméra introuvable.' });
    }

    const camera = cameraResult.rows[0];
    const extractionId = `EX-${Date.now().toString(36)}`;
    const timeStamp = new Date().toLocaleString('fr-FR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    const requestedBy = req.user?.name || req.user?.username || 'Système';

    await db.query(
      'INSERT INTO camera_extractions (id, camera_id, camera_label, requested_by, requested_at, start_time, end_time, reason, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [extractionId, camera.id, camera.label, requestedBy, timeStamp, startTime, endTime, reason, 'ready']
    );

    return res.status(201).json({
      id: extractionId,
      cameraId: camera.id,
      cameraLabel: camera.label,
      requestedBy,
      requestedAt: timeStamp,
      startTime,
      endTime,
      reason,
      status: 'ready',
      playbackUrl: null,
      message: 'Extrait enregistré et prêt à être consulté.',
    });
  } catch (err) {
    console.error('Error creating camera extraction:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la création de l’extrait.' });
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

const removeCamera = async (req, res) => {
  const { id } = req.params;

  try {
    const check = await db.query('SELECT * FROM camera_feeds WHERE id = $1', [id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Caméra introuvable.' });
    }

    await db.query('DELETE FROM camera_feeds WHERE id = $1', [id]);
    return res.json({ message: 'Caméra supprimée avec succès.', id });
  } catch (err) {
    console.error('Error removing camera:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la suppression de la caméra.' });
  }
};

module.exports = {
  getCameras,
  getCameraExtractions,
  addCamera,
  updateCameraStatus,
  removeCamera,
  extractSequence,
};
