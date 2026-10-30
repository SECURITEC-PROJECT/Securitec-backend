import { getRequestUser } from "../utils/auth.js";
import { json, readJson } from "../utils/helpers.js";
import { resolveServicePosteId } from "../utils/priseDePoste.js";

const collectionPath = "/api/object-declarations";
const entryPath = /^\/api\/object-declarations\/([0-9a-f-]+)$/i;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const text = (value, max = 500) => typeof value === "string" ? value.trim().slice(0, max) : "";

function validateData(value) {
  const data = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const normalized = {
    date: text(data.date, 10),
    entryTime: text(data.entryTime, 5),
    exitTime: text(data.exitTime, 5),
    firstName: text(data.firstName, 255),
    company: text(data.company, 255),
    vehicleNumber: text(data.vehicleNumber, 100),
    objects: text(data.objects, 4000),
    entryAgent: text(data.entryAgent, 255),
    exitAgent: text(data.exitAgent, 255),
    referenceNumber: text(data.referenceNumber, 40),
  };
  const parsedDate = datePattern.test(normalized.date) ? new Date(`${normalized.date}T00:00:00.000Z`) : null;
  if (!parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== normalized.date
    || !normalized.firstName || !normalized.company || !normalized.vehicleNumber || !normalized.objects
    || !normalized.entryTime || !normalized.exitTime || !normalized.referenceNumber
    || !timePattern.test(normalized.entryTime) || !timePattern.test(normalized.exitTime)) {
    throw Object.assign(new Error("Renseignez tous les champs de la déclaration, sauf les signatures, et vérifiez la date ainsi que les heures."), { status: 400 });
  }
  return normalized;
}

async function getAccount(pool, userId) {
  const result = await pool.query("SELECT id, site_id, role FROM utilisateur WHERE id=$1::uuid AND actif=true LIMIT 1", [userId]);
  if (!result.rows[0]) throw Object.assign(new Error("Utilisateur introuvable."), { status: 401 });
  return result.rows[0];
}

async function resolveSite(pool, account, requestedSiteId) {
  if (account.site_id && account.role !== 1) return account.site_id;
  const siteId = text(requestedSiteId, 36);
  if (!uuidPattern.test(siteId)) throw Object.assign(new Error("Sélectionnez un site."), { status: 400 });
  const result = await pool.query("SELECT id FROM site WHERE id=$1::uuid AND actif=true LIMIT 1", [siteId]);
  if (!result.rows[0]) throw Object.assign(new Error("Site introuvable ou inactif."), { status: 404 });
  return result.rows[0].id;
}

const selection = `SELECT d.id, d.donnees AS data, d.site_id AS "siteId", s.nom AS "siteName",
  d.cree_le AS "createdAt", d.modifie_le AS "updatedAt", d.service_poste_id AS "servicePosteId",
  sp.poste_id AS "posteId", po.nom AS "posteNom", sp.shift_type AS "shiftType"
  FROM declaration_objet d JOIN site s ON s.id=d.site_id
  LEFT JOIN service_poste sp ON sp.id=d.service_poste_id
  LEFT JOIN poste po ON po.id=sp.poste_id`;

export async function handleObjectDeclarationRoutes(request, response, pool, pathname, jwtSecret) {
  const entryMatch = entryPath.exec(pathname);
  if (pathname !== collectionPath && !entryMatch) return false;
  const user = getRequestUser(request, jwtSecret);
  if (!user) {
    json(response, 401, { error: "Connectez-vous pour gérer les déclarations d’objets." });
    return true;
  }

  try {
    const account = await getAccount(pool, user.id);
    if (request.method === "GET" && pathname === collectionPath) {
      const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
      let siteId = account.site_id && account.role !== 1 ? account.site_id : text(url.searchParams.get("siteId"), 36);
      if (!siteId) { json(response, 200, { entries: [] }); return true; }
      siteId = await resolveSite(pool, account, siteId);
      const result = await pool.query(
        `${selection} WHERE d.site_id=$1::uuid ORDER BY d.date_operation DESC, d.cree_le DESC LIMIT 1000`,
        [siteId],
      );
      json(response, 200, { entries: result.rows });
      return true;
    }

    if (request.method === "POST" && pathname === collectionPath) {
      const body = await readJson(request);
      const data = validateData(body.data);
      const siteId = await resolveSite(pool, account, body.siteId);
      const servicePosteId = await resolveServicePosteId(pool, siteId, body.priseDePosteId, body.posteId || null);
      const duplicate = await pool.query(
        `SELECT id FROM declaration_objet
         WHERE site_id=$1::uuid AND lower(donnees->>'referenceNumber')=lower($2)
         LIMIT 1`,
        [siteId, data.referenceNumber],
      );
      if (duplicate.rows[0]) { json(response, 409, { error: "Ce numéro de fiche est déjà utilisé sur ce site." }); return true; }
      const result = await pool.query(
        `INSERT INTO declaration_objet (date_operation, donnees, site_id, utilisateur_id, service_poste_id)
         VALUES ($1::date, $2::jsonb, $3::uuid, $4::uuid, $5::uuid)
         RETURNING id, donnees AS data, site_id AS "siteId", cree_le AS "createdAt", modifie_le AS "updatedAt", service_poste_id AS "servicePosteId"`,
        [data.date, JSON.stringify(data), siteId, account.id, servicePosteId],
      );
      const site = await pool.query("SELECT nom AS \"siteName\" FROM site WHERE id=$1::uuid", [siteId]);
      json(response, 201, { entry: { ...result.rows[0], siteName: site.rows[0].siteName } });
      return true;
    }

    if (request.method === "PUT" && entryMatch) {
      if (!uuidPattern.test(entryMatch[1])) { json(response, 404, { error: "Déclaration introuvable." }); return true; }
      const body = await readJson(request);
      const data = validateData(body.data);
      const siteId = await resolveSite(pool, account, body.siteId);
      const duplicate = await pool.query(
        `SELECT id FROM declaration_objet
         WHERE site_id=$1::uuid AND lower(donnees->>'referenceNumber')=lower($2) AND id<>$3::uuid
         LIMIT 1`,
        [siteId, data.referenceNumber, entryMatch[1]],
      );
      if (duplicate.rows[0]) { json(response, 409, { error: "Ce numéro de fiche est déjà utilisé sur ce site." }); return true; }
      const result = await pool.query(
        `UPDATE declaration_objet
         SET date_operation=$2::date, donnees=$3::jsonb, modifie_le=CURRENT_TIMESTAMP
         WHERE id=$1::uuid AND site_id=$4::uuid
         RETURNING id, donnees AS data, site_id AS "siteId", cree_le AS "createdAt", modifie_le AS "updatedAt", service_poste_id AS "servicePosteId"`,
        [entryMatch[1], data.date, JSON.stringify(data), siteId],
      );
      if (!result.rows[0]) { json(response, 404, { error: "Déclaration introuvable sur ce site." }); return true; }
      const site = await pool.query("SELECT nom AS \"siteName\" FROM site WHERE id=$1::uuid", [siteId]);
      json(response, 200, { entry: { ...result.rows[0], siteName: site.rows[0].siteName } });
      return true;
    }

    if (request.method === "DELETE" && entryMatch) {
      if (!uuidPattern.test(entryMatch[1])) { json(response, 404, { error: "Déclaration introuvable." }); return true; }
      const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
      const siteId = await resolveSite(pool, account, url.searchParams.get("siteId"));
      const result = await pool.query(
        "DELETE FROM declaration_objet WHERE id=$1::uuid AND site_id=$2::uuid RETURNING id",
        [entryMatch[1], siteId],
      );
      if (!result.rows[0]) { json(response, 404, { error: "Déclaration introuvable sur ce site." }); return true; }
      json(response, 200, { id: result.rows[0].id, deleted: true });
      return true;
    }

    json(response, 405, { error: "Méthode non autorisée." });
  } catch (error) {
    console.error("Route déclarations objets:", error.code || error.name, error.message || "");
    const status = error.status || (error.code === "23505" ? 409 : 500);
    json(response, status, { error: error.status
      ? error.message
      : status === 409
        ? "Ce numéro de fiche est déjà utilisé sur ce site."
        : "Opération sur les déclarations d’objets impossible." });
  }
  return true;
}
