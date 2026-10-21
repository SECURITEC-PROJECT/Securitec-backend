import { createPatrol, finishPatrol, getPatrols, updateCheckpoints } from "../controllers/patrolController.js";
import { getRequestUser } from "../utils/auth.js";
import { json } from "../utils/helpers.js";

const apiPrefix = "/api";

export async function handlePatrolRoutes(request, response, pool, pathname, jwtSecret) {
  const routePath = `${apiPrefix}/patrols`;
  const checkMatch = pathname.match(/^\/api\/patrols\/([0-9a-f-]+)$/i);
  const finishMatch = pathname.match(/^\/api\/patrols\/([0-9a-f-]+)\/finish$/i);
  if (pathname !== routePath && !checkMatch && !finishMatch) return false;

  const user = getRequestUser(request, jwtSecret);
  if (!user) {
    json(response, 401, { error: "Connectez-vous pour accéder aux rondes." });
    return true;
  }
  if (pathname === routePath && request.method === "GET") {
    await getPatrols(request, response, pool, user.id);
    return true;
  }
  if (pathname === routePath && request.method === "POST") {
    await createPatrol(request, response, pool, user.id);
    return true;
  }
  if (checkMatch && request.method === "PATCH") {
    await updateCheckpoints(request, response, pool, user.id, checkMatch[1]);
    return true;
  }
  if (finishMatch && request.method === "POST") {
    await finishPatrol(request, response, pool, user.id, finishMatch[1]);
    return true;
  }
  json(response, 405, { error: "Méthode non autorisée." });
  return true;
}
