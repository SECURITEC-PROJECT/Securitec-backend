import { getAnomaliesSorties } from "../controllers/anomalieController.js";
import { getRequestUser } from "../utils/auth.js";
import { json } from "../utils/helpers.js";

export async function handleAnomalieRoutes(request, response, pool, pathname, jwtSecret) {
  if (request.method !== "GET" || pathname !== "/api/anomalies/sorties") return false;

  try {
    if (!getRequestUser(request, jwtSecret)) {
      json(response, 401, { error: "Connectez-vous pour consulter les anomalies." });
      return true;
    }
    const anomalies = await getAnomaliesSorties();
    json(response, 200, { count: anomalies.length, anomalies });
  } catch (error) {
    console.error("Erreur anomalies de sortie:", error.code || error.name, error.message);
    json(response, 500, { error: "Erreur lors de la recherche des anomalies de sortie." });
  }
  return true;
}