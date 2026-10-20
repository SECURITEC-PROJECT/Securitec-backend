import { apiPrefix, getPool, getOrCreateSite, json, readJson, requestUser, text } from "../server-support.js";

const checkpoints = ["Accueil / hall", "Parking", "Portail principal", "Issues de secours", "Local technique", "Entrepôt", "Bureaux étage", "Clôture périmétrique"];

function cleanCheckpoints(value) {
  if (!Array.isArray(value) || value.length > 100) throw Object.assign(new Error("Liste de points de contrôle invalide."), { status: 400 });
  return value.map((point) => {
    const name = text(point?.name, 160);
    const at = point?.at == null ? null : new Date(point.at);
    if (!name || (point?.at != null && Number.isNaN(at.getTime()))) throw Object.assign(new Error("Un point de contrôle contient des données invalides."), { status: 400 });
    return { name, at: at?.toISOString() || null };
  });
}

export async function handlePatrols(request, response, pathname) {
  const account = requestUser(request, response);
  if (!account) return;
  let pool;
  try { pool = await getPool(); }
  catch (error) { json(response, 503, { error: error.message || "Base de données inaccessible." }); return; }
  const idMatch = new RegExp(`^${apiPrefix}/patrols/([0-9a-f-]+)$`, "i").exec(pathname);
  const finishMatch = new RegExp(`^${apiPrefix}/patrols/([0-9a-f-]+)/finish$`, "i").exec(pathname);
  try {
    if (pathname === `${apiPrefix}/patrols`) {
      if (request.method === "GET") {
        const result = await pool.query(
          `SELECT r.id, r.nom_parcours AS route_name, r.debut AS started_at, r.fin AS ended_at,
             r.points AS checkpoints, r.observations AS anomalies, r.site_id AS "siteId", s.nom AS site_name,
             r.utilisateur_id AS agent_id, u.nom AS agent_name
           FROM ronde r JOIN site s ON s.id=r.site_id JOIN utilisateur u ON u.id=r.utilisateur_id
           WHERE r.utilisateur_id=$1 OR ($2::uuid IS NOT NULL AND r.site_id=$2::uuid)
           ORDER BY r.debut DESC LIMIT 500`, [account.sub, account.siteId || null]);
        json(response, 200, { patrols: result.rows }); return;
      }
      if (request.method !== "POST") { json(response, 405, { error: "Méthode non autorisée." }); return; }
      const body = await readJson(request);
      const routeName = text(body.routeName, 160);
      const siteName = text(body.siteName || account.siteNom, 255);
      if (!routeName || !siteName) { json(response, 400, { error: "Le parcours et le site sont obligatoires." }); return; }
      if (account.siteId && account.siteNom && siteName.toLocaleLowerCase() !== account.siteNom.toLocaleLowerCase()) {
        json(response, 403, { error: "Le compte est limité au site associé à sa session." }); return;
      }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const siteId = account.siteId || await getOrCreateSite(client, siteName, body.siteType);
        const points = cleanCheckpoints(body.checkpoints || checkpoints.map((name) => ({ name, at: null })));
        const result = await client.query(
          `INSERT INTO ronde (nom_parcours, debut, points, site_id, utilisateur_id)
           VALUES ($1,NOW(),$2::jsonb,$3,$4) RETURNING id, debut AS started_at`,
          [routeName, JSON.stringify(points), siteId, account.sub]);
        await client.query("COMMIT");
        json(response, 201, { patrol: { ...result.rows[0], route_name: routeName, checkpoints: points, ended_at: null, anomalies: null, siteId, site_name: siteName, agent_id: account.sub } });
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        json(response, error.code === "23505" ? 409 : (error.status || 500), { error: error.code === "23505" ? "Une ronde est déjà en cours pour cet agent." : (error.message || "Démarrage de la ronde impossible.") });
      } finally { client.release(); }
      return;
    }
    if (request.method === "PATCH" && idMatch) {
      const body = await readJson(request);
      const points = cleanCheckpoints(body.checkpoints);
      const result = await pool.query(
        `UPDATE ronde SET points=$1::jsonb WHERE id=$2 AND utilisateur_id=$3 AND fin IS NULL
         RETURNING id, nom_parcours AS route_name, debut AS started_at, fin AS ended_at, points AS checkpoints, observations AS anomalies`,
        [JSON.stringify(points), idMatch[1], account.sub]);
      if (!result.rows[0]) { json(response, 409, { error: "Ronde active introuvable ou terminée." }); return; }
      json(response, 200, { patrol: result.rows[0] }); return;
    }
    if (request.method === "POST" && finishMatch) {
      const body = await readJson(request);
      const observations = text(body.observations, 20000) || null;
      const result = await pool.query(
        `UPDATE ronde SET fin=NOW(), observations=$1 WHERE id=$2 AND utilisateur_id=$3 AND fin IS NULL
         RETURNING id, nom_parcours AS route_name, debut AS started_at, fin AS ended_at, points AS checkpoints, observations AS anomalies`,
        [observations, finishMatch[1], account.sub]);
      if (!result.rows[0]) { json(response, 409, { error: "Ronde active introuvable ou déjà terminée." }); return; }
      json(response, 200, { patrol: result.rows[0] }); return;
    }
    json(response, 404, { error: "Route de ronde introuvable." });
  } catch (error) { json(response, error.status || 500, { error: error.message || "Opération sur les rondes impossible." }); }
}
