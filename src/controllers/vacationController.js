const db = require('../config/db');

const genId = (p) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const getVacations = async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, date, shift, outgoing_agent as "outgoingAgent", incoming_agent as "incomingAgent", summary, remarks, pending_items as "pendingItems", signed_out as "signedOut", signed_in as "signedIn", status FROM vacations ORDER BY date DESC'
    );
    return res.json(result.rows);
  } catch (err) {
    console.error('Error fetching vacations:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la récupération des vacations.' });
  }
};

const addVacation = async (req, res) => {
  const { date, shift, outgoingAgent, incomingAgent, summary, remarks, pendingItems, signedOut, signedIn, status } = req.body;
  const id = genId('VAC');

  try {
    await db.query(
      'INSERT INTO vacations (id, date, shift, outgoing_agent, incoming_agent, summary, remarks, pending_items, signed_out, signed_in, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
      [
        id,
        date,
        shift,
        outgoingAgent || '',
        incomingAgent || '',
        summary || '',
        remarks || '',
        pendingItems || '',
        signedOut || false,
        signedIn || false,
        status || 'en-cours',
      ]
    );

    const result = await db.query(
      'SELECT id, date, shift, outgoing_agent as "outgoingAgent", incoming_agent as "incomingAgent", summary, remarks, pending_items as "pendingItems", signed_out as "signedOut", signed_in as "signedIn", status FROM vacations WHERE id = $1',
      [id]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error adding vacation:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la création de la vacation.' });
  }
};

const updateVacation = async (req, res) => {
  const { id } = req.params;
  const { date, shift, outgoingAgent, incomingAgent, summary, remarks, pendingItems, signedOut, signedIn, status } = req.body;

  try {
    const check = await db.query('SELECT * FROM vacations WHERE id = $1', [id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Vacation introuvable.' });
    }

    await db.query(
      `UPDATE vacations SET 
        date = COALESCE($1, date), 
        shift = COALESCE($2, shift), 
        outgoing_agent = COALESCE($3, outgoing_agent), 
        incoming_agent = COALESCE($4, incoming_agent), 
        summary = COALESCE($5, summary), 
        remarks = COALESCE($6, remarks), 
        pending_items = COALESCE($7, pending_items), 
        signed_out = COALESCE($8, signed_out), 
        signed_in = COALESCE($9, signed_in), 
        status = COALESCE($10, status)
      WHERE id = $11`,
      [
        date,
        shift,
        outgoingAgent,
        incomingAgent,
        summary,
        remarks,
        pendingItems,
        signedOut,
        signedIn,
        status,
        id,
      ]
    );

    const result = await db.query(
      'SELECT id, date, shift, outgoing_agent as "outgoingAgent", incoming_agent as "incomingAgent", summary, remarks, pending_items as "pendingItems", signed_out as "signedOut", signed_in as "signedIn", status FROM vacations WHERE id = $1',
      [id]
    );
    return res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating vacation:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la modification de la vacation.' });
  }
};

module.exports = {
  getVacations,
  addVacation,
  updateVacation,
};
