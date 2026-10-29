import { getRequestUser } from "../utils/auth.js";
import { json, readJson } from "../utils/helpers.js";

const routePath = "/api/aps-movements";
const configurationPath = `${routePath}/posts`;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const services = new Set(["jour", "nuit"]);

function validDate(value) {
  if (!datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

async function getAccount(pool, userId) {
  const result = await pool.query(
    "SELECT id,role,site_id AS \"siteId\" FROM utilisateur WHERE id=$1::uuid AND actif=true LIMIT 1",
    [userId],
  );
  return result.rows[0] || null;
}

async function resolveSite(pool, account, requestedSiteId) {
  const siteId = account.siteId && account.role !== 1 ? account.siteId : requestedSiteId;
  if (typeof siteId !== "string" || !uuidPattern.test(siteId)) {
    throw Object.assign(new Error("Sélectionnez un site."), { status: 400 });
  }
  const result = await pool.query(
    "SELECT id FROM site WHERE id=$1::uuid AND actif=true LIMIT 1",
    [siteId],
  );
  if (!result.rows[0]) throw Object.assign(new Error("Site introuvable ou inactif."), { status: 404 });
  return result.rows[0].id;
}

function readService(value) {
  if (typeof value !== "string" || !services.has(value)) {
    throw Object.assign(new Error("Service invalide."), { status: 400 });
  }
  return value;
}

function validatePostes(rawPostes) {
  if (!Array.isArray(rawPostes) || rawPostes.length > 100) {
    throw Object.assign(new Error("Un maximum de 100 postes peut être enregistré."), { status: 400 });
  }
  const names = new Set();
  return rawPostes.map((poste) => {
    const name = typeof poste?.name === "string"
      ? poste.name.trim().replace(/\s+/g, " ").toLocaleUpperCase("fr")
      : "";
    const count = Number(poste?.count);
    if (!name || name.length > 80 || names.has(name)
      || !Number.isInteger(count) || count < 1 || count > 30) {
      throw Object.assign(new Error("Chaque poste doit avoir un nom unique et un effectif entre 1 et 30."), { status: 400 });
    }
    names.add(name);
    return { name, count };
  });
}

function validateData(rawData, postes) {
  if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) {
    throw Object.assign(new Error("Les données du module APS sont invalides."), { status: 400 });
  }
  const normalized = {};
  for (const poste of postes) {
    const rows = rawData[poste.name];
    if (!Array.isArray(rows) || rows.length !== poste.count) {
      throw Object.assign(new Error(`Les lignes du poste « ${poste.name} » ne correspondent pas à son effectif.`), { status: 400 });
    }
    normalized[poste.name] = rows.map((row) => {
      if (!row || typeof row !== "object" || Array.isArray(row)
        || (row.nom != null && typeof row.nom !== "string")
        || (row.matricule != null && typeof row.matricule !== "string")) {
        throw Object.assign(new Error("Chaque agent doit contenir un nom et un matricule valides."), { status: 400 });
      }
      return {
        nom: (row.nom || "").trim().slice(0, 100),
        matricule: (row.matricule || "").trim().slice(0, 50),
      };
    });
  }
  return normalized;
}

async function saveConfiguration(client, siteId, postes, userId) {
  await client.query(
    `INSERT INTO configuration_postes_mouvement_aps (site_id,postes,utilisateur_id,updated_at)
     VALUES ($1::uuid,$2::jsonb,$3::uuid,NOW())
     ON CONFLICT (site_id)
     DO UPDATE SET postes=EXCLUDED.postes,utilisateur_id=EXCLUDED.utilisateur_id,updated_at=NOW()`,
    [siteId, JSON.stringify(postes), userId],
  );
}

export async function handleApsMovementRoutes(request, response, pool, pathname, jwtSecret) {
  if (pathname !== routePath && pathname !== configurationPath) return false;
  const user = getRequestUser(request, jwtSecret);
  if (!user) {
    json(response, 401, { error: "Connectez-vous pour accéder aux mouvements APS." });
    return true;
  }

  try {
    const account = await getAccount(pool, user.id);
    if (!account) throw Object.assign(new Error("Utilisateur introuvable."), { status: 401 });
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (request.method === "GET" && pathname === routePath) {
      const date = url.searchParams.get("date") || "";
      const service = readService(url.searchParams.get("service"));
      if (!validDate(date)) throw Object.assign(new Error("Date invalide."), { status: 400 });
      const siteId = await resolveSite(pool, account, url.searchParams.get("siteId"));
      const [movement, configuration] = await Promise.all([
        pool.query(
          "SELECT data FROM mouvement_aps WHERE site_id=$1::uuid AND date_pointage=$2::date AND service=$3 LIMIT 1",
          [siteId, date, service],
        ),
        pool.query(
          "SELECT postes FROM configuration_postes_mouvement_aps WHERE site_id=$1::uuid LIMIT 1",
          [siteId],
        ),
      ]);
      json(response, 200, {
        data: movement.rows[0]?.data ?? null,
        postes: configuration.rows[0]?.postes ?? null,
      });
      return true;
    }

    if (request.method === "PUT" && pathname === configurationPath) {
      const body = await readJson(request);
      const postes = validatePostes(body?.postes);
      const siteId = await resolveSite(pool, account, body?.siteId);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await saveConfiguration(client, siteId, postes, account.id);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      json(response, 200, { saved: true, postes });
      return true;
    }

    if (request.method === "PUT" && pathname === routePath) {
      const body = await readJson(request);
      const date = typeof body?.date === "string" ? body.date : "";
      const service = readService(body?.service);
      if (!validDate(date)) throw Object.assign(new Error("Date invalide."), { status: 400 });
      const siteId = await resolveSite(pool, account, body?.siteId);
      const postes = validatePostes(body?.postes);
      const data = validateData(body?.data, postes);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query(
          `INSERT INTO mouvement_aps (site_id,date_pointage,service,data,utilisateur_id,updated_at)
           VALUES ($1::uuid,$2::date,$3,$4::jsonb,$5::uuid,NOW())
           ON CONFLICT (site_id,date_pointage,service)
           DO UPDATE SET data=EXCLUDED.data,utilisateur_id=EXCLUDED.utilisateur_id,updated_at=NOW()
           RETURNING updated_at AS "updatedAt"`,
          [siteId, date, service, JSON.stringify(data), account.id],
        );
        await saveConfiguration(client, siteId, postes, account.id);
        await client.query("COMMIT");
        json(response, 200, { saved: true, updatedAt: result.rows[0].updatedAt });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      return true;
    }

    json(response, 405, { error: "Méthode non autorisée." });
    return true;
  } catch (error) {
    console.error("APS movement module failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, {
      error: error.status ? error.message : "Opération sur les mouvements APS impossible.",
    });
    return true;
  }
}
