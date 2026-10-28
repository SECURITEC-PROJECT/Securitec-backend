import { getRequestUser } from "../utils/auth.js";
import { json, readJson } from "../utils/helpers.js";

const collectionPath = "/api/materiels-star";
const entryPath = /^\/api\/materiels-star\/([0-9a-f-]+)$/i;
const exitPath = /^\/api\/materiels-star\/([0-9a-f-]+)\/sortie$/i;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const text = (value, max = 255) => typeof value === "string" ? value.trim().slice(0, max) : "";

const validDate = (value) => {
  if (!datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const readEntry = (body) => {
  const date = text(body.date, 10);
  const heureEntree = text(body.heureEntree, 5);
  const prenom = text(body.prenom);
  const matricule = text(body.matricule, 100);
  const items = Array.isArray(body.items) && body.items.length <= 100
    ? body.items.map((item) => ({
      designation: text(item?.designation),
      nombre: Number(item?.nombre),
    }))
    : [];
  if (!validDate(date) || !timePattern.test(heureEntree) || !prenom || !matricule
    || items.length === 0 || items.some((item) =>
      !item.designation || !Number.isSafeInteger(item.nombre) || item.nombre < 1 || item.nombre > 1000000,
    )) {
    throw Object.assign(new Error("Vérifiez la date, l’heure d’entrée, le prénom, le matricule et les matériels avec leurs nombres."), { status: 400 });
  }
  return { date, heureEntree, prenom, matricule, items };
};

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

const entrySelect = `SELECT m.id, m.date_operation::text AS date,
  to_char(m.heure_entree, 'HH24:MI') AS "heureEntree", m.prenom, m.matricule,
  m.materiels AS items, to_char(m.heure_sortie, 'HH24:MI') AS "heureSortie",
  m.site_id AS "siteId", s.nom AS "siteName"
  FROM materiel_star m JOIN site s ON s.id=m.site_id`;

export async function handleMaterielsStarRoutes(request, response, pool, pathname, jwtSecret) {
  const entryMatch = entryPath.exec(pathname);
  const exitMatch = exitPath.exec(pathname);
  if (pathname !== collectionPath && !entryMatch && !exitMatch) return false;
  const user = getRequestUser(request, jwtSecret);
  if (!user) {
    json(response, 401, { error: "Connectez-vous pour gérer le registre des matériels Star." });
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
        `${entrySelect} WHERE m.site_id=$1::uuid ORDER BY m.date_operation DESC, m.heure_entree DESC LIMIT 1000`,
        [siteId],
      );
      json(response, 200, { entries: result.rows });
      return true;
    }

    if (request.method === "POST" && pathname === collectionPath) {
      const body = await readJson(request);
      const entry = readEntry(body);
      const siteId = await resolveSite(pool, account, body.siteId);
      const result = await pool.query(
        `INSERT INTO materiel_star (date_operation, heure_entree, prenom, matricule, materiels, site_id, utilisateur_id)
         VALUES ($1::date, $2::time, $3, $4, $5::jsonb, $6::uuid, $7::uuid)
         RETURNING id, date_operation::text AS date, to_char(heure_entree, 'HH24:MI') AS "heureEntree",
                   prenom, matricule, materiels AS items, to_char(heure_sortie, 'HH24:MI') AS "heureSortie",
                   site_id AS "siteId"`,
        [entry.date, entry.heureEntree, entry.prenom, entry.matricule, JSON.stringify(entry.items), siteId, account.id],
      );
      const site = await pool.query("SELECT nom AS \"siteName\" FROM site WHERE id=$1::uuid", [siteId]);
      json(response, 201, { entry: { ...result.rows[0], siteName: site.rows[0].siteName } });
      return true;
    }

    if (request.method === "PUT" && entryMatch) {
      if (!uuidPattern.test(entryMatch[1])) { json(response, 404, { error: "Mouvement introuvable." }); return true; }
      const body = await readJson(request);
      const entry = readEntry(body);
      const siteId = await resolveSite(pool, account, body.siteId);
      const result = await pool.query(
        `UPDATE materiel_star
         SET date_operation=$2::date, heure_entree=$3::time, prenom=$4, matricule=$5, materiels=$6::jsonb
         WHERE id=$1::uuid AND site_id=$7::uuid
         RETURNING id, date_operation::text AS date, to_char(heure_entree, 'HH24:MI') AS "heureEntree",
                   prenom, matricule, materiels AS items, to_char(heure_sortie, 'HH24:MI') AS "heureSortie",
                   site_id AS "siteId"`,
        [entryMatch[1], entry.date, entry.heureEntree, entry.prenom, entry.matricule, JSON.stringify(entry.items), siteId],
      );
      if (!result.rows[0]) { json(response, 404, { error: "Mouvement introuvable sur ce site." }); return true; }
      const site = await pool.query("SELECT nom AS \"siteName\" FROM site WHERE id=$1::uuid", [siteId]);
      json(response, 200, { entry: { ...result.rows[0], siteName: site.rows[0].siteName } });
      return true;
    }

    if (request.method === "DELETE" && entryMatch) {
      if (!uuidPattern.test(entryMatch[1])) { json(response, 404, { error: "Mouvement introuvable." }); return true; }
      const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
      const siteId = await resolveSite(pool, account, url.searchParams.get("siteId"));
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const existing = await client.query(
          "SELECT id, heure_sortie FROM materiel_star WHERE id=$1::uuid AND site_id=$2::uuid FOR UPDATE",
          [entryMatch[1], siteId],
        );
        if (!existing.rows[0]) {
          await client.query("ROLLBACK");
          json(response, 404, { error: "Mouvement introuvable sur ce site." });
          return true;
        }
        if (!existing.rows[0].heure_sortie) {
          await client.query("ROLLBACK");
          json(response, 409, { error: "Enregistrez l’heure de sortie avant de supprimer ce mouvement." });
          return true;
        }
        await client.query("DELETE FROM materiel_star WHERE id=$1::uuid AND site_id=$2::uuid", [entryMatch[1], siteId]);
        await client.query("COMMIT");
        json(response, 200, { id: entryMatch[1], deleted: true });
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
      return true;
    }

    if (request.method === "PATCH" && exitMatch) {
      if (!uuidPattern.test(exitMatch[1])) { json(response, 404, { error: "Mouvement introuvable." }); return true; }
      const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
      const siteId = await resolveSite(pool, account, url.searchParams.get("siteId"));
      const result = await pool.query(
        `UPDATE materiel_star
         SET heure_sortie=timezone('Indian/Antananarivo', CURRENT_TIMESTAMP)::time(0)
         WHERE id=$1::uuid AND site_id=$2::uuid AND heure_sortie IS NULL
         RETURNING id, to_char(heure_sortie, 'HH24:MI') AS "heureSortie"`,
        [exitMatch[1], siteId],
      );
      if (!result.rows[0]) { json(response, 404, { error: "Mouvement introuvable ou sortie déjà enregistrée." }); return true; }
      json(response, 200, { entry: result.rows[0] });
      return true;
    }

    json(response, 405, { error: "Méthode non autorisée." });
  } catch (error) {
    console.error("Route matériels Star:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Opération sur les matériels Star impossible." });
  }
  return true;
}
