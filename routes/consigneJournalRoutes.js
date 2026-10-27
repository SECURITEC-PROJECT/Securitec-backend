import { getRequestUser } from "../utils/auth.js";
import { json, readJson } from "../utils/helpers.js";

const routePath = "/api/consignes-journal";
const entryPath = /^\/api\/consignes-journal\/([0-9a-f-]+)$/i;
const entryColumns = `id, date_consigne AS date, to_char(heure, 'HH24:MI') AS heure,
  consigne, emetteur, destinataire, cree_le AS "createdAt"`;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const cleanText = (value, max = 255) => typeof value === "string" ? value.trim().slice(0, max) : "";

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

export async function handleConsigneJournalRoutes(request, response, pool, pathname, jwtSecret) {
  const entryMatch = entryPath.exec(pathname);
  if (pathname !== routePath && !entryMatch) return false;
  const user = getRequestUser(request, jwtSecret);
  if (!user) {
    json(response, 401, { error: "Connectez-vous pour acceder aux consignes." });
    return true;
  }

  try {
    const account = await getAccount(pool, user.id);
    if (!account) throw Object.assign(new Error("Utilisateur introuvable."), { status: 401 });

    if (request.method === "GET" && pathname === routePath) {
      const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
      const siteId = await resolveSite(pool, account, url.searchParams.get("siteId"));
      const result = await pool.query(
        `SELECT ${entryColumns}
         FROM consigne_journal WHERE site_id=$1::uuid
         ORDER BY date_consigne DESC, heure DESC, cree_le DESC LIMIT 1000`,
        [siteId],
      );
      json(response, 200, { entries: result.rows });
      return true;
    }

    if (request.method === "DELETE" && entryMatch) {
      const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
      const siteId = await resolveSite(pool, account, url.searchParams.get("siteId"));
      const result = await pool.query(
        "DELETE FROM consigne_journal WHERE id=$1::uuid AND site_id=$2::uuid RETURNING id",
        [entryMatch[1], siteId],
      );
      if (!result.rows[0]) {
        json(response, 404, { error: "Consigne introuvable pour ce site." });
        return true;
      }
      json(response, 200, { id: result.rows[0].id, deleted: true });
      return true;
    }

    if (request.method !== "POST" && !(request.method === "PUT" && entryMatch)) {
      json(response, 405, { error: "Methode non autorisee." });
      return true;
    }

    const body = await readJson(request);
    const date = cleanText(body?.date, 10);
    const heure = cleanText(body?.heure, 5);
    const consigne = cleanText(body?.consigne, 20000);
    const emetteur = cleanText(body?.emetteur);
    const destinataire = cleanText(body?.destinataire);
    if (!datePattern.test(date) || !timePattern.test(heure) || !consigne || !emetteur || !destinataire) {
      json(response, 400, { error: "Tous les champs sont obligatoires et la date et l'heure doivent etre valides." });
      return true;
    }
    const siteId = await resolveSite(pool, account, body.siteId);
    if (request.method === "PUT") {
      const result = await pool.query(
        `UPDATE consigne_journal
         SET date_consigne=$2::date, heure=$3::time, consigne=$4, emetteur=$5, destinataire=$6
         WHERE id=$1::uuid AND site_id=$7::uuid
         RETURNING ${entryColumns}`,
        [entryMatch[1], date, heure, consigne, emetteur, destinataire, siteId],
      );
      if (!result.rows[0]) {
        json(response, 404, { error: "Consigne introuvable pour ce site." });
        return true;
      }
      json(response, 200, { entry: result.rows[0] });
      return true;
    }

    const result = await pool.query(
      `INSERT INTO consigne_journal
         (site_id, date_consigne, heure, consigne, emetteur, destinataire, utilisateur_id)
       VALUES ($1::uuid, $2::date, $3::time, $4, $5, $6, $7::uuid)
       RETURNING ${entryColumns}`,
      [siteId, date, heure, consigne, emetteur, destinataire, account.id],
    );
    json(response, 201, { entry: result.rows[0] });
  } catch (error) {
    json(response, error.status || 500, { error: error.message || "Enregistrement de la consigne impossible." });
  }
  return true;
}
