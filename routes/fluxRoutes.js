import {
  createLogisticsEntry,
  createLogisticsIncident,
  createStarParticulierLoading,
  updateLogisticsIncident,
  deleteLogisticsIncident,
  deleteDepotageFuelEntry,
  deleteTruckLogisticsEntry,
  deleteWasteEntry,
  deleteEmptyBottleEntry,
  getLogisticsEntries,
  getLogisticsIncidents,
  getStarParticulierLoadings,
  updateEmptyBottleEntry,
  deleteMatierePremiereEntry,
  deleteStarParticulierLoading,
  updateDepotageFuelEntry,
  updateMatierePremiereEntry,
  updateStarParticulierLoading,
  updateTruckLogisticsEntry,
  updateWasteEntry,
} from "../controllers/logisticsController.js";
import { getRequestUser } from "../utils/auth.js";
import { json } from "../utils/helpers.js";

const apiPrefix = "/api";
const entriesPath = `${apiPrefix}/logistics`;
const incidentsPath = `${entriesPath}/incidents`;
const incidentEntryPath = /^\/api\/logistics\/incidents\/([0-9a-f-]{36})$/i;
const wasteEntryPath = /^\/api\/logistics\/([0-9a-f-]+)$/i;
const emptyBottleEntryPath = /^\/api\/logistics\/empty-bottles\/([0-9a-f-]+)$/i;
const starParticulierPath = `${entriesPath}/star-particulier`;
const starParticulierEntryPath = /^\/api\/logistics\/star-particulier\/([0-9a-f-]+)$/i;

export async function handleFluxRoutes(request, response, pool, pathname, jwtSecret) {
  const wasteMatch = wasteEntryPath.exec(pathname);
  const emptyBottleMatch = emptyBottleEntryPath.exec(pathname);
  const incidentMatch = incidentEntryPath.exec(pathname);
  const starParticulierMatch = starParticulierEntryPath.exec(pathname);
  if (pathname !== entriesPath && pathname !== starParticulierPath && pathname !== incidentsPath
    && !wasteMatch && !emptyBottleMatch && !incidentMatch && !starParticulierMatch) return false;

  const user = getRequestUser(request, jwtSecret);
  if (!user) {
    json(response, 401, { error: "Connectez-vous pour accéder aux flux logistiques." });
    return true;
  }

  if (pathname === starParticulierPath && request.method === "GET") {
    await getStarParticulierLoadings(request, response, pool, user.id);
    return true;
  }
  if (pathname === starParticulierPath && request.method === "POST") {
    await createStarParticulierLoading(request, response, pool, user.id);
    return true;
  }
  if (starParticulierMatch && request.method === "PUT") {
    await updateStarParticulierLoading(request, response, pool, user.id, starParticulierMatch[1]);
    return true;
  }
  if (starParticulierMatch && request.method === "DELETE") {
    await deleteStarParticulierLoading(request, response, pool, user.id, starParticulierMatch[1]);
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
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (url.searchParams.get("type") === "DECHARGEMENT" || url.searchParams.get("type") === "CHARGEMENT") {
      await updateTruckLogisticsEntry(request, response, pool, user.id, wasteMatch[1]);
      return true;
    }
    if (url.searchParams.get("type") === "MATIERE_PREMIERE") {
      await updateMatierePremiereEntry(request, response, pool, user.id, wasteMatch[1]);
      return true;
    }
    if (url.searchParams.get("type") === "DEPOTAGE_FUEL") {
      await updateDepotageFuelEntry(request, response, pool, user.id, wasteMatch[1]);
      return true;
    }
    await updateWasteEntry(request, response, pool, user.id, wasteMatch[1]);
    return true;
  }
  if (wasteMatch && request.method === "DELETE") {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (url.searchParams.get("type") === "DECHARGEMENT" || url.searchParams.get("type") === "CHARGEMENT") {
      await deleteTruckLogisticsEntry(request, response, pool, user.id, wasteMatch[1]);
      return true;
    }
    if (url.searchParams.get("type") === "MATIERE_PREMIERE") {
      await deleteMatierePremiereEntry(request, response, pool, user.id, wasteMatch[1]);
      return true;
    }
    if (url.searchParams.get("type") === "DEPOTAGE_FUEL") {
      await deleteDepotageFuelEntry(request, response, pool, user.id, wasteMatch[1]);
      return true;
    }
    await deleteWasteEntry(request, response, pool, user.id, wasteMatch[1]);
    return true;
  }
  if (emptyBottleMatch && request.method === "PUT") {
    await updateEmptyBottleEntry(request, response, pool, user.id, emptyBottleMatch[1]);
    return true;
  }
  if (emptyBottleMatch && request.method === "DELETE") {
    await deleteEmptyBottleEntry(request, response, pool, user.id, emptyBottleMatch[1]);
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
  if (incidentMatch && request.method === "PUT") {
    await updateLogisticsIncident(request, response, pool, user.id, incidentMatch[1]);
    return true;
  }
  if (incidentMatch && request.method === "DELETE") {
    await deleteLogisticsIncident(request, response, pool, user.id, incidentMatch[1]);
    return true;
  }

  json(response, 405, { error: "Méthode non autorisée." });
  return true;
}
