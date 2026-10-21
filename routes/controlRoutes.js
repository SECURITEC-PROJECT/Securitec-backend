import { createBreathTest, createKeyTracking, getBreathTests, getKeyTracking } from "../controllers/accessControlController.js";
import { getBadges, scanBadge, updateBadgeStatus } from "../controllers/badgeController.js";
import { getRequestUser } from "../utils/auth.js";
import { json } from "../utils/helpers.js";

const apiPrefix = "/api";
const badgeIdPattern = /^\/api\/badges\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

export async function handleControlRoutes(request, response, pool, pathname, jwtSecret) {
  const badgeIdMatch = pathname.match(badgeIdPattern);
  const keysPath = `${apiPrefix}/access-control/keys`;
  const breathTestsPath = `${apiPrefix}/access-control/breath-tests`;
  const knownPath = pathname === `${apiPrefix}/badges` ||
    pathname === `${apiPrefix}/badges/scan` || badgeIdMatch ||
    pathname === keysPath || pathname === breathTestsPath;
  if (!knownPath) return false;

  const user = getRequestUser(request, jwtSecret);
  if (!user) {
    json(response, 401, { error: "Connectez-vous pour accéder au contrôle d'accès." });
    return true;
  }

  if (request.method === "GET" && pathname === `${apiPrefix}/badges`) {
    await getBadges(request, response, pool);
    return true;
  }
  if (request.method === "POST" && pathname === `${apiPrefix}/badges/scan`) {
    await scanBadge(request, response, pool);
    return true;
  }
  if (request.method === "PUT" && badgeIdMatch) {
    await updateBadgeStatus(request, response, pool, badgeIdMatch[1]);
    return true;
  }
  if (pathname === keysPath && request.method === "GET") {
    await getKeyTracking(request, response, pool, user.id);
    return true;
  }
  if (pathname === keysPath && request.method === "POST") {
    await createKeyTracking(request, response, pool, user.id);
    return true;
  }
  if (pathname === breathTestsPath && request.method === "GET") {
    await getBreathTests(request, response, pool, user.id);
    return true;
  }
  if (pathname === breathTestsPath && request.method === "POST") {
    await createBreathTest(request, response, pool, user.id);
    return true;
  }

  json(response, 405, { error: "Méthode non autorisée." });
  return true;
}
