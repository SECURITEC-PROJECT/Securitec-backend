import { getTruckChecklist, saveTruckChecklist } from "../controllers/truckChecklistController.js";
import { getRequestUser } from "../utils/auth.js";
import { json } from "../utils/helpers.js";

const checklistsPath = "/api/truck-checklists";

export async function handleTruckChecklistRoutes(request, response, pool, pathname, jwtSecret) {
  if (pathname !== checklistsPath) return false;
  const user = getRequestUser(request, jwtSecret);
  if (!user) {
    json(response, 401, { error: "Connectez-vous pour accéder aux check-lists camion." });
    return true;
  }
  if (request.method === "GET") {
    await getTruckChecklist(request, response, pool, user.id);
    return true;
  }
  if (request.method === "PUT") {
    await saveTruckChecklist(request, response, pool, user.id);
    return true;
  }
  json(response, 405, { error: "Méthode non autorisée." });
  return true;
}
