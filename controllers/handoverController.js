import { json, readJson } from "../utils/helpers.js";

export async function getHandovers(request, response, pool) {
  try {
    const result = await pool.query(
      `SELECT id, agent_sortant_nom, agent_sortant_prenom, incoming_nom, incoming_prenom, equipment, ongoing_events, instructions, created_at 
       FROM passations 
       ORDER BY created_at DESC;`
    );
    json(response, 200, result.rows);
  } catch (error) {
    console.error("Erreur GET /handovers:", error);
    json(response, 500, { error: "Erreur lors de la récupération des passations." });
  }
}

export async function createHandover(request, response, pool) {
  try {
    const body = await readJson(request);
    const { agent_sortant_nom, agent_sortant_prenom, incoming_nom, incoming_prenom, equipment, ongoing_events, instructions } = body;

    if (!incoming_nom || !incoming_prenom) {
      return json(response, 400, { error: "Le nom et le prénom de l'agent montant sont obligatoires." });
    }

    const query = `
      INSERT INTO passations (agent_sortant_nom, agent_sortant_prenom, incoming_nom, incoming_prenom, equipment, ongoing_events, instructions, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      RETURNING *;
    `;
    const values = [
      agent_sortant_nom || '',
      agent_sortant_prenom || '',
      incoming_nom.trim(),
      incoming_prenom.trim(),
      equipment || '',
      ongoing_events || '',
      instructions || ''
    ];

    const result = await pool.query(query, values);
    json(response, 201, result.rows[0]);
  } catch (error) {
    if (error.status) {
      return json(response, error.status, { error: error.message });
    }
    console.error("Erreur POST /handovers:", error);
    json(response, 500, { error: "Erreur lors de l'enregistrement de la passation." });
  }
}