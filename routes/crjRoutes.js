import { generateCrj, getCrjOptions } from "../controllers/crjController.js";
import { json } from "../utils/helpers.js";

export async function handleCrjRoutes(request, response, pool, pathname) {
  if (request.method !== "GET") return false;

  // 1. Options des sélecteurs : prestataires et sites actifs
  if (pathname === "/api/crj/options") {
    try {
      json(response, 200, await getCrjOptions());
    } catch (error) {
      console.error("Erreur CRJ options:", error.code, error.message);
      json(response, 500, { error: "Erreur lors du chargement des options du CRJ." });
    }
    return true;
  }

  // 2. Rapport journalier généré pour un prestataire, un site et une date
  if (pathname === "/api/crj") {
    try {
      const url = new URL(request.url, "http://localhost");
      const crj = await generateCrj({
        prestataireId: url.searchParams.get("prestataireId"),
        siteId: url.searchParams.get("siteId"),
        date: url.searchParams.get("date"),
      });
      json(response, 200, crj);
    } catch (error) {
      console.error("Erreur CRJ:", error.code, error.message);
      json(response, error.status || 500, {
        error: error.status ? error.message : "Erreur lors de la génération du CRJ.",
      });
    }
    return true;
  }

  return false;
}
