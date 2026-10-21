import { createShift, endShift, getShifts } from "../controllers/shiftController.js";
import { getRequestUser } from "../utils/auth.js";
import { json } from "../utils/helpers.js";

const apiPrefix = "/api";
const shiftIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function handleShiftRoutes(request, response, pool, pathname, jwtSecret) {
  const isList = pathname === `${apiPrefix}/shifts` && ["GET", "POST"].includes(request.method);
  const endShiftMatch = pathname.match(/^\/api\/shifts\/([^/]+)\/end$/);
  const isEnd = request.method === "PUT" && endShiftMatch && shiftIdPattern.test(endShiftMatch[1]);
  if (!isList && !isEnd) return false;

  const user = getRequestUser(request, jwtSecret);
  if (!user) {
    json(response, 401, { error: "Connectez-vous pour accéder aux prises de poste." });
    return true;
  }

  if (isList && request.method === "GET") await getShifts(request, response, pool);
  else if (isList) await createShift(request, response, pool, user.id);
  else await endShift(request, response, pool, endShiftMatch[1]);
  return true;
}