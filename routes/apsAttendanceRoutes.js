import { getRequestUser } from "../utils/auth.js";
import { json, readJson } from "../utils/helpers.js";

const routePath = "/api/aps-attendance";
const configurationPath = `${routePath}/posts`;
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

function validatePostes(rawPostes) {
  if (!Array.isArray(rawPostes) || rawPostes.length > 100) {
    throw Object.assign(new Error("Un maximum de 100 postes peut être enregistré."), { status: 400 });
  }
  const names = new Set();
  return rawPostes.map((poste) => {
    const name = typeof poste?.name === "string" ? poste.name.trim().replace(/\s+/g, " ").toLocaleUpperCase("fr") : "";
    const count = Number(poste?.count);
    const normalizedName = name.toLocaleUpperCase("fr");
    if (!name || name.length > 160 || names.has(normalizedName)
      || !Number.isInteger(count) || count < 1 || count > 30) {
      throw Object.assign(new Error("Chaque poste doit avoir un nom unique (160 caractères maximum) et un effectif entre 1 et 30."), { status: 400 });
    }
    names.add(normalizedName);
    return { name, count };
  });
}

async function validateAdminPostes(pool, siteId, rawPostes) {
  const postes = validatePostes(rawPostes);
  const result = await pool.query(
    "SELECT nom FROM poste WHERE site_id=$1::uuid AND actif=true",
    [siteId],
  );
  const activeNames = new Map(result.rows.map(({ nom }) => [nom.trim().replace(/\s+/g, " ").toLocaleUpperCase("fr"), nom]));
  return postes.map((poste) => {
    const adminName = activeNames.get(poste.name.toLocaleUpperCase("fr"));
    if (!adminName) {
      throw Object.assign(new Error(`Le poste « ${poste.name} » n’est pas actif dans la gestion de l’administration.`), { status: 400 });
    }
    return { ...poste, name: adminName };
  });
}

async function loadAdminPostConfiguration(pool, siteId, service) {
  const [adminPosts, savedConfiguration] = await Promise.all([
    pool.query(
      "SELECT nom FROM poste WHERE site_id=$1::uuid AND actif=true ORDER BY nom",
      [siteId],
    ),
    pool.query(
      `SELECT postes FROM configuration_postes_aps WHERE site_id=$1::uuid AND service=$2`,
      [siteId, service],
    ),
  ]);
  const savedCounts = new Map((savedConfiguration.rows[0]?.postes ?? []).map(({ name, count }) => [
    String(name).trim().replace(/\s+/g, " ").toLocaleUpperCase("fr"), Number(count),
  ]));
  return adminPosts.rows.map(({ nom }) => ({
    name: nom,
    count: savedCounts.get(nom.trim().replace(/\s+/g, " ").toLocaleUpperCase("fr")) || 1,
  }));
}

async function replacePostConfiguration(client, siteId, service, postes, userId) {
  await client.query(
    `INSERT INTO configuration_postes_aps (site_id, service, postes, utilisateur_id, updated_at)
     VALUES ($1::uuid, $2, $3::jsonb, $4::uuid, NOW())
     ON CONFLICT (site_id, service)
     DO UPDATE SET postes=EXCLUDED.postes, utilisateur_id=EXCLUDED.utilisateur_id, updated_at=NOW()`,
    [siteId, service, JSON.stringify(postes), userId],
  );
}

export async function handleApsAttendanceRoutes(request, response, pool, pathname, jwtSecret) {
  if (pathname !== routePath && pathname !== configurationPath) return false;
  const user = getRequestUser(request, jwtSecret);
  if (!user) {
    json(response, 401, { error: "Connectez-vous pour acceder au pointage APS." });
    return true;
  }

  if (pathname === configurationPath) {
    if (request.method === "GET") {
      try {
        const account = await getAccount(pool, user.id);
        if (!account) throw Object.assign(new Error("Utilisateur introuvable."), { status: 401 });
        const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
        const service = url.searchParams.get("service") || "";
        if (!services.has(service)) {
          json(response, 400, { error: "Service invalide." });
          return true;
        }
        const siteId = await resolveSite(pool, account, url.searchParams.get("siteId"));
        const postes = await loadAdminPostConfiguration(pool, siteId, service);
        json(response, 200, { postes });
      } catch (error) {
        json(response, error.status || 500, { error: error.message || "Chargement des postes APS impossible." });
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
      const service = typeof body?.service === "string" ? body.service : "";
      if (!services.has(service) || !Array.isArray(body?.postes)) {
        json(response, 400, { error: "Service et postes sont obligatoires." });
        return true;
      }
      const siteId = await resolveSite(pool, account, body.siteId);
      const postes = await validateAdminPostes(pool, siteId, body.postes);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await replacePostConfiguration(client, siteId, service, postes, account.id);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      json(response, 200, { saved: true, postes });
    } catch (error) {
      json(response, error.status || 500, { error: error.message || "Enregistrement des postes APS impossible." });
    }
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
      const postes = await loadAdminPostConfiguration(pool, siteId, service);
      const data = result.rows[0]?.data ?? null;
      json(response, 200, {
        data,
        postes,
      });
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
    const rawPostes = Array.isArray(body.postes) ? body.postes : Object.entries(data).map(([name, agents]) => ({ name, count: Array.isArray(agents) ? agents.length : 0 }));
    const siteId = await resolveSite(pool, account, body.siteId);
    const postes = await validateAdminPostes(pool, siteId, rawPostes);
    const normalizedData = {};
    for (const poste of postes) {
      const agents = data[poste.name];
      if (!Array.isArray(agents) || agents.length !== poste.count) {
        json(response, 400, { error: `Les lignes du poste « ${poste.name} » ne correspondent pas à son effectif.` });
        return true;
      }
      normalizedData[poste.name] = agents;
    }
    const table = service === "jour" ? "pointage_aps_jour" : "pointage_aps_nuit";
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `INSERT INTO ${table} (site_id, date_pointage, data, utilisateur_id, updated_at)
         VALUES ($1::uuid, $2::date, $3::jsonb, $4::uuid, NOW())
         ON CONFLICT (site_id, date_pointage)
         DO UPDATE SET data=EXCLUDED.data, utilisateur_id=EXCLUDED.utilisateur_id, updated_at=NOW()
         RETURNING updated_at AS "updatedAt"`,
        [siteId, date, JSON.stringify(normalizedData), account.id],
      );
      await replacePostConfiguration(client, siteId, service, postes, account.id);
      await client.query("COMMIT");
      json(response, 200, { saved: true, updatedAt: result.rows[0].updatedAt });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    json(response, error.status || 500, { error: error.message || "Enregistrement du pointage impossible." });
  }
  return true;
}
