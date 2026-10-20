import { json, readJson } from "../utils/helpers.js";

// Récupérer l'historique des points de vigilance
export async function getVigilancePoints(request, response, pool) {
  try {
    const result = await pool.query(
      `SELECT id, type_point AS "typePoint", element_verifie AS "elementVerifie", 
              statut, observations, heure, agent_nom AS "agentNom", created_at 
       FROM points_vigilance 
       ORDER BY created_at DESC;`
    );
    json(response, 200, result.rows);
  } catch (error) {
    console.error("Erreur GET /vigilance:", error);
    json(response, 500, { error: "Erreur lors de la récupération des points de vigilance." });
  }
}

// Enregistrer un lot de points de vigilance (ou un point individuel)
export async function createVigilancePoints(request, response, pool) {
  try {
    const body = await readJson(request);
    // Supporte l'envoi d'un tableau d'éléments ou d'un objet unique
    const entries = Array.isArray(body) ? body : [body];

    if (entries.length === 0) {
      return json(response, 400, { error: "Aucun point de vigilance transmis." });
    }

    const insertedRows = [];

    for (const item of entries) {
      const { typePoint, elementVerifie, statut, observations, heure, agentNom } = item;

      const query = `
        INSERT INTO points_vigilance (type_point, element_verifie, statut, observations, heure, agent_nom, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        RETURNING *;
      `;
      const values = [
        typePoint || 'GÉNÉRAL',
        elementVerifie || 'Contrôle visuel',
        statut || 'Conforme',
        observations ? observations.trim() : '',
        heure || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        agentNom ? agentNom.trim() : ''
      ];

      const result = await pool.query(query, values);
      insertedRows.push(result.rows[0]);
    }

    json(response, 201, insertedRows);
  } catch (error) {
    if (error.status) {
      return json(response, error.status, { error: error.message });
    }
    console.error("Erreur POST /vigilance:", error);
    json(response, 500, { error: "Erreur lors de l'enregistrement des points de vigilance." });
  }
}