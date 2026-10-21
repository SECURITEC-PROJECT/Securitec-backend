import { apiPrefix, getPool, json, readJson, requestUser, text, getOrCreateSite } from "../server-support.js";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const timeOrNull = (value) => value === "" || value == null ? null : timePattern.test(value) ? value : undefined;

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

  if (pathname === `${apiPrefix}/access-control/keys`) {
    if (request.method === "GET") {
      try {
      const result = await pool.query(
        `SELECT k.id, k.date_suivi AS date, k.lieu,
          to_char(k.perception_matin,'HH24:MI') AS "perceptionMatin", k.responsable_perception_matin AS "responsablePerceptionMatin",
          to_char(k.reintegration_matin,'HH24:MI') AS "reintegrationMatin", k.responsable_reintegration_matin AS "responsableReintegrationMatin",
          to_char(k.perception_apres_midi,'HH24:MI') AS "perceptionApresMidi", k.responsable_perception_apres_midi AS "responsablePerceptionApresMidi",
          to_char(k.reintegration_apres_midi,'HH24:MI') AS "reintegrationApresMidi", k.responsable_reintegration_apres_midi AS "responsableReintegrationApresMidi",
          k.observations, s.nom AS "siteName", k.cree_le AS "createdAt"
         FROM suivi_cle k JOIN site s ON s.id=k.site_id
         WHERE ($1::uuid IS NULL OR k.site_id=$1::uuid) ORDER BY k.date_suivi DESC, k.cree_le DESC LIMIT 300`,
        [requestedSiteId],
      );
      json(response, 200, { entries: result.rows }); return;
      } catch (error) { json(response, 500, { error: error.message || "Chargement du suivi des clés impossible." }); return; }
    }
    if (request.method === "POST") {
      const body = await readJson(request);
      const date = text(body.date, 10);
      const lieu = text(body.lieu, 255);
      const fields = ["perceptionMatin", "reintegrationMatin", "perceptionApresMidi", "reintegrationApresMidi"];
      const times = fields.map((field) => timeOrNull(body[field]));
      if (!datePattern.test(date) || !lieu || times.includes(undefined)) { json(response, 400, { error: "Indiquez la date, le lieu et des heures valides au format HH:MM." }); return; }
      const names = ["responsablePerceptionMatin", "responsableReintegrationMatin", "responsablePerceptionApresMidi", "responsableReintegrationApresMidi"];
      const values = names.map((field) => text(body[field], 255) || null);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const siteId = await resolveSite(client, account, body);
        const result = await client.query(
          `INSERT INTO suivi_cle (date_suivi, lieu, perception_matin, responsable_perception_matin, reintegration_matin, responsable_reintegration_matin, perception_apres_midi, responsable_perception_apres_midi, reintegration_apres_midi, responsable_reintegration_apres_midi, observations, site_id, utilisateur_id)
           VALUES ($1,$2,$3::time,$4,$5::time,$6,$7::time,$8,$9::time,$10,$11,$12,$13) RETURNING id, cree_le AS "createdAt"`,
          [date, lieu, times[0], values[0], times[1], values[1], times[2], values[2], times[3], values[3], text(body.observations, 20000) || null, siteId, account.sub],
        );
        await client.query("COMMIT");
        json(response, 201, { entry: { ...body, id: result.rows[0].id, siteName: text(body.siteName) || account.siteNom, createdAt: result.rows[0].createdAt } });
      } catch (error) { await client.query("ROLLBACK").catch(() => {}); json(response, error.status || 500, { error: error.message || "Enregistrement du suivi des clés impossible." }); }
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
