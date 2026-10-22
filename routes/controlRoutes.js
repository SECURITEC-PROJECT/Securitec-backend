import { createAlcootest, getAlcootests } from "../controllers/alcootestController.js";
import { getBadges, scanBadge, updateBadgeStatus } from "../controllers/badgeController.js";
import { handleKeyRoutes } from "./keyRoutes.js";

const apiPrefix = "/api";

export async function handleControlRoutes(request, response, pool, pathname) {
  const method = request.method;

  // Délégation de toutes les routes de clés (y compris les habilitations) à keyRoutes
  if (await handleKeyRoutes(request, response, pool, pathname)) return true;

  // Alcootest
  if (method === "GET" && pathname === `${apiPrefix}/alcootests`) {
    await getAlcootests(request, response, pool);
    return true;
  }
  if (method === "POST" && pathname === `${apiPrefix}/alcootests`) {
    await createAlcootest(request, response, pool);
    return true;
  }

  // Badges
  if (method === "GET" && pathname === `${apiPrefix}/badges`) {
    await getBadges(request, response, pool);
    return true;
  }
  if (method === "POST" && pathname === `${apiPrefix}/badges/scan`) {
    await scanBadge(request, response, pool);
    return true;
  }
  const badgeMatch = pathname.match(/^\/api\/badges\/(\d+)$/);
  if (method === "PUT" && badgeMatch) {
    await updateBadgeStatus(request, response, pool, badgeMatch[1]);
    return true;
  }

  return false;
}