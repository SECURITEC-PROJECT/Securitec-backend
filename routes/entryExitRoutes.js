import {
  createVehicle,
  createVisitor,
  exitVehicle,
  exitVisitor,
  deleteVehicle,
  getVehicles,
  getVisitors,
  updateVehicle,
} from "../controllers/entryExitController.js";
import { getRequestUser } from "../utils/auth.js";
import { json } from "../utils/helpers.js";

const apiPrefix = "/api";

export async function handleEntryExitRoutes(request, response, pool, pathname, jwtSecret) {
  const visitorExit = pathname.match(/^\/api\/visitors\/([0-9a-f-]+)\/exit$/i);
  const vehicleExit = pathname.match(/^\/api\/vehicles\/([0-9a-f-]+)\/exit$/i);
  const vehicleEntry = pathname.match(/^\/api\/vehicles\/([0-9a-f-]+)$/i);
  const isVisitor = pathname === `${apiPrefix}/visitors` || visitorExit;
  const isVehicle = pathname === `${apiPrefix}/vehicles` || vehicleExit || vehicleEntry;
  if (!isVisitor && !isVehicle) return false;

  const user = getRequestUser(request, jwtSecret);
  if (!user) {
    json(response, 401, { error: "Connectez-vous pour gérer les entrées et sorties." });
    return true;
  }
  if (pathname === `${apiPrefix}/visitors` && request.method === "GET") {
    await getVisitors(request, response, pool, user.id);
    return true;
  }
  if (pathname === `${apiPrefix}/visitors` && request.method === "POST") {
    await createVisitor(request, response, pool, user.id);
    return true;
  }
  if (visitorExit && request.method === "PATCH") {
    await exitVisitor(request, response, pool, user.id, visitorExit[1]);
    return true;
  }
  if (pathname === `${apiPrefix}/vehicles` && request.method === "GET") {
    await getVehicles(request, response, pool, user.id);
    return true;
  }
  if (pathname === `${apiPrefix}/vehicles` && request.method === "POST") {
    await createVehicle(request, response, pool, user.id);
    return true;
  }
  if (vehicleExit && request.method === "PATCH") {
    await exitVehicle(request, response, pool, user.id, vehicleExit[1]);
    return true;
  }
  if (vehicleEntry && request.method === "PUT") {
    await updateVehicle(request, response, pool, user.id, vehicleEntry[1]);
    return true;
  }
  if (vehicleEntry && request.method === "DELETE") {
    await deleteVehicle(request, response, pool, user.id, vehicleEntry[1]);
    return true;
  }
  json(response, 405, { error: "Méthode non autorisée." });
  return true;
}
