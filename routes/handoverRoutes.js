import { createHandover, getHandovers } from "../controllers/handoverController.js";

const apiPrefix = "/api";

export async function handleHandoverRoutes(request, response, pool, pathname) {
  if (request.method === "GET" && pathname === `${apiPrefix}/handovers`) {
    await getHandovers(request, response, pool);
    return true;
  }
  if (request.method === "POST" && pathname === `${apiPrefix}/handovers`) {
    await createHandover(request, response, pool);
    return true;
  }
  return false;
}