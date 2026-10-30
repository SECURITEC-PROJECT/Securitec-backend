import { json, readJson } from "../utils/helpers.js";
import { resolvePriseDePosteId } from "../utils/priseDePoste.js";

const cleanText = (value, max = 255) => typeof value === "string" ? value.trim().slice(0, max) : "";

async function getAccount(pool, userId) {
  const result = await pool.query(
    "SELECT id, role, site_id FROM utilisateur WHERE id = $1::uuid LIMIT 1",
    [userId],
  );
  if (!result.rows[0]) throw Object.assign(new Error("Utilisateur introuvable."), { status: 401 });
  return result.rows[0];
}

async function resolveSite(pool, account, requestedSiteId) {
  if (account.site_id && account.role !== 1) return account.site_id;
  const siteId = cleanText(requestedSiteId, 36) || account.site_id;
  if (!siteId) throw Object.assign(new Error("Sélectionnez un site pour démarrer la ronde."), { status: 400 });
  const result = await pool.query("SELECT id FROM site WHERE id = $1::uuid AND actif = true LIMIT 1", [siteId]);
  if (!result.rows[0]) throw Object.assign(new Error("Site de travail introuvable."), { status: 404 });
  return result.rows[0].id;
}

function cleanCheckpoints(value) {
  if (!Array.isArray(value) || value.length > 100) {
    throw Object.assign(new Error("La liste des points de contrôle est invalide."), { status: 400 });
  }
  return value.map((point) => {
    const name = cleanText(point?.name, 160);
    const at = point?.at == null ? null : new Date(point.at);
    if (!name || (point?.at != null && Number.isNaN(at.getTime()))) {
      throw Object.assign(new Error("Un point de contrôle contient des données invalides."), { status: 400 });
    }
    return { name, at: at?.toISOString() || null };
  });
}

export async function getPatrols(request, response, pool, userId) {
  try {
    const account = await getAccount(pool, userId);
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const requestedSite = cleanText(url.searchParams.get("siteId"), 36);
    const siteId = account.site_id && account.role !== 1 ? account.site_id : requestedSite || null;
    const result = await pool.query(
      `SELECT r.id, r.nom_parcours AS route_name, r.debut AS started_at, r.fin AS ended_at,
              r.points AS checkpoints, r.observations AS anomalies, r.site_id AS "siteId",
              s.nom AS site_name, r.utilisateur_id AS agent_id, u.nom AS agent_name,
              p.poste_id AS "posteId", po.nom AS "posteNom", p.shift_type AS "shiftType"
       FROM ronde r JOIN site s ON s.id = r.site_id JOIN utilisateur u ON u.id = r.utilisateur_id
       LEFT JOIN prise_de_poste p ON p.id=r.prise_de_poste_id
       LEFT JOIN poste po ON po.id=p.poste_id
       WHERE ($1::uuid IS NULL OR r.site_id = $1::uuid)
         AND ($2::int=1 OR r.utilisateur_id = $3::uuid)
       ORDER BY r.debut DESC LIMIT 500`,
      [siteId, account.role, userId],
    );
    json(response, 200, { patrols: result.rows });
  } catch (error) {
    console.error("GET /patrols failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible de charger les rondes." });
  }
}

export async function createPatrol(request, response, pool, userId) {
  const client = await pool.connect();
  try {
    const body = await readJson(request);
    const routeName = cleanText(body.routeName, 160);
    if (!routeName) return json(response, 400, { error: "Le nom du parcours est obligatoire." });
    const points = cleanCheckpoints(body.checkpoints || []);
    await client.query("BEGIN");
    const account = await getAccount(client, userId);
    const siteId = await resolveSite(client, account, body.siteId);
    const priseDePosteId = await resolvePriseDePosteId(client, siteId, body.priseDePosteId);
    const result = await client.query(
      `INSERT INTO ronde (nom_parcours, points, site_id, utilisateur_id, prise_de_poste_id)
       VALUES ($1, $2::jsonb, $3::uuid, $4::uuid, $5::uuid)
       RETURNING id, nom_parcours AS route_name, debut AS started_at, fin AS ended_at,
                 points AS checkpoints, observations AS anomalies, site_id AS "siteId"`,
      [routeName, JSON.stringify(points), siteId, userId, priseDePosteId],
    );
    await client.query("COMMIT");
    json(response, 201, { patrol: result.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("POST /patrols failed:", error.code || error.name, error.message || "");
    const status = error.code === "23505" ? 409 : error.status || 500;
    json(response, status, { error: error.code === "23505" ? "Une ronde est déjà en cours pour cet agent." : error.status ? error.message : "Impossible de démarrer la ronde." });
  } finally {
    client.release();
  }
}

export async function updateCheckpoints(request, response, pool, userId, patrolId) {
  try {
    const body = await readJson(request);
    const points = cleanCheckpoints(body.checkpoints);
    const result = await pool.query(
      `UPDATE ronde SET points = $1::jsonb
       WHERE id = $2::uuid AND utilisateur_id = $3::uuid AND fin IS NULL
       RETURNING id, nom_parcours AS route_name, debut AS started_at, fin AS ended_at,
                 points AS checkpoints, observations AS anomalies, site_id AS "siteId"`,
      [JSON.stringify(points), patrolId, userId],
    );
    if (!result.rows[0]) return json(response, 404, { error: "Ronde active introuvable." });
    json(response, 200, { patrol: result.rows[0] });
  } catch (error) {
    console.error("PATCH /patrols/:id failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible de mettre à jour les points." });
  }
}

export async function finishPatrol(request, response, pool, userId, patrolId) {
  try {
    const body = await readJson(request);
    const observations = cleanText(body.observations, 20000) || null;
    const result = await pool.query(
      `UPDATE ronde SET fin = NOW(), observations = $1
       WHERE id = $2::uuid AND utilisateur_id = $3::uuid AND fin IS NULL
       RETURNING id, nom_parcours AS route_name, debut AS started_at, fin AS ended_at,
                 points AS checkpoints, observations AS anomalies, site_id AS "siteId"`,
      [observations, patrolId, userId],
    );
    if (!result.rows[0]) return json(response, 404, { error: "Ronde active introuvable ou déjà clôturée." });
    json(response, 200, { patrol: result.rows[0] });
  } catch (error) {
    console.error("POST /patrols/:id/finish failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible de clôturer la ronde." });
  }
}
