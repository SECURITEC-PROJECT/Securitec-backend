import { json, logNetworkCauses } from "../utils/helpers.js";
import { getRequestUser } from "../utils/auth.js";
import { handleAnomalieRoutes } from "./anomalieRoutes.js";
import { handleAuthRoutes } from "./authRoutes.js";
import { handleCameraRoutes } from "./cameraRoutes.js";
import { handleControlRoutes } from "./controlRoutes.js";
import { handleCourrierRoutes } from "./courrierRoutes.js";
import { handleConsigneJournalRoutes } from "./consigneJournalRoutes.js";
import { handleCrjRoutes } from "./crjRoutes.js";
import { handleEmployeeRoutes } from "./employeeRoutes.js";
import { handleEntryExitRoutes } from "./entryExitRoutes.js";
import { handleFluxRoutes } from "./fluxRoutes.js";
import { handleHandoverRoutes } from "./handoverRoutes.js";
import { handleMainCouranteRoutes } from "./mainCouranteRoutes.js";
import { handleMaterielsSousTraitantRoutes } from "./materielsSousTraitantRoutes.js";
import { handleMaterielsStarRoutes } from "./materielsStarRoutes.js";
import { handleApsAttendanceRoutes } from "./apsAttendanceRoutes.js";
import { handlePatrolRoutes } from "./patrolRoutes.js";
import { handleShiftRoutes } from "./shiftRoutes.js";
import { handleSiteRoutes } from "./siteRoutes.js";
import { handleVigilanceRoutes } from "./vigilanceRoutes.js";
import { handleTruckChecklistRoutes } from "./truckChecklistRoutes.js";
import { handleUserRoutes } from "./userRoutes.js";

const apiPrefix = "/api";

export async function handleApiRoutes(request, response, pool, jwtSecret) {
  const urlObj = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const pathname = urlObj.pathname;

  const authenticatedUser = getRequestUser(request, jwtSecret);
  if (authenticatedUser) {
    const active = await pool.query("SELECT 1 FROM utilisateur WHERE id=$1::uuid AND actif=true LIMIT 1", [authenticatedUser.id]);
    if (!active.rows[0]) return json(response, 401, { error: "Ce compte est désactivé ou introuvable." });
  }

  if (await handleAuthRoutes(request, response, pool, pathname, jwtSecret)) return true;
  if (await handleUserRoutes(request, response, pool, pathname, jwtSecret)) return true;
  if (await handleEmployeeRoutes(request, response, pool, pathname, jwtSecret)) return true;
  if (await handleCameraRoutes(request, response, pool, pathname, jwtSecret)) return true;
  if (await handleSiteRoutes(request, response, pool, pathname, jwtSecret)) return true;
  if (await handleEntryExitRoutes(request, response, pool, pathname, jwtSecret)) return true;
  if (await handleShiftRoutes(request, response, pool, pathname, jwtSecret)) return true;
  if (await handleHandoverRoutes(request, response, pool, pathname, jwtSecret)) return true;
  if (await handleControlRoutes(request, response, pool, pathname, jwtSecret)) return true;
  if (await handleCourrierRoutes(request, response, pool, pathname, jwtSecret)) return true;
  if (await handleMaterielsSousTraitantRoutes(request, response, pool, pathname, jwtSecret)) return true;
  if (await handleMaterielsStarRoutes(request, response, pool, pathname, jwtSecret)) return true;
  if (await handleConsigneJournalRoutes(request, response, pool, pathname, jwtSecret)) return true;
  if (await handleFluxRoutes(request, response, pool, pathname, jwtSecret)) return true;
  if (await handleTruckChecklistRoutes(request, response, pool, pathname, jwtSecret)) return true;
  if (await handlePatrolRoutes(request, response, pool, pathname, jwtSecret)) return true;
  if (await handleVigilanceRoutes(request, response, pool, pathname, jwtSecret)) return true;
  if (await handleMainCouranteRoutes(request, response, pool, pathname, jwtSecret)) return true;
  if (await handleApsAttendanceRoutes(request, response, pool, pathname, jwtSecret)) return true;
  if (await handleCrjRoutes(request, response, pool, pathname, jwtSecret)) return true;
  if (await handleAnomalieRoutes(request, response, pool, pathname, jwtSecret)) return true;

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
