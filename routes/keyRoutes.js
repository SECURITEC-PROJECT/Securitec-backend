import { createKeyMovement, getKeysMovements } from "../controllers/keyController.js";
import { json, readJson } from "../utils/helpers.js";

export async function handleKeyRoutes(request, response, pool, pathname) {
  const method = request.method;
  const apiPrefix = "/api";

  // 1. Récupérer les mouvements de clés
  if (method === "GET" && pathname === `${apiPrefix}/keys`) {
    try {
      const movements = await getKeysMovements(request, response);
      json(response, 200, movements);
    } catch (error) {
      json(response, 500, { error: "Erreur lors de la récupération des mouvements de clés." });
    }
    return true;
  }

  // 2. Enregistrer un mouvement de clé
  if (method === "POST" && pathname === `${apiPrefix}/keys`) {
    try {
      const body = await readJson(request);
      const newMovement = await createKeyMovement(body);
      json(response, 201, newMovement);
    } catch (error) {
      json(response, 400, { error: error.message || "Erreur lors de l'enregistrement." });
    }
    return true;
  }

  // 3. Récupérer les personnes habilitées pour une clé donnée
  if (method === "GET" && pathname.startsWith(`${apiPrefix}/cles-habilitations/`)) {
    const trousseCle = decodeURIComponent(pathname.replace(`${apiPrefix}/cles-habilitations/`, ""));
    try {
      const result = await pool.query(
        `SELECT e.id, e.nom, e.prenom, e.role 
         FROM employe e
         JOIN cle_habilitation ch ON e.role = ch.role_autorise
         WHERE TRIM(UPPER(ch.trousse_cle)) = TRIM(UPPER($1));`,
        [trousseCle]
      );
      json(response, 200, result.rows);
    } catch (error) {
      console.error("Erreur habilitations:", error);
      json(response, 500, { error: "Erreur lors de la récupération des habilitations." });
    }
    return true;
  }

  return false;
}