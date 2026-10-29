import { apiPrefix, getPool, json, readJson, requestUser, text, getOrCreateSite } from "../server-support.js";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validDate = (value) => {
  if (!datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

async function resolveSite(client, account, body) {
  if (account.siteId) return account.siteId;
  const siteName = text(body.siteName, 255);
  if (!siteName) throw Object.assign(new Error("Sélectionnez un site de travail."), { status: 400 });
  return getOrCreateSite(client, siteName, body.siteType);
}

export async function handleAccessControl(request, response, pathname) {
  const account = requestUser(request, response);
  if (!account) return;
  let pool;
  try { pool = await getPool(); }
  catch (error) { json(response, 503, { error: error.message || "Base de données inaccessible." }); return; }
  const query = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`).searchParams;
  const requestedSiteId = account.siteId || query.get("siteId") || null;

  if (pathname === `${apiPrefix}/access-control/key-types` && request.method === "GET") {
    try {
      const result = await pool.query(
        `SELECT DISTINCT TRIM(trousse_cle) AS "keyType"
         FROM cle_habilitation
         WHERE TRIM(trousse_cle) <> ''
         ORDER BY "keyType"`,
      );
      json(response, 200, { keyTypes: result.rows.map((row) => row.keyType) }); return;
    } catch (error) {
      json(response, 500, { error: error.message || "Chargement des types de clés impossible." }); return;
    }
  }

  if (pathname === `${apiPrefix}/access-control/key-employees` && request.method === "GET") {
    const keyType = text(query.get("keyType"), 100);
    if (!keyType || !requestedSiteId) {
      json(response, 400, { error: "Sélectionnez un site et un type de clé." }); return;
    }
    try {
      const result = await pool.query(
        `SELECT DISTINCT e.id, e.nom AS "lastName", e.prenom AS "firstName", e.matricule, e.role
         FROM employe e
         JOIN cle_habilitation ch ON LOWER(TRIM(ch.role_autorise)) = LOWER(TRIM(e.role))
         WHERE LOWER(TRIM(ch.trousse_cle)) = LOWER(TRIM($1))
           AND e.actif = true
           AND (e.site_id = $2::uuid OR e.site_id IS NULL)
         ORDER BY e.nom, e.prenom`,
        [keyType, requestedSiteId],
      );
      json(response, 200, { employees: result.rows }); return;
    } catch (error) {
      json(response, 500, { error: error.message || "Chargement des employés habilités impossible." }); return;
    }
  }

  const keyReturnMatch = new RegExp(`^${apiPrefix}/access-control/keys/([0-9a-f-]{36})/return$`, "i").exec(pathname);
  if (keyReturnMatch && request.method === "PATCH") {
    const body = await readJson(request);
    const returnTime = text(body.returnTime, 5);
    const siteId = account.siteId || text(body.siteId, 36) || requestedSiteId;
    if (!uuidPattern.test(keyReturnMatch[1]) || !timePattern.test(returnTime) || !uuidPattern.test(siteId)) {
      json(response, 400, { error: "Indiquez le site et une heure de retour valide (HH:MM)." }); return;
    }
    try {
      const result = await pool.query(
        `UPDATE suivi_cle
         SET heure_retour = $1::time
         WHERE id = $2::uuid AND site_id = $3::uuid
           AND type_cle IS NOT NULL AND heure_retour IS NULL
         RETURNING id, to_char(heure_retour, 'HH24:MI') AS "returnTime"`,
        [returnTime, keyReturnMatch[1], siteId],
      );
      if (!result.rows[0]) {
        const existing = await pool.query(
          "SELECT heure_retour FROM suivi_cle WHERE id=$1::uuid AND site_id=$2::uuid AND type_cle IS NOT NULL",
          [keyReturnMatch[1], siteId],
        );
        json(response, existing.rows[0] ? 409 : 404, {
          error: existing.rows[0] ? "Le retour de cette clé est déjà enregistré." : "Mouvement de clé introuvable.",
        }); return;
      }
      json(response, 200, { entry: result.rows[0] }); return;
    } catch (error) {
      json(response, 500, { error: error.message || "Enregistrement de l’heure de retour impossible." }); return;
    }
  }

  if (pathname === `${apiPrefix}/access-control/keys`) {
    if (request.method === "GET") {
      try {
      const result = await pool.query(
        `SELECT k.id, k.date_suivi::text AS date, k.lieu,
          k.nom_personne AS "lastName", k.prenom_personne AS "firstName",
          k.matricule_personne AS matricule, k.type_cle AS "keyType", k.nombre_cles AS quantity,
          to_char(k.heure_sortie,'HH24:MI') AS "departureTime",
          to_char(k.heure_retour,'HH24:MI') AS "returnTime",
          to_char(k.perception_matin,'HH24:MI') AS "perceptionMatin", k.responsable_perception_matin AS "responsablePerceptionMatin",
          to_char(k.reintegration_matin,'HH24:MI') AS "reintegrationMatin", k.responsable_reintegration_matin AS "responsableReintegrationMatin",
          to_char(k.perception_apres_midi,'HH24:MI') AS "perceptionApresMidi", k.responsable_perception_apres_midi AS "responsablePerceptionApresMidi",
          to_char(k.reintegration_apres_midi,'HH24:MI') AS "reintegrationApresMidi", k.responsable_reintegration_apres_midi AS "responsableReintegrationApresMidi",
          k.observations, s.nom AS "siteName", k.cree_le AS "createdAt"
         FROM suivi_cle k JOIN site s ON s.id=k.site_id
         WHERE ($1::uuid IS NULL OR k.site_id=$1::uuid)
           AND k.type_cle IS NOT NULL
         ORDER BY k.date_suivi DESC, k.heure_sortie DESC, k.cree_le DESC LIMIT 300`,
        [requestedSiteId],
      );
      json(response, 200, { entries: result.rows }); return;
      } catch (error) { json(response, 500, { error: error.message || "Chargement du suivi des clés impossible." }); return; }
    }
    if (request.method === "POST") {
      const body = await readJson(request);
      const date = text(body.date, 10);
      const employeeId = text(body.employeeId, 36);
      const keyType = text(body.keyType, 100);
      const departureTime = text(body.departureTime, 5);
      const quantity = Number(body.quantity);
      const siteId = account.siteId || text(body.siteId, 36);
      if (!validDate(date) || !uuidPattern.test(employeeId)
        || !keyType || !timePattern.test(departureTime)
        || !Number.isInteger(quantity) || quantity < 1 || quantity > 10000
        || !uuidPattern.test(siteId)) {
        json(response, 400, { error: "Vérifiez la date, l’employé, le site, le type de clé, la quantité et l’heure de sortie." }); return;
      }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const site = await client.query("SELECT id FROM site WHERE id=$1::uuid AND actif=true", [siteId]);
        if (!site.rows[0]) throw Object.assign(new Error("Site introuvable ou archivé."), { status: 404 });
        const employee = await client.query(
          `SELECT e.nom, e.prenom, e.matricule
           FROM employe e JOIN cle_habilitation ch
             ON LOWER(TRIM(ch.role_autorise)) = LOWER(TRIM(e.role))
           WHERE e.id=$1::uuid AND e.actif=true
             AND (e.site_id=$2::uuid OR e.site_id IS NULL)
             AND LOWER(TRIM(ch.trousse_cle))=LOWER(TRIM($3))
           LIMIT 1`,
          [employeeId, siteId, keyType],
        );
        if (!employee.rows[0]) throw Object.assign(new Error("Cet employé n’est pas habilité à prendre ce type de clé sur ce site."), { status: 400 });
        const result = await client.query(
          `INSERT INTO suivi_cle (date_suivi, nom_personne, prenom_personne, matricule_personne, type_cle, nombre_cles, heure_sortie, site_id, utilisateur_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7::time,$8,$9)
           RETURNING id, cree_le AS "createdAt"`,
          [date, employee.rows[0].nom, employee.rows[0].prenom, employee.rows[0].matricule, keyType, quantity, departureTime, siteId, account.sub],
        );
        await client.query("COMMIT");
        json(response, 201, { entry: {
          id: result.rows[0].id, date, lastName: employee.rows[0].nom, firstName: employee.rows[0].prenom,
          matricule: employee.rows[0].matricule, keyType, quantity, departureTime, returnTime: null,
          siteName: account.siteNom, createdAt: result.rows[0].createdAt,
        } });
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        json(response, error.status || 500, { error: error.message || "Enregistrement du suivi des clés impossible." });
      }
      finally { client.release(); }
      return;
    }
  }

  if (pathname === `${apiPrefix}/access-control/breath-tests`) {
    if (request.method === "GET") {
      try {
      const result = await pool.query(
        `SELECT c.id, c.date_controle AS date, to_char(c.heure,'HH24:MI') AS heure, c.personne,
          c.appartenance, c.demandeur, c.type_demande AS "typeDemande", c.resultat,
          c.taux_mesure AS "tauxMesure", s.nom AS "siteName", c.cree_le AS "createdAt"
         FROM controle_alcoolemie c JOIN site s ON s.id=c.site_id
         WHERE ($1::uuid IS NULL OR c.site_id=$1::uuid) ORDER BY c.date_controle DESC, c.heure DESC LIMIT 300`,
        [requestedSiteId],
      );
      json(response, 200, { entries: result.rows }); return;
      } catch (error) { json(response, 500, { error: error.message || "Chargement des contrôles impossible." }); return; }
    }
    if (request.method === "POST") {
      const body = await readJson(request);
      const date = text(body.date, 10), heure = text(body.heure, 5), personne = text(body.personne);
      const appartenance = body.appartenance === "NON STAR" ? "NON STAR" : body.appartenance === "STAR" ? "STAR" : "";
      const typeDemande = ["Test ordinaire (Entrée/Sortie)", "À la demande d'un service"].includes(body.typeDemande) ? body.typeDemande : "";
      const resultat = ["Positif", "Négatif"].includes(body.resultat) ? body.resultat : "";
      const demandeur = text(body.demandeur, 255);
      const rate = body.tauxMesure === "" || body.tauxMesure == null ? null : Number(body.tauxMesure);
      if (!datePattern.test(date) || !timePattern.test(heure) || !personne || !appartenance || !typeDemande || !resultat || (rate !== null && (!Number.isFinite(rate) || rate < 0 || rate > 999.99))) {
        json(response, 400, { error: "Vérifiez les champs." }); return;
      }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const siteId = await resolveSite(client, account, body);
        const result = await client.query(
          `INSERT INTO controle_alcoolemie (date_controle, heure, personne, appartenance, demandeur, type_demande, resultat, taux_mesure, site_id, utilisateur_id)
           VALUES ($1,$2::time,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, cree_le AS "createdAt"`,
          [date, heure, personne, appartenance, demandeur || null, typeDemande, resultat, rate, siteId, account.sub],
        );
        await client.query("COMMIT");
        json(response, 201, { entry: { ...body, id: result.rows[0].id, createdAt: result.rows[0].createdAt } });
      } catch (error) { await client.query("ROLLBACK").catch(() => {}); json(response, error.status || 500, { error: error.message || "Enregistrement du contrôle d'alcoolémie impossible." }); }
      finally { client.release(); }
      return;
    }
  }
  json(response, 405, { error: "Méthode non autorisée." });
}
