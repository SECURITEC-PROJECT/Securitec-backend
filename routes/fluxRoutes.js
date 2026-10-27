import {
  createLogisticsEntry,
  createLogisticsIncident,
  deleteWasteEntry,
  getLogisticsEntries,
  getLogisticsIncidents,
  updateWasteEntry,
} from "../controllers/logisticsController.js";
import { getRequestUser } from "../utils/auth.js";
import { json } from "../utils/helpers.js";

const apiPrefix = "/api";
const entriesPath = `${apiPrefix}/logistics`;
const incidentsPath = `${entriesPath}/incidents`;
const wasteEntryPath = /^\/api\/logistics\/([0-9a-f-]+)$/i;

export async function handleFluxRoutes(request, response, pool, pathname, jwtSecret) {
  const wasteMatch = wasteEntryPath.exec(pathname);
  if (pathname !== entriesPath && pathname !== incidentsPath && !wasteMatch) return false;

  const user = getRequestUser(request, jwtSecret);
  if (!user) {
    json(response, 401, { error: "Connectez-vous pour accéder aux flux logistiques." });
    return true;
  }

  if (pathname === entriesPath && request.method === "GET") {
    await getLogisticsEntries(request, response, pool, user.id);
    return true;
  }
  if (pathname === entriesPath && request.method === "POST") {
    await createLogisticsEntry(request, response, pool, user.id);
    return true;
  }
  if (wasteMatch && request.method === "PUT") {
    await updateWasteEntry(request, response, pool, user.id, wasteMatch[1]);
    return true;
  }
  if (wasteMatch && request.method === "DELETE") {
    await deleteWasteEntry(request, response, pool, user.id, wasteMatch[1]);
    return true;
  }
  if (pathname === incidentsPath && request.method === "GET") {
    await getLogisticsIncidents(request, response, pool, user.id);
    return true;
  }
  if (pathname === incidentsPath && request.method === "POST") {
    await createLogisticsIncident(request, response, pool, user.id);
    return true;
  }

  json(response, 405, { error: "Méthode non autorisée." });
  return true;
}
