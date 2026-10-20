import { createVigilancePoints, getVigilancePoints } from "../controllers/vigilanceController.js";

const apiPrefix = "/api";

export async function handleVigilanceRoutes(request, response, pool, pathname) {
  if (request.method === "GET" && pathname === `${apiPrefix}/vigilance`) {
    await getVigilancePoints(request, response, pool);
    return true;
  }
  if (request.method === "POST" && pathname === `${apiPrefix}/vigilance`) {
    await createVigilancePoints(request, response, pool);
    return true;
  }
  return false;
}