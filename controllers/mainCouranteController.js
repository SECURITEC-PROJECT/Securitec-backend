import { json, readJson } from "../utils/helpers.js";

// Récupérer tous les événements de la main courante
export async function getMainCouranteEntries(request, response, pool) {
  try {
    const result = await pool.query(
      `SELECT id, type_entree AS "typeEntree", category, severity, zone, 
              people, statut_auteur AS "statutAuteur", nature_violation AS "natureViolation", 
              description, mesures_prises AS "mesuresPrises", heure, created_at 
       FROM main_courante 
       ORDER BY created_at DESC;`
    );
    json(response, 200, result.rows);
  } catch (error) {
    console.error("Erreur GET /main-courante:", error);
    json(response, 500, { error: "Erreur lors de la récupération de la main courante." });
  }
}

// Enregistrer une entrée dans la main courante
export async function createMainCouranteEntry(request, response, pool) {
  try {
    const body = await readJson(request);
    const {
      typeEntree, category, severity, zone, people,
      statutAuteur, natureViolation, description, mesuresPrises, heure
    } = body;

    if (!description || !description.trim()) {
      return json(response, 400, { error: "La description / faits constatés est obligatoire." });
    }

    const query = `
      INSERT INTO main_courante (
        type_entree, category, severity, zone, people,
        statut_auteur, nature_violation, description, mesures_prises, heure, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      RETURNING *;
    `;

    const values = [
      typeEntree || 'STANDARD',
      category || 'Information',
      severity || 'normal',
      zone || '',
      people || '',
      statutAuteur || '',
      natureViolation || '',
      description.trim(),
      mesuresPrises ? mesuresPrises.trim() : '',
      heure || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    ];

    const result = await pool.query(query, values);
    json(response, 201, result.rows[0]);
  } catch (error) {
    if (error.status) {
      return json(response, error.status, { error: error.message });
    }
    console.error("Erreur POST /main-courante:", error);
    json(response, 500, { error: "Erreur lors de l'enregistrement de l'événement." });
  }
}