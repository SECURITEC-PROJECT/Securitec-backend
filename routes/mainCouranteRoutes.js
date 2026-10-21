import { createMainCouranteEntry, getMainCouranteEntries } from "../controllers/mainCouranteController.js";

const apiPrefix = "/api";

export async function handleMainCouranteRoutes(request, response, pool, pathname) {
  if (request.method === "GET" && pathname === `${apiPrefix}/main-courante`) {
    await getMainCouranteEntries(request, response, pool);
    return true;
  }
  if (request.method === "POST" && pathname === `${apiPrefix}/main-courante`) {
    await createMainCouranteEntry(request, response, pool);
    return true;
  }
  return false;
}