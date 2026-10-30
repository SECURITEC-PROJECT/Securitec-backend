import { getRequestUser } from "../utils/auth.js";
import { json, readJson } from "../utils/helpers.js";

const collectionPath = "/api/materiels-sous-traitant";
const entryPath = /^\/api\/materiels-sous-traitant\/([0-9a-f-]+)$/i;
const exitPath = /^\/api\/materiels-sous-traitant\/([0-9a-f-]+)\/sortie$/i;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const text = (value, max = 255) => typeof value === "string" ? value.trim().slice(0, max) : "";
const validDate = (value) => {
  if (!datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
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

async function resolveProvider(pool, providerId, allowedInactiveId = null) {
  const id = text(providerId, 36);
  if (!uuidPattern.test(id)) throw Object.assign(new Error("Sélectionnez un prestataire."), { status: 400 });
  const result = await pool.query(
    "SELECT id,nom FROM prestataire WHERE id=$1::uuid AND (actif=true OR id=$2::uuid)",
    [id, allowedInactiveId],
  );
  if (!result.rows[0]) throw Object.assign(new Error("Prestataire introuvable ou inactif."), { status: 400 });
  return result.rows[0];
}

export async function handleMaterielsSousTraitantRoutes(request, response, pool, pathname, jwtSecret) {
  const entryMatch = entryPath.exec(pathname);
  const exitMatch = exitPath.exec(pathname);
  if (pathname !== collectionPath && !entryMatch && !exitMatch) return false;
  const user = getRequestUser(request, jwtSecret);
  if (!user) {
    json(response, 401, { error: "Connectez-vous pour gérer les matériels sous-traitant." });
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
        `SELECT m.id, m.date_operation::text AS date, to_char(m.heure_entree, 'HH24:MI') AS "heureEntree",
                m.materiels, m.nombre, m.entreprise, m.prestataire_id AS "providerId", p.nom AS provider,
                to_char(m.heure_sortie, 'HH24:MI') AS "heureSortie", m.site_id AS "siteId", m.cree_le AS "createdAt",m.annule_le AS "annuleLe"
         FROM materiel_sous_traitant m JOIN prestataire p ON p.id=m.prestataire_id WHERE m.site_id=$1::uuid
         ORDER BY m.date_operation DESC, m.heure_entree DESC LIMIT 1000`,
        [siteId],
      );
      json(response, 200, { entries: result.rows });
      return true;
    }

    if (request.method === "POST" && pathname === collectionPath) {
      const body = await readJson(request);
      const date = text(body.date, 10);
      const heureEntree = text(body.heureEntree, 5);
      const materiels = text(body.materiels, 20000);
      const nombre = Number(body.nombre);
      if (!validDate(date) || !timePattern.test(heureEntree) || !materiels || !Number.isSafeInteger(nombre) || nombre < 1 || nombre > 1000000) {
        json(response, 400, { error: "Vérifiez la date, l'heure, le matériel et le nombre (entier positif)." });
        return true;
      }
      const siteId = await resolveSite(pool, account, body.siteId);
      const provider = await resolveProvider(pool, body.prestataireId);
      const result = await pool.query(
        `INSERT INTO materiel_sous_traitant (date_operation, heure_entree, materiels, nombre, entreprise, prestataire_id, site_id, utilisateur_id)
         VALUES ($1::date, $2::time, $3, $4, $5, $6::uuid, $7::uuid, $8::uuid)
         RETURNING id, date_operation::text AS date, to_char(heure_entree, 'HH24:MI') AS "heureEntree",
                   materiels, nombre, entreprise, prestataire_id AS "providerId",
                   to_char(heure_sortie, 'HH24:MI') AS "heureSortie", site_id AS "siteId", cree_le AS "createdAt"`,
        [date, heureEntree, materiels, nombre, provider.nom, provider.id, siteId, account.id],
      );
      json(response, 201, { entry: { ...result.rows[0], provider: provider.nom } });
      return true;
    }

    if (request.method === "PUT" && entryMatch) {
      if (!uuidPattern.test(entryMatch[1])) { json(response, 404, { error: "Mouvement introuvable." }); return true; }
      const body = await readJson(request);
      const date = text(body.date, 10);
      const heureEntree = text(body.heureEntree, 5);
      const materiels = text(body.materiels, 20000);
      const nombre = Number(body.nombre);
      if (!validDate(date) || !timePattern.test(heureEntree) || !materiels || !Number.isSafeInteger(nombre) || nombre < 1 || nombre > 1000000) {
        json(response, 400, { error: "Vérifiez la date, l'heure, le matériel et le nombre (entier positif)." });
        return true;
      }
      const siteId = await resolveSite(pool, account, body.siteId);
      const existing = await pool.query(
        "SELECT prestataire_id FROM materiel_sous_traitant WHERE id=$1::uuid AND site_id=$2::uuid AND annule_le IS NULL",
        [entryMatch[1], siteId],
      );
      if (!existing.rows[0]) { json(response, 404, { error: "Mouvement introuvable sur ce site." }); return true; }
      const provider = await resolveProvider(pool, body.prestataireId, existing.rows[0].prestataire_id);
      const result = await pool.query(
        `UPDATE materiel_sous_traitant
         SET date_operation=$2::date, heure_entree=$3::time, materiels=$4, nombre=$5, entreprise=$6, prestataire_id=$7::uuid,modifie_par=$9::uuid
         WHERE id=$1::uuid AND site_id=$8::uuid AND annule_le IS NULL
         RETURNING id, date_operation::text AS date, to_char(heure_entree, 'HH24:MI') AS "heureEntree",
                   materiels, nombre, entreprise, prestataire_id AS "providerId",
                   to_char(heure_sortie, 'HH24:MI') AS "heureSortie", site_id AS "siteId", cree_le AS "createdAt"`,
        [entryMatch[1], date, heureEntree, materiels, nombre, provider.nom, provider.id, siteId, account.id],
      );
      if (!result.rows[0]) { json(response, 404, { error: "Mouvement introuvable sur ce site." }); return true; }
      json(response, 200, { entry: { ...result.rows[0], provider: provider.nom } });
      return true;
    }

    if (request.method === "DELETE" && entryMatch) {
      if (!uuidPattern.test(entryMatch[1])) { json(response, 404, { error: "Mouvement introuvable." }); return true; }
      const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
      const siteId = await resolveSite(pool, account, url.searchParams.get("siteId"));
      const result = await pool.query(
        "UPDATE materiel_sous_traitant SET annule_le=CURRENT_TIMESTAMP,annule_par=$3::uuid,modifie_par=$3::uuid WHERE id=$1::uuid AND site_id=$2::uuid AND annule_le IS NULL RETURNING id,annule_le AS \"annuleLe\"",
        [entryMatch[1], siteId, account.id],
      );
      if (!result.rows[0]) { json(response, 404, { error: "Mouvement introuvable sur ce site." }); return true; }
      json(response, 200, { id: result.rows[0].id, deleted: false, cancelled: true, annuleLe: result.rows[0].annuleLe });
      return true;
    }

    if (request.method === "PATCH" && exitMatch) {
      if (!uuidPattern.test(exitMatch[1])) { json(response, 404, { error: "Mouvement introuvable." }); return true; }
      const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
      const siteId = await resolveSite(pool, account, url.searchParams.get("siteId"));
      const result = await pool.query(
        `UPDATE materiel_sous_traitant SET heure_sortie=timezone('Indian/Antananarivo', CURRENT_TIMESTAMP)::time(0),modifie_par=$3::uuid
         WHERE id=$1::uuid AND site_id=$2::uuid AND heure_sortie IS NULL AND annule_le IS NULL
         RETURNING id, to_char(heure_sortie, 'HH24:MI') AS "heureSortie"`,
        [exitMatch[1], siteId, account.id],
      );
      if (!result.rows[0]) { json(response, 404, { error: "Mouvement introuvable ou sortie déjà enregistrée." }); return true; }
      json(response, 200, { entry: result.rows[0] });
      return true;
    }
    json(response, 405, { error: "Méthode non autorisée." });
  } catch (error) {
    console.error("Route matériels sous-traitant:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Opération sur les matériels sous-traitant impossible." });
  }
  return true;
}
