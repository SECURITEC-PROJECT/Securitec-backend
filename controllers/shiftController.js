import { json, readJson } from "../utils/helpers.js";

export async function getShifts(request, response, pool) {
  try {
    const result = await pool.query(
      `SELECT id, nom, prenom, prestataire, site_de_travail, checks, notes, started_at, ended_at 
       FROM prises_de_poste 
       ORDER BY started_at DESC;`
    );
    json(response, 200, result.rows);
  } catch (error) {
    console.error("Erreur GET /shifts:", error);
    json(response, 500, { error: "Erreur lors de la récupération des prises de poste." });
  }
}

export async function createShift(request, response, pool) {
  try {
    const body = await readJson(request);
    const { nom, prenom, prestataire, site_de_travail, checks, notes } = body;

    if (!nom || !prenom) {
      return json(response, 400, { error: "Le nom et le prénom sont obligatoires." });
    }

    const query = `
      INSERT INTO prises_de_poste (nom, prenom, prestataire, site_de_travail, checks, notes, started_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      RETURNING *;
    `;
    const values = [
      nom.trim(),
      prenom.trim(),
      prestataire || 'securitec',
      site_de_travail || 'Usine Antsirabe',
      JSON.stringify(checks || {}),
      notes ? notes.trim() : ''
    ];

    const result = await pool.query(query, values);
    json(response, 201, result.rows[0]);
  } catch (error) {
    if (error.status) {
      return json(response, error.status, { error: error.message });
    }
    console.error("Erreur POST /shifts:", error);
    json(response, 500, { error: "Erreur lors de la création de la prise de poste." });
  }
}

export async function endShift(request, response, pool, shiftId) {
  try {
    const query = `
      UPDATE prises_de_poste 
      SET ended_at = NOW() 
      WHERE id = $1 
      RETURNING *;
    `;
    const result = await pool.query(query, [shiftId]);

    if (result.rows.length === 0) {
      return json(response, 404, { error: "Prise de poste non trouvée." });
    }

    json(response, 200, result.rows[0]);
  } catch (error) {
    console.error("Erreur PUT /shifts/:id/end:", error);
    json(response, 500, { error: "Erreur lors de la clôture du service." });
  }
}