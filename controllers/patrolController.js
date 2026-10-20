import { json, readJson } from "../utils/helpers.js";

// 1. Récupérer l'historique et les rondes
export async function getPatrols(request, response, pool) {
  try {
    const result = await pool.query(
      `SELECT id, route_name, checkpoints, anomalies, started_at, ended_at, created_at 
       FROM patrols 
       ORDER BY created_at DESC;`
    );
    json(response, 200, result.rows);
  } catch (error) {
    console.error("Erreur GET /patrols:", error);
    json(response, 500, { error: "Erreur lors de la récupération des rondes." });
  }
}

// 2. Démarrer une ronde (started_at est fixé IMMÉDIATEMENT à NOW())
export async function createPatrol(request, response, pool) {
  try {
    const body = await readJson(request);
    const { route_name, checkpoints } = body;

    if (!route_name) {
      return json(response, 400, { error: "Le nom du parcours est obligatoire." });
    }

    const query = `
      INSERT INTO patrols (route_name, checkpoints, started_at, created_at)
      VALUES ($1, $2, NOW(), NOW())
      RETURNING *;
    `;
    const values = [route_name.trim(), JSON.stringify(checkpoints || [])];

    const result = await pool.query(query, values);
    json(response, 201, result.rows[0]);
  } catch (error) {
    console.error("Erreur POST /patrols:", error);
    json(response, 500, { error: "Erreur lors de la création de la ronde." });
  }
}

// 3. Mettre à jour les zones cochées
export async function updateCheckpoints(request, response, pool, patrolId) {
  try {
    const body = await readJson(request);
    const { checkpoints } = body;

    const query = `
      UPDATE patrols 
      SET checkpoints = $1 
      WHERE id = $2 
      RETURNING *;
    `;
    const result = await pool.query(query, [JSON.stringify(checkpoints), patrolId]);

    if (result.rows.length === 0) {
      return json(response, 404, { error: "Ronde non trouvée." });
    }

    json(response, 200, result.rows[0]);
  } catch (error) {
    console.error("Erreur PUT /patrols/:id/check:", error);
    json(response, 500, { error: "Erreur lors de la mise à jour des points de contrôle." });
  }
}

// 4. Clôturer la ronde (ended_at = NOW())
export async function finishPatrol(request, response, pool, patrolId) {
  try {
    const body = await readJson(request);
    const { anomalies } = body;

    const query = `
      UPDATE patrols 
      SET ended_at = NOW(), anomalies = $1 
      WHERE id = $2 
      RETURNING *;
    `;
    const values = [anomalies ? anomalies.trim() : null, patrolId];

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return json(response, 404, { error: "Ronde non trouvée." });
    }

    json(response, 200, result.rows[0]);
  } catch (error) {
    console.error("Erreur PUT /patrols/:id/finish:", error);
    json(response, 500, { error: "Erreur lors de la clôture de la ronde." });
  }
}