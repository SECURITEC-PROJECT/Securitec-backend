import { apiPrefix, getPool, json, readJson, requestUser, text } from "../server-support.js";

const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const statuses = new Set(["Conforme", "Non Conforme", "RAS"]);

export async function handleVigilance(request, response, pathname) {
  const account = requestUser(request, response);
  if (!account) return;

  let pool;
  try {
    pool = await getPool();
  } catch (error) {
    json(response, 503, { error: error.message || "Base de données inaccessible." });
    return;
  }

  if (pathname !== `${apiPrefix}/vigilance`) {
    json(response, 404, { error: "Route de vigilance introuvable." });
    return;
  }

  if (request.method === "GET") {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const siteId = account.siteId || url.searchParams.get("siteId") || null;
    try {
      const result = await pool.query(
        `SELECT p.id, p.type_point AS "typePoint", p.element_verifie AS "elementVerifie",
           p.statut, p.observations, to_char(p.heure,'HH24:MI') AS heure,
           p.agent_nom AS "agentNom", p.site_id AS "siteId", s.nom AS "siteName",
           p.cree_le AS "createdAt"
         FROM point_vigilance p JOIN site s ON s.id=p.site_id
         WHERE ($1::uuid IS NULL OR p.site_id=$1::uuid)
         ORDER BY p.cree_le DESC, p.heure DESC LIMIT 500`,
        [siteId],
      );
      json(response, 200, { entries: result.rows });
    } catch (error) {
      json(response, 500, { error: error.message || "Chargement des points de vigilance impossible." });
    }
    return;
  }

  if (request.method !== "POST") {
    json(response, 405, { error: "Méthode non autorisée." });
    return;
  }

  try {
    const body = await readJson(request);
    const entries = Array.isArray(body) ? body : Array.isArray(body?.entries) ? body.entries : [];
    if (!entries.length || entries.length > 100) {
      json(response, 400, { error: "Envoyez entre 1 et 100 points de vigilance." });
      return;
    }

    const siteId = account.siteId || text(entries[0]?.siteId, 64);
    if (!siteId || entries.some((entry) => entry?.siteId && entry.siteId !== siteId)) {
      json(response, 400, { error: "Sélectionnez un seul site pour les points de vigilance." });
      return;
    }

    const normalized = [];
    for (const entry of entries) {
      const typePoint = text(entry?.typePoint, 160);
      const elementVerifie = text(entry?.elementVerifie, 255);
      const statut = statuses.has(entry?.statut) ? entry.statut : "";
      const heure = text(entry?.heure, 5);
      const agentNom = text(entry?.agentNom, 255);
      if (!typePoint || !elementVerifie || !statut || !timePattern.test(heure) || !agentNom) {
        json(response, 400, { error: "Chaque point doit avoir un domaine, un élément, un statut, une heure et un agent valides." });
        return;
      }
      normalized.push({ typePoint, elementVerifie, statut, heure, agentNom, observations: text(entry?.observations, 20000) || null });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const site = await client.query("SELECT id, nom FROM site WHERE id=$1 AND actif=true", [siteId]);
      if (!site.rows[0]) throw Object.assign(new Error("Site introuvable ou inactif."), { status: 404 });

      const saved = [];
      for (const entry of normalized) {
        const result = await client.query(
          `INSERT INTO point_vigilance (type_point, element_verifie, statut, observations, heure, agent_nom, site_id, utilisateur_id)
           VALUES ($1,$2,$3,$4,$5::time,$6,$7,$8)
           RETURNING id, cree_le AS "createdAt"`,
          [entry.typePoint, entry.elementVerifie, entry.statut, entry.observations, entry.heure, entry.agentNom, siteId, account.sub],
        );
        saved.push({ ...entry, id: result.rows[0].id, siteId, siteName: site.rows[0].nom, createdAt: result.rows[0].createdAt });
      }
      await client.query("COMMIT");
      json(response, 201, { entries: saved });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      json(response, error.status || 500, { error: error.message || "Enregistrement des points de vigilance impossible." });
    } finally {
      client.release();
    }
  } catch (error) {
    json(response, error.status || 500, { error: error.message || "Enregistrement des points de vigilance impossible." });
  }
}
