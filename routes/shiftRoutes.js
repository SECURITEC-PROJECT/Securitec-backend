import { createShift, endShift, getShifts } from "../controllers/shiftController.js";

const apiPrefix = "/api";

export async function handleShiftRoutes(request, response, pool, pathname) {
  if (request.method === "GET" && pathname === `${apiPrefix}/shifts`) {
    await getShifts(request, response, pool);
    return true;
  }
  if (request.method === "POST" && pathname === `${apiPrefix}/shifts`) {
    await createShift(request, response, pool);
    return true;
  }
  const endShiftMatch = pathname.match(/^\/api\/shifts\/(\d+)\/end$/);
  if (request.method === "PUT" && endShiftMatch) {
    await endShift(request, response, pool, endShiftMatch[1]);
    return true;
  }
  return false;
}