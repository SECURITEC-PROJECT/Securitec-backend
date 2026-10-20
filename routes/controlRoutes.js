import { createAlcootest, getAlcootests } from "../controllers/alcootestController.js";
import { getBadges, scanBadge, updateBadgeStatus } from "../controllers/badgeController.js";
import { createKeyMovement, getKeysMovements } from "../controllers/keyController.js";

const apiPrefix = "/api";

export async function handleControlRoutes(request, response, pool, pathname) {
  // Alcootest
  if (request.method === "GET" && pathname === `${apiPrefix}/alcootests`) {
    await getAlcootests(request, response, pool);
    return true;
  }
  if (request.method === "POST" && pathname === `${apiPrefix}/alcootests`) {
    await createAlcootest(request, response, pool);
    return true;
  }

  // Clés
  if (request.method === "GET" && pathname === `${apiPrefix}/keys`) {
    await getKeysMovements(request, response, pool);
    return true;
  }
  if (request.method === "POST" && pathname === `${apiPrefix}/keys`) {
    await createKeyMovement(request, response, pool);
    return true;
  }

  // Badges
  if (request.method === "GET" && pathname === `${apiPrefix}/badges`) {
    await getBadges(request, response, pool);
    return true;
  }
  if (request.method === "POST" && pathname === `${apiPrefix}/badges/scan`) {
    await scanBadge(request, response, pool);
    return true;
  }
  const badgeMatch = pathname.match(/^\/api\/badges\/(\d+)$/);
  if (request.method === "PUT" && badgeMatch) {
    await updateBadgeStatus(request, response, pool, badgeMatch[1]);
    return true;
  }

  return false;
}