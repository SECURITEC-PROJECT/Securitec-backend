import { createAlcootest, getAlcootests } from "../controllers/alcootestController.js";
import {
  createBreathTest,
  createKeyTracking,
  getBreathTests,
  getKeyEmployees,
  getKeyTracking,
  getKeyTypes,
  returnKeyTracking,
} from "../controllers/accessControlController.js";
import { getBadges, scanBadge, updateBadgeStatus } from "../controllers/badgeController.js";
import { handleKeyRoutes } from "./keyRoutes.js";
import { getRequestUser } from "../utils/auth.js";
import { json } from "../utils/helpers.js";
import {
  createAlcoholCheck,
  deleteAlcoholCheck,
  listAlcoholChecks,
  updateAlcoholCheck,
} from "../controllers/alcoholCheckController.js";

const apiPrefix = "/api";

export async function handleControlRoutes(request, response, pool, pathname, jwtSecret) {
  const method = request.method;
  const alcoholCheckPath = `${apiPrefix}/access-control/alcohol-checks`;
  const alcoholCheckMatch = new RegExp(`^${alcoholCheckPath}/([0-9a-f-]+)$`, "i").exec(pathname);

  if (pathname === alcoholCheckPath || alcoholCheckMatch) {
    const user = getRequestUser(request, jwtSecret);
    if (!user) {
      json(response, 401, { error: "Connectez-vous pour gérer les tests alcool." });
      return true;
    }
    if (pathname === alcoholCheckPath && method === "GET") {
      await listAlcoholChecks(request, response, pool, user.id);
      return true;
    }
    if (pathname === alcoholCheckPath && method === "POST") {
      await createAlcoholCheck(request, response, pool, user.id);
      return true;
    }
    if (alcoholCheckMatch && method === "PUT") {
      await updateAlcoholCheck(request, response, pool, user.id, alcoholCheckMatch[1]);
      return true;
    }
    if (alcoholCheckMatch && method === "DELETE") {
      await deleteAlcoholCheck(request, response, pool, user.id, alcoholCheckMatch[1]);
      return true;
    }
    json(response, 405, { error: "Méthode non autorisée." });
    return true;
  }

  if (pathname.startsWith(`${apiPrefix}/access-control/key-`) ||
      pathname === `${apiPrefix}/access-control/keys` ||
      /^\/api\/access-control\/keys\/[^/]+\/return$/.test(pathname)) {
    const user = getRequestUser(request, jwtSecret);
    if (!user) {
      json(response, 401, { error: "Connectez-vous pour accéder au suivi des clés." });
      return true;
    }

    if (pathname === `${apiPrefix}/access-control/key-types` && method === "GET") {
      await getKeyTypes(response, pool);
      return true;
    }
    if (pathname === `${apiPrefix}/access-control/key-employees` && method === "GET") {
      await getKeyEmployees(request, response, pool, user.id);
      return true;
    }
    if (pathname === `${apiPrefix}/access-control/keys` && method === "GET") {
      await getKeyTracking(request, response, pool, user.id);
      return true;
    }
    if (pathname === `${apiPrefix}/access-control/keys` && method === "POST") {
      await createKeyTracking(request, response, pool, user.id);
      return true;
    }
    const returnMatch = /^\/api\/access-control\/keys\/([^/]+)\/return$/.exec(pathname);
    if (returnMatch && method === "PATCH") {
      await returnKeyTracking(request, response, pool, user.id, returnMatch[1]);
      return true;
    }
    json(response, 405, { error: "Méthode non autorisée." });
    return true;
  }

  // Délégation de toutes les routes de clés (y compris les habilitations) à keyRoutes
  if (await handleKeyRoutes(request, response, pool, pathname)) return true;

  // Alcootest
  if (pathname === `${apiPrefix}/access-control/breath-tests`) {
    const user = getRequestUser(request, jwtSecret);
    if (!user) {
      json(response, 401, { error: "Connectez-vous pour accéder aux contrôles d'alcoolémie." });
      return true;
    }
    if (method === "GET") {
      await getBreathTests(request, response, pool, user.id);
      return true;
    }
    if (method === "POST") {
      await createBreathTest(request, response, pool, user.id);
      return true;
    }
    json(response, 405, { error: "Méthode non autorisée." });
    return true;
  }

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
