import {
  createCourrierMovement,
  deleteCourrierMovement,
  exitCourrierMovement,
  listCourrierMovements,
  updateCourrierMovement,
} from "../controllers/courrierController.js";
import { getRequestUser } from "../utils/auth.js";
import { json } from "../utils/helpers.js";

const entriesPath = "/api/courrier-movements";
const entryPath = /^\/api\/courrier-movements\/([0-9a-f-]+)$/i;
const exitPath = /^\/api\/courrier-movements\/([0-9a-f-]+)\/exit$/i;

export async function handleCourrierRoutes(request, response, pool, pathname, jwtSecret) {
  const entryMatch = entryPath.exec(pathname);
  const exitMatch = exitPath.exec(pathname);
  if (pathname !== entriesPath && !entryMatch && !exitMatch) return false;

  const user = getRequestUser(request, jwtSecret);
  if (!user) {
    json(response, 401, { error: "Connectez-vous pour gérer le registre courrier." });
    return true;
  }
  if (pathname === entriesPath && request.method === "GET") {
    await listCourrierMovements(request, response, pool, user.id);
    return true;
  }
  if (pathname === entriesPath && request.method === "POST") {
    await createCourrierMovement(request, response, pool, user.id);
    return true;
  }
  if (exitMatch && request.method === "PATCH") {
    await exitCourrierMovement(request, response, pool, user.id, exitMatch[1]);
    return true;
  }
  if (entryMatch && request.method === "PUT") {
    await updateCourrierMovement(request, response, pool, user.id, entryMatch[1]);
    return true;
  }
  if (entryMatch && request.method === "DELETE") {
    await deleteCourrierMovement(request, response, pool, user.id, entryMatch[1]);
    return true;
  }
  json(response, 405, { error: "Méthode non autorisée." });
  return true;
}
