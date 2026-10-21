import { createVigilancePoints, getVigilancePoints } from "../controllers/vigilanceController.js";
import { getRequestUser } from "../utils/auth.js";
import { json } from "../utils/helpers.js";

const apiPrefix = "/api";

export async function handleVigilanceRoutes(request, response, pool, pathname, jwtSecret) {
  if (pathname !== `${apiPrefix}/vigilance`) return false;
  const user = getRequestUser(request, jwtSecret);
  if (!user) {
    json(response, 401, { error: "Connectez-vous pour consulter les points de vigilance." });
    return true;
  }
  if (request.method === "GET" && pathname === `${apiPrefix}/vigilance`) {
    await getVigilancePoints(request, response, pool, user.id);
    return true;
  }
  if (request.method === "POST" && pathname === `${apiPrefix}/vigilance`) {
    await createVigilancePoints(request, response, pool, user.id);
    return true;
  }
  json(response, 405, { error: "Méthode non autorisée." });
  return true;
}
