import { getRequestUser } from "../utils/auth.js";
import { json, readJson } from "../utils/helpers.js";

const routePath = "/api/aps-attendance";
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const services = new Set(["jour", "nuit"]);

async function getAccount(pool, userId) {
  const result = await pool.query("SELECT id, role, site_id FROM utilisateur WHERE id=$1::uuid AND actif=true LIMIT 1", [userId]);
  return result.rows[0] || null;
}

async function resolveSite(pool, account, requestedSiteId) {
  if (account.site_id && account.role !== 1) return account.site_id;
  if (!requestedSiteId) throw Object.assign(new Error("Selectionnez un site."), { status: 400 });
  const result = await pool.query("SELECT id FROM site WHERE id=$1::uuid AND actif=true LIMIT 1", [requestedSiteId]);
  if (!result.rows[0]) throw Object.assign(new Error("Site introuvable ou inactif."), { status: 404 });
  return result.rows[0].id;
}

export async function handleApsAttendanceRoutes(request, response, pool, pathname, jwtSecret) {
  if (pathname !== routePath) return false;
  const user = getRequestUser(request, jwtSecret);
  if (!user) {
    json(response, 401, { error: "Connectez-vous pour acceder au pointage APS." });
    return true;
  }

  if (request.method === "GET") {
    try {
      const account = await getAccount(pool, user.id);
      if (!account) throw Object.assign(new Error("Utilisateur introuvable."), { status: 401 });
      const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
      const date = url.searchParams.get("date") || "";
      const service = url.searchParams.get("service") || "";
      if (!datePattern.test(date) || !services.has(service)) {
        json(response, 400, { error: "Date et service invalides." });
        return true;
      }
      const siteId = await resolveSite(pool, account, url.searchParams.get("siteId"));
      const table = service === "jour" ? "pointage_aps_jour" : "pointage_aps_nuit";
      const result = await pool.query(
        `SELECT data FROM ${table} WHERE site_id=$1::uuid AND date_pointage=$2::date LIMIT 1`,
        [siteId, date],
      );
      json(response, 200, { data: result.rows[0]?.data ?? null });
    } catch (error) {
      json(response, error.status || 500, { error: error.message || "Chargement du pointage impossible." });
    }
    return true;
  }

  if (request.method !== "PUT") {
    json(response, 405, { error: "Methode non autorisee." });
    return true;
  }

  try {
    const account = await getAccount(pool, user.id);
    if (!account) throw Object.assign(new Error("Utilisateur introuvable."), { status: 401 });
    const body = await readJson(request);
    const date = typeof body?.date === "string" ? body.date : "";
    const service = typeof body?.service === "string" ? body.service : "";
    const data = body?.data;
    if (!datePattern.test(date) || !services.has(service) || !data || typeof data !== "object" || Array.isArray(data)) {
      json(response, 400, { error: "Date, service et donnees du pointage sont obligatoires." });
      return true;
    }
    const siteId = await resolveSite(pool, account, body.siteId);
    const table = service === "jour" ? "pointage_aps_jour" : "pointage_aps_nuit";
    const result = await pool.query(
      `INSERT INTO ${table} (site_id, date_pointage, data, utilisateur_id, updated_at)
       VALUES ($1::uuid, $2::date, $3::jsonb, $4::uuid, NOW())
       ON CONFLICT (site_id, date_pointage)
       DO UPDATE SET data=EXCLUDED.data, utilisateur_id=EXCLUDED.utilisateur_id, updated_at=NOW()
       RETURNING updated_at AS "updatedAt"`,
      [siteId, date, JSON.stringify(data), account.id],
    );
    json(response, 200, { saved: true, updatedAt: result.rows[0].updatedAt });
  } catch (error) {
    json(response, error.status || 500, { error: error.message || "Enregistrement du pointage impossible." });
  }
  return true;
}
