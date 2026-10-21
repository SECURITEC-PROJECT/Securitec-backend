import {
  apiPrefix, getPool, json, readJson, requestUser, text, saveServiceReport, reportDatePattern,
} from "../server-support.js";

export async function handleReports(request, response, pathname) {
  if (pathname === `${apiPrefix}/service-reports`) {
    const account = requestUser(request, response);
    if (!account) return;
    try {
      const pool = await getPool();
      if (request.method === "GET") {
        const params = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`).searchParams;
        const date = params.get("date");
        const result = await pool.query(
          `SELECT cr.id, cr.date_rapport AS "reportDate", cr.debut_service AS "startTime", cr.fin_service AS "endTime",
             cr.statut_validation AS statut, cr.observations, cr.details, s.nom AS "siteName", p.nom AS "providerName",
             po.nom AS "postName", v.utilisateur_id AS "ownerId",
             (SELECT COALESCE(json_agg(json_build_object('name', concat_ws(' ', a.prenom, a.nom), 'matricule', a.matricule, 'shift', ca.shift, 'post', ap.nom)), '[]'::json)
                FROM compte_rendu_agent ca JOIN employe a ON a.id=ca.agent_id JOIN poste ap ON ap.id=ca.poste_id
               WHERE ca.compte_rendu_id=cr.id) AS agents
           FROM compte_rendu cr JOIN site s ON s.id=cr.site_id
           JOIN prestataire p ON p.id=cr.prestataire_id JOIN poste po ON po.id=cr.poste_id
           JOIN vacation v ON v.id=cr.vacation_id
           WHERE ($1::date IS NULL OR cr.date_rapport=$1::date)
             AND (v.utilisateur_id=$3 OR ($2::uuid IS NOT NULL AND cr.site_id=$2::uuid))
           ORDER BY cr.date_rapport DESC LIMIT 100`,
          [date && reportDatePattern.test(date) ? date : null, account.siteId || null, account.sub],
        );
        json(response, 200, { reports: result.rows });
        return;
      }
      if (request.method === "POST") {
        const saved = await saveServiceReport(pool, account, await readJson(request));
        json(response, 201, { report: saved });
        return;
      }
      json(response, 405, { error: "Méthode non autorisée." });
    } catch (error) {
      json(response, error.status || 500, { error: error.message || "Enregistrement du compte rendu impossible." });
    }
    return;
  }

  const reportEdit = /^\/api\/service-reports\/([0-9a-f-]+)$/.exec(pathname);
  const reportAudit = /^\/api\/service-reports\/([0-9a-f-]+)\/audit$/.exec(pathname);
  if (request.method === "GET" && reportAudit) {
    const account = requestUser(request, response);
    if (!account) return;
    try {
      const result = await (await getPool()).query(
        `SELECT ac.id, ac.action, ac.avant, ac.apres, ac.cree_le AS "createdAt", u.nom AS "actorName"
         FROM audit_compte_rendu ac JOIN utilisateur u ON u.id=ac.utilisateur_id
         JOIN compte_rendu cr ON cr.id=ac.compte_rendu_id JOIN vacation v ON v.id=cr.vacation_id
         WHERE ac.compte_rendu_id=$1 AND (v.utilisateur_id=$2 OR ($3::uuid IS NOT NULL AND cr.site_id=$3::uuid))
         ORDER BY ac.cree_le ASC`,
        [reportAudit[1], account.sub, account.siteId || null],
      );
      json(response, 200, { audit: result.rows });
    } catch (error) { json(response, 500, { error: error.message || "Chargement de l'historique impossible." }); }
    return;
  }

  if (request.method === "PUT" && reportEdit) {
    const account = requestUser(request, response);
    if (!account) return;
    try {
      const report = await saveServiceReport(await getPool(), account, await readJson(request), reportEdit[1]);
      json(response, 200, { report });
    } catch (error) {
      json(response, error.status || 500, { error: error.message || "Mise à jour du compte rendu impossible." });
    }
    return;
  }

  const reportSubmit = /^\/api\/service-reports\/([0-9a-f-]+)\/submit$/.exec(pathname);
  if (request.method === "POST" && reportSubmit) {
    const account = requestUser(request, response);
    if (!account) return;
    const client = await (await getPool()).connect();
    try {
      await client.query("BEGIN");
      const report = await client.query(
        `SELECT cr.id, cr.statut_validation, cr.details, v.utilisateur_id
         FROM compte_rendu cr JOIN vacation v ON v.id=cr.vacation_id
         WHERE cr.id=$1 AND v.utilisateur_id=$2 FOR UPDATE`,
        [reportSubmit[1], account.sub],
      );
      if (!report.rows[0]) throw Object.assign(new Error("Compte rendu introuvable."), { status: 404 });
      if (report.rows[0].statut_validation === "ENVOYE") throw Object.assign(new Error("Ce compte rendu est déjà envoyé."), { status: 409 });
      await client.query("UPDATE compte_rendu SET statut_validation='ENVOYE' WHERE id=$1", [reportSubmit[1]]);
      await client.query(
        "INSERT INTO audit_compte_rendu (compte_rendu_id, utilisateur_id, action, avant, apres) VALUES ($1,$2,'ENVOI',$3::jsonb,$4::jsonb)",
        [reportSubmit[1], account.sub, JSON.stringify({ statut: "BROUILLON" }), JSON.stringify({ statut: "ENVOYE", details: report.rows[0].details })],
      );
      await client.query("COMMIT");
      json(response, 200, { id: reportSubmit[1], statut: "ENVOYE" });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      json(response, error.status || 500, { error: error.message || "Envoi du compte rendu impossible." });
    } finally {
      client.release();
    }
    return;
  }
}
