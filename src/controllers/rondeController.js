const db = require('../config/db');

const genId = (p) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const getRondes = async (req, res) => {
  try {
    const rondesRes = await db.query('SELECT * FROM rondes ORDER BY start DESC');
    const checkpointsRes = await db.query('SELECT * FROM checkpoints');

    // Nest checkpoints in their respective rondes
    const rondes = rondesRes.rows.map((ronde) => {
      const cps = checkpointsRes.rows
        .filter((cp) => cp.ronde_id === ronde.id)
        .map((cp) => ({
          id: cp.id,
          name: cp.name,
          zone: cp.zone,
          status: cp.status,
          time: cp.time || undefined,
        }));
      return {
        id: ronde.id,
        circuit: ronde.circuit,
        start: ronde.start,
        agent: ronde.agent,
        status: ronde.status,
        checkpoints: cps,
      };
    });

    return res.json(rondes);
  } catch (err) {
    console.error('Error fetching rondes:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la récupération des rondes.' });
  }
};

const addRonde = async (req, res) => {
  const { circuit, start, agent, status, checkpoints } = req.body;
  const id = genId('R');

  try {
    await db.withTransaction(async (transaction) => {
      await transaction(
        'INSERT INTO rondes (id, circuit, start, agent, status) VALUES ($1, $2, $3, $4, $5)',
        [id, circuit, start, agent, status || 'encours']
      );

      if (checkpoints && Array.isArray(checkpoints)) {
        for (const cp of checkpoints) {
          const cpId = cp.id || genId('CP');
          await transaction(
            'INSERT INTO checkpoints (id, ronde_id, name, zone, status, time) VALUES ($1, $2, $3, $4, $5, $6)',
            [cpId, id, cp.name, cp.zone, cp.status || 'pending', cp.time || null]
          );
        }
      }
    });

    // Fetch the inserted ronde with checkpoints
    const rondeRes = await db.query('SELECT * FROM rondes WHERE id = $1', [id]);
    const cpRes = await db.query('SELECT * FROM checkpoints WHERE ronde_id = $1', [id]);

    const result = {
      ...rondeRes.rows[0],
      checkpoints: cpRes.rows.map((cp) => ({
        id: cp.id,
        name: cp.name,
        zone: cp.zone,
        status: cp.status,
        time: cp.time || undefined,
      })),
    };

    return res.status(201).json(result);
  } catch (err) {
    console.error('Error adding ronde:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la création de la ronde.' });
  }
};

const updateRonde = async (req, res) => {
  const { id } = req.params;
  const { circuit, start, agent, status } = req.body;

  try {
    const check = await db.query('SELECT * FROM rondes WHERE id = $1', [id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Ronde introuvable.' });
    }

    await db.query(
      `UPDATE rondes SET 
        circuit = COALESCE($1, circuit), 
        start = COALESCE($2, start), 
        agent = COALESCE($3, agent), 
        status = COALESCE($4, status)
      WHERE id = $5`,
      [circuit, start, agent, status, id]
    );

    // Fetch updated ronde
    const rondeRes = await db.query('SELECT * FROM rondes WHERE id = $1', [id]);
    const cpRes = await db.query('SELECT * FROM checkpoints WHERE ronde_id = $1', [id]);

    const result = {
      ...rondeRes.rows[0],
      checkpoints: cpRes.rows.map((cp) => ({
        id: cp.id,
        name: cp.name,
        zone: cp.zone,
        status: cp.status,
        time: cp.time || undefined,
      })),
    };

    return res.json(result);
  } catch (err) {
    console.error('Error updating ronde:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la modification de la ronde.' });
  }
};

const updateCheckpoint = async (req, res) => {
  const { cpId } = req.params;
  const { status, time } = req.body;

  try {
    const check = await db.query('SELECT * FROM checkpoints WHERE id = $1', [cpId]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Point de contrôle introuvable.' });
    }

    await db.query(
      `UPDATE checkpoints SET 
        status = COALESCE($1, status), 
        time = COALESCE($2, time)
      WHERE id = $3`,
      [status, time, cpId]
    );

    // Fetch the updated checkpoint
    const updated = await db.query('SELECT * FROM checkpoints WHERE id = $1', [cpId]);
    const cp = updated.rows[0];

    return res.json({
      id: cp.id,
      name: cp.name,
      zone: cp.zone,
      status: cp.status,
      time: cp.time || undefined,
    });
  } catch (err) {
    console.error('Error updating checkpoint:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la modification du point de contrôle.' });
  }
};

const deleteRonde = async (req, res) => {
  const { id } = req.params;

  try {
    const check = await db.query('SELECT * FROM rondes WHERE id = $1', [id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Ronde introuvable.' });
    }

    await db.query('DELETE FROM rondes WHERE id = $1', [id]);
    return res.json({ message: 'Ronde supprimée avec succès.', id });
  } catch (err) {
    console.error('Error deleting ronde:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la suppression de la ronde.' });
  }
};

const deleteCheckpoint = async (req, res) => {
  const { cpId } = req.params;

  try {
    const check = await db.query('SELECT * FROM checkpoints WHERE id = $1', [cpId]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Point de contrôle introuvable.' });
    }

    await db.query('DELETE FROM checkpoints WHERE id = $1', [cpId]);
    return res.json({ message: 'Point de contrôle supprimé avec succès.', id: cpId });
  } catch (err) {
    console.error('Error deleting checkpoint:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la suppression du point de contrôle.' });
  }
};

module.exports = {
  getRondes,
  addRonde,
  updateRonde,
  updateCheckpoint,
  deleteRonde,
  deleteCheckpoint,
};
