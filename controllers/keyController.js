import { json, readJson } from "../utils/helpers.js";

export async function getKeysMovements(request, response, pool) {
  try {
    const result = await pool.query(
      `SELECT id, trousse_cle, action, personne_habilitee, matricule_personne, agent_gardien, heure, created_at 
       FROM gestion_cles 
       ORDER BY created_at DESC;`
    );
    json(response, 200, result.rows);
  } catch (error) {
    console.error("Erreur GET /keys:", error);
    json(response, 500, { error: "Erreur lors de la récupération des mouvements de clés." });
  }
}

export async function createKeyMovement(request, response, pool) {
  try {
    const body = await readJson(request);
    const { trousseCle, action, personneHabilitee, matriculePersonne, agentGardien, heure } = body;

    if (!trousseCle || !personneHabilitee || !agentGardien) {
      return json(response, 400, { error: "Tous les champs obligatoires des clés doivent être remplis." });
    }

    const query = `
      INSERT INTO gestion_cles (trousse_cle, action, personne_habilitee, matricule_personne, agent_gardien, heure, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      RETURNING *;
    `;
    const values = [
      trousseCle.trim(),
      action || 'Perception',
      personneHabilitee.trim(),
      matriculePersonne.trim(),
      agentGardien.trim(),
      heure || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    ];

    const result = await pool.query(query, values);
    json(response, 201, result.rows[0]);
  } catch (error) {
    if (error.status) {
      return json(response, error.status, { error: error.message });
    }
    console.error("Erreur POST /keys:", error);
    json(response, 500, { error: "Erreur lors de l'enregistrement du mouvement de clé." });
  }
}