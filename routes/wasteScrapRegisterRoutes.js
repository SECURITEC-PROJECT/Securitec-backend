import { getRequestUser } from "../utils/auth.js";
import { json, readJson } from "../utils/helpers.js";

const definitions = {
  "/api/waste-register": { table: "registre_ordures", kind: "ordures", hasScrapFields: false },
  "/api/scrap-register": { table: "registre_ferrailles", kind: "ferrailles", hasScrapFields: true },
};
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const text = (value, max = 5000) => typeof value === "string" ? value.trim().slice(0, max) : "";

function validDate(value) {
  if (!datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

async function getAccount(pool, userId) {
  const result = await pool.query(
    "SELECT id,site_id AS \"siteId\",role FROM utilisateur WHERE id=$1::uuid AND actif=true",
    [userId],
  );
  if (!result.rows[0]) throw Object.assign(new Error("Utilisateur introuvable."), { status: 401 });
  return result.rows[0];
}

async function resolveSite(pool, account, requestedSiteId) {
  const siteId = account.siteId && account.role !== 1 ? account.siteId : text(requestedSiteId, 36);
  if (!uuidPattern.test(siteId || "")) throw Object.assign(new Error("Sélectionnez un site."), { status: 400 });
  const result = await pool.query("SELECT id FROM site WHERE id=$1::uuid AND actif=true", [siteId]);
  if (!result.rows[0]) throw Object.assign(new Error("Site introuvable ou archivé."), { status: 404 });
  return result.rows[0].id;
}

function readValues(body, hasScrapFields) {
  const date = text(body.date, 10);
  const heure = text(body.heure, 5);
  const matricule = text(body.matricule, 50);
  const designation = text(body.designation);
  const nombre = hasScrapFields ? Number(body.nombre) : null;
  const motif = hasScrapFields ? text(body.motif) : null;
  if (!validDate(date) || !timePattern.test(heure) || !matricule || !designation
    || (hasScrapFields && (!Number.isSafeInteger(nombre) || nombre < 1 || nombre > 1000000 || !motif))) {
    throw Object.assign(
      new Error(hasScrapFields
        ? "La date, l’heure, le matricule, la désignation, le nombre et le motif sont obligatoires."
        : "La date, l’heure, le matricule et la désignation sont obligatoires."),
      { status: 400 },
    );
  }
  return { date, heure, matricule, designation, nombre, motif };
}

async function resolveEmployee(pool, matricule, siteId, includeInactive = false) {
  const result = await pool.query(
    `SELECT prenom,role AS section
     FROM employe
     WHERE UPPER(BTRIM(matricule))=UPPER($1) AND site_id=$2::uuid
       AND (actif=true OR $3::boolean=true)
     LIMIT 1`,
    [matricule, siteId, includeInactive],
  );
  if (!result.rows[0]) throw Object.assign(new Error("Sélectionnez un employé actif de ce site."), { status: 400 });
  return result.rows[0];
}

const columns = `id,date_operation::text AS date,to_char(heure,'HH24:MI') AS heure,
  prenom,matricule,section,designation`;

export async function handleWasteScrapRegisterRoutes(request, response, pool, pathname, jwtSecret) {
  const definitionEntry = Object.entries(definitions).find(([base]) => pathname === base || pathname.startsWith(`${base}/`));
  if (!definitionEntry) return false;
  const [basePath, definition] = definitionEntry;
  const entryId = pathname === basePath ? "" : pathname.slice(basePath.length + 1);
  const entryMatch = entryId ? [pathname, entryId] : null;
  if (pathname !== basePath && !entryMatch) return false;

  try {
    const user = getRequestUser(request, jwtSecret);
    if (!user) throw Object.assign(new Error("Connectez-vous pour accéder au registre."), { status: 401 });
    const account = await getAccount(pool, user.id);
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (request.method === "GET" && pathname === basePath) {
      const siteId = await resolveSite(pool, account, url.searchParams.get("siteId"));
      const fields = definition.hasScrapFields ? `${columns},nombre,motif` : columns;
      const result = await pool.query(
        `SELECT ${fields},site_id AS "siteId"
         FROM ${definition.table} WHERE site_id=$1::uuid
         ORDER BY date_operation DESC,heure DESC,cree_le DESC LIMIT 1000`,
        [siteId],
      );
      json(response, 200, { entries: result.rows });
      return true;
    }

    if ((request.method === "POST" && pathname === basePath) || (request.method === "PUT" && entryMatch)) {
      if (entryMatch && !uuidPattern.test(entryMatch[1])) {
        json(response, 404, { error: "Enregistrement introuvable." });
        return true;
      }
      const body = await readJson(request);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw Object.assign(new Error("Données de l’enregistrement invalides."), { status: 400 });
      }
      const values = readValues(body, definition.hasScrapFields);
      const siteId = await resolveSite(pool, account, body.siteId || url.searchParams.get("siteId"));
      const employee = await resolveEmployee(pool, values.matricule, siteId, request.method === "PUT");
      const params = definition.hasScrapFields
        ? [values.date, values.heure, employee.prenom, values.matricule, employee.section, values.designation, values.nombre, values.motif, siteId, account.id]
        : [values.date, values.heure, employee.prenom, values.matricule, employee.section, values.designation, siteId, account.id];
      const scrapColumns = definition.hasScrapFields ? ",nombre,motif" : "";
      const scrapValues = definition.hasScrapFields ? ",$7,$8" : "";
      const siteParam = definition.hasScrapFields ? 9 : 7;
      const userParam = definition.hasScrapFields ? 10 : 8;

      if (request.method === "POST") {
        const result = await pool.query(
          `INSERT INTO ${definition.table}
            (date_operation,heure,prenom,matricule,section,designation${scrapColumns},site_id,utilisateur_id)
           VALUES ($1::date,$2::time,$3,$4,$5,$6${scrapValues},$${siteParam}::uuid,$${userParam}::uuid)
           RETURNING ${columns}${scrapColumns},site_id AS "siteId"`,
          params,
        );
        json(response, 201, { entry: result.rows[0] });
        return true;
      }

      const updateValues = definition.hasScrapFields
        ? [...params.slice(0, 8), entryMatch[1], siteId]
        : [...params.slice(0, 6), entryMatch[1], siteId];
      const idParam = definition.hasScrapFields ? 9 : 7;
      const updateSiteParam = definition.hasScrapFields ? 10 : 8;
      const result = await pool.query(
        `UPDATE ${definition.table}
         SET date_operation=$1::date,heure=$2::time,prenom=$3,matricule=$4,section=$5,designation=$6
           ${definition.hasScrapFields ? ",nombre=$7,motif=$8" : ""}
         WHERE id=$${idParam}::uuid AND site_id=$${updateSiteParam}::uuid
         RETURNING ${columns}${scrapColumns},site_id AS "siteId"`,
        updateValues,
      );
      if (!result.rows[0]) throw Object.assign(new Error("Enregistrement introuvable sur ce site."), { status: 404 });
      json(response, 200, { entry: result.rows[0] });
      return true;
    }

    if (request.method === "DELETE" && entryMatch) {
      if (!uuidPattern.test(entryMatch[1])) {
        json(response, 404, { error: "Enregistrement introuvable." });
        return true;
      }
      const siteId = await resolveSite(pool, account, url.searchParams.get("siteId"));
      const result = await pool.query(
        `DELETE FROM ${definition.table} WHERE id=$1::uuid AND site_id=$2::uuid RETURNING id`,
        [entryMatch[1], siteId],
      );
      if (!result.rows[0]) throw Object.assign(new Error("Enregistrement introuvable sur ce site."), { status: 404 });
      json(response, 200, { id: result.rows[0].id, deleted: true });
      return true;
    }

    json(response, 405, { error: "Méthode non autorisée." });
    return true;
  } catch (error) {
    console.error(`Register ${definition.kind} failed:`, error.code || error.name, error.message || "");
    json(response, error.status || 500, {
      error: error.status ? error.message : "Opération sur le registre impossible.",
    });
    return true;
  }
}
