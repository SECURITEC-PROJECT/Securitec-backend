import { createFlux, getFlux } from "../controllers/fluxController.js";

const apiPrefix = "/api";

export async function handleFluxRoutes(request, response, pool, pathname) {
  if (request.method === "GET" && pathname === `${apiPrefix}/flux`) {
    await getFlux(request, response, pool);
    return true;
  }
  if (request.method === "POST" && pathname === `${apiPrefix}/flux`) {
    await createFlux(request, response, pool);
    return true;
  }
  return false;
}