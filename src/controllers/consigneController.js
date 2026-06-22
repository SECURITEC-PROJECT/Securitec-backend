const db = require('../config/db');

const genId = (p) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const getConsignes = async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, sender as "from", text, priority, time, unread, target FROM consignes ORDER BY id DESC'
    );

    const parsedRows = result.rows.map((row) => {
      let targetVal = row.target;
      try {
        if (targetVal !== 'all') {
          targetVal = JSON.parse(targetVal);
        }
      } catch {
        // Fallback if JSON parsing fails
      }
      return {
        ...row,
        target: targetVal,
      };
    });

    return res.json(parsedRows);
  } catch (err) {
    console.error('Error fetching consignes:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la récupération des consignes.' });
  }
};

const addConsigne = async (req, res) => {
  const { from, text, priority, time, target } = req.body;
  const id = genId('C');

  let targetStr = 'all';
  if (target && target !== 'all') {
    targetStr = typeof target === 'string' ? target : JSON.stringify(target);
  }

  try {
    await db.query(
      'INSERT INTO consignes (id, sender, text, priority, time, unread, target) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [id, from, text, priority, time, true, targetStr]
    );

    const result = await db.query(
      'SELECT id, sender as "from", text, priority, time, unread, target FROM consignes WHERE id = $1',
      [id]
    );

    const row = result.rows[0];
    let parsedTarget = row.target;
    try {
      if (parsedTarget !== 'all') {
        parsedTarget = JSON.parse(parsedTarget);
      }
    } catch {
      // Ignore
    }

    return res.status(201).json({
      ...row,
      target: parsedTarget,
    });
  } catch (err) {
    console.error('Error adding consigne:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la création de la consigne.' });
  }
};

const markAsRead = async (req, res) => {
  const { id } = req.params;

  try {
    const check = await db.query('SELECT * FROM consignes WHERE id = $1', [id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Consigne introuvable.' });
    }

    await db.query('UPDATE consignes SET unread = false WHERE id = $1', [id]);

    const result = await db.query(
      'SELECT id, sender as "from", text, priority, time, unread, target FROM consignes WHERE id = $1',
      [id]
    );

    const row = result.rows[0];
    let parsedTarget = row.target;
    try {
      if (parsedTarget !== 'all') {
        parsedTarget = JSON.parse(parsedTarget);
      }
    } catch {
      // Ignore
    }

    return res.json({
      ...row,
      target: parsedTarget,
    });
  } catch (err) {
    console.error('Error marking consigne as read:', err.message);
    return res.status(500).json({ error: 'Erreur lors du marquage de la consigne comme lue.' });
  }
};

const removeConsigne = async (req, res) => {
  const { id } = req.params;

  try {
    const check = await db.query('SELECT * FROM consignes WHERE id = $1', [id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Consigne introuvable.' });
    }

    await db.query('DELETE FROM consignes WHERE id = $1', [id]);
    return res.json({ message: 'Consigne supprimée avec succès.', id });
  } catch (err) {
    console.error('Error removing consigne:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la suppression de la consigne.' });
  }
};

module.exports = {
  getConsignes,
  addConsigne,
  markAsRead,
  removeConsigne,
};
