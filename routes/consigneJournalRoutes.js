import { getRequestUser } from "../utils/auth.js";
import { json, readJson } from "../utils/helpers.js";
import { resolvePriseDePosteId } from "../utils/priseDePoste.js";

const routePath = "/api/consignes-journal";
const entryPath = /^\/api\/consignes-journal\/([0-9a-f-]+)$/i;
const entryColumns = `cj.id, cj.date_consigne AS date, to_char(cj.heure, 'HH24:MI') AS heure,
  cj.consigne, cj.emetteur, cj.destinataire, cj.date_fin AS "dateFin",
  cj.jusquau_nouvel_ordre AS "jusquauNouvelOrdre", cj.prise_de_poste_id AS "priseDePosteId",
  p.poste_id AS "posteId", po.nom AS "posteNom", p.shift_type AS "shiftType", cj.cree_le AS "createdAt"`;
const entryReturningColumns = `id, date_consigne AS date, to_char(heure, 'HH24:MI') AS heure,
  consigne, emetteur, destinataire, date_fin AS "dateFin", jusquau_nouvel_ordre AS "jusquauNouvelOrdre",
  prise_de_poste_id AS "priseDePosteId", cree_le AS "createdAt"`;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const cleanText = (value, max = 255) => typeof value === "string" ? value.trim().slice(0, max) : "";
const validDate = (value) => {
  if (!datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

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
      const activeOnly = url.searchParams.get("activeOnly") === "true";
      const result = await pool.query(
        `SELECT ${entryColumns}
         FROM consigne_journal cj
         LEFT JOIN prise_de_poste p ON p.id=cj.prise_de_poste_id
         LEFT JOIN poste po ON po.id=p.poste_id
         WHERE cj.site_id=$1::uuid
           AND (NOT $2::boolean OR cj.jusquau_nouvel_ordre=true OR cj.date_fin >= CURRENT_DATE)
         ORDER BY date_consigne DESC, heure DESC, cree_le DESC LIMIT 1000`,
        [siteId, activeOnly],
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
    const jusquauNouvelOrdre = body?.jusquauNouvelOrdre === true;
    const dateFin = jusquauNouvelOrdre ? null : cleanText(body?.dateFin, 10);
    if (!datePattern.test(date) || !timePattern.test(heure) || !consigne || !emetteur || !destinataire) {
      json(response, 400, { error: "Tous les champs sont obligatoires et la date et l'heure doivent etre valides." });
      return true;
    }
    if (!jusquauNouvelOrdre && (!validDate(dateFin) || dateFin < date)) {
      json(response, 400, { error: "Indiquez une date de fin valide ou choisissez « Jusqu’à nouvel ordre »." });
      return true;
    }
    const siteId = await resolveSite(pool, account, body.siteId);
    const priseDePosteId = await resolvePriseDePosteId(pool, siteId, body.priseDePosteId);
    if (request.method === "PUT") {
      const result = await pool.query(
        `UPDATE consigne_journal
         SET date_consigne=$2::date, heure=$3::time, consigne=$4, emetteur=$5, destinataire=$6,
             date_fin=$7::date, jusquau_nouvel_ordre=$8, prise_de_poste_id=$9::uuid
         WHERE id=$1::uuid AND site_id=$10::uuid
         RETURNING ${entryReturningColumns}`,
        [entryMatch[1], date, heure, consigne, emetteur, destinataire, dateFin, jusquauNouvelOrdre, priseDePosteId, siteId],
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
         (site_id, date_consigne, heure, consigne, emetteur, destinataire, utilisateur_id,
          date_fin, jusquau_nouvel_ordre, prise_de_poste_id)
       VALUES ($1::uuid, $2::date, $3::time, $4, $5, $6, $7::uuid, $8::date, $9, $10::uuid)
       RETURNING ${entryReturningColumns}`,
      [siteId, date, heure, consigne, emetteur, destinataire, account.id, dateFin, jusquauNouvelOrdre, priseDePosteId],
    );
    json(response, 201, { entry: result.rows[0] });
  } catch (error) {
    json(response, error.status || 500, { error: error.message || "Enregistrement de la consigne impossible." });
  }
  return true;
}
