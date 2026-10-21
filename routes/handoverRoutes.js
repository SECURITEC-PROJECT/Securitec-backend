import { createHandover, getHandovers } from "../controllers/handoverController.js";
import { getRequestUser } from "../utils/auth.js";
import { json } from "../utils/helpers.js";

const apiPrefix = "/api";

export async function handleHandoverRoutes(request, response, pool, pathname, jwtSecret) {
  if (request.method === "GET" && pathname === `${apiPrefix}/handovers`) {
    await getHandovers(request, response, pool);
    return true;
  }
  if (request.method === "POST" && pathname === `${apiPrefix}/handovers`) {
    const user = getRequestUser(request, jwtSecret);
    if (!user) {
      json(response, 401, { error: "Connectez-vous pour enregistrer une passation." });
      return true;
    }
    await createHandover(request, response, pool, user.id);
    return true;
  }
  return false;
}
