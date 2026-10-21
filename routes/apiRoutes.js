import { json, logNetworkCauses } from "../utils/helpers.js";
import { handleControlRoutes } from "./controlRoutes.js";
import { handleAuthRoutes } from "./authRoutes.js";
import { handleFluxRoutes } from "./fluxRoutes.js";
import { handleHandoverRoutes } from "./handoverRoutes.js";
import { handleMainCouranteRoutes } from "./mainCouranteRoutes.js";
import { handlePatrolRoutes } from "./patrolRoutes.js";
import { handleShiftRoutes } from "./shiftRoutes.js";
import { handleSiteRoutes } from "./siteRoutes.js";
import { handleVigilanceRoutes } from "./vigilanceRoutes.js";

const apiPrefix = "/api";

export async function handleApiRoutes(request, response, pool, jwtSecret) {
  const urlObj = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const pathname = urlObj.pathname;

  if (await handleAuthRoutes(request, response, pool, pathname, jwtSecret)) return true;
  if (await handleSiteRoutes(request, response, pool, pathname, jwtSecret)) return true;
  if (await handleShiftRoutes(request, response, pool, pathname, jwtSecret)) return true;
  if (await handleHandoverRoutes(request, response, pool, pathname, jwtSecret)) return true;
  if (await handleControlRoutes(request, response, pool, pathname, jwtSecret)) return true;
  if (await handleFluxRoutes(request, response, pool, pathname, jwtSecret)) return true;
  if (await handlePatrolRoutes(request, response, pool, pathname, jwtSecret)) return true;
  if (await handleVigilanceRoutes(request, response, pool, pathname, jwtSecret)) return true;
  if (await handleMainCouranteRoutes(request, response, pool, pathname)) return true;

  if (request.method === "GET" && pathname === `${apiPrefix}/health`) {
    try {
      await pool.query("SELECT 1");
      json(response, 200, { api: "ok", database: "connected" });
    } catch (error) {
      console.error("Connexion PostgreSQL impossible:", error.code || error.name || "ERREUR", error.message || "");
      logNetworkCauses(error);
      json(response, 503, { api: "ok", database: "unavailable" });
    }
    return true;
  }

  return false;
}
