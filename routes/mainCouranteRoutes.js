import { createMainCouranteEntry, getMainCouranteEntries } from "../controllers/mainCouranteController.js";
import { getRequestUser } from "../utils/auth.js";
import { json } from "../utils/helpers.js";

const apiPrefix = "/api";

export async function handleMainCouranteRoutes(request, response, pool, pathname, jwtSecret) {
  if (pathname !== `${apiPrefix}/main-courante`) return false;
  const user = getRequestUser(request, jwtSecret);
  if (!user) {
    json(response, 401, { error: "Connectez-vous pour consulter la main courante." });
    return true;
  }
  if (request.method === "GET" && pathname === `${apiPrefix}/main-courante`) {
    await getMainCouranteEntries(request, response, pool, user.id);
    return true;
  }
  if (request.method === "POST" && pathname === `${apiPrefix}/main-courante`) {
    await createMainCouranteEntry(request, response, pool, user.id);
    return true;
  }
  json(response, 405, { error: "Méthode non autorisée." });
  return true;
}
