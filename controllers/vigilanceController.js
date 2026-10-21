import { json, readJson } from "../utils/helpers.js";

const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const statuses = new Set(["Conforme", "Non Conforme", "RAS"]);
const cleanText = (value, max = 255) => typeof value === "string" ? value.trim().slice(0, max) : "";

async function accountFor(pool, userId) {
  const result = await pool.query("SELECT id, role, site_id FROM utilisateur WHERE id=$1::uuid", [userId]);
  if (!result.rows[0]) throw Object.assign(new Error("Utilisateur introuvable."), { status: 401 });
  return result.rows[0];
}

async function resolveSite(pool, account, siteId) {
  if (account.site_id && account.role !== 1) return account.site_id;
  if (!siteId) throw Object.assign(new Error("Sélectionnez un site."), { status: 400 });
  const result = await pool.query("SELECT id FROM site WHERE id=$1::uuid AND actif=true", [siteId]);
  if (!result.rows[0]) throw Object.assign(new Error("Site de travail introuvable."), { status: 404 });
  return result.rows[0].id;
}

export async function getVigilancePoints(request, response, pool, userId) {
  try {
    const account = await accountFor(pool, userId);
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const siteId = account.site_id && account.role !== 1 ? account.site_id : url.searchParams.get("siteId") || null;
    if (!siteId) return json(response, 200, { entries: [] });
    const result = await pool.query(
      `SELECT p.id, p.type_point AS "typePoint", p.element_verifie AS "elementVerifie",
              p.statut, p.observations, to_char(p.heure, 'HH24:MI') AS heure,
              p.agent_nom AS "agentNom", p.cree_le AS "createdAt", p.site_id AS "siteId", s.nom AS "siteName"
       FROM point_vigilance p JOIN site s ON s.id=p.site_id
       WHERE p.site_id=$1::uuid ORDER BY p.cree_le DESC LIMIT 1000`,
      [siteId],
    );
    json(response, 200, { entries: result.rows });
  } catch (error) {
    console.error("GET /vigilance failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible de charger les points de vigilance." });
  }
}

export async function createVigilancePoints(request, response, pool, userId) {
  const client = await pool.connect();
  try {
    const body = await readJson(request);
    const submitted = Array.isArray(body) ? body : [body];
    if (!submitted.length || submitted.length > 100) return json(response, 400, { error: "Le nombre de points transmis est invalide." });
    const entries = submitted.map((item) => {
      const typePoint = cleanText(item?.typePoint, 160);
      const elementVerifie = cleanText(item?.elementVerifie, 255);
      const statut = cleanText(item?.statut, 40);
      const heure = cleanText(item?.heure, 5);
      if (!typePoint || !elementVerifie || !statuses.has(statut) || !timePattern.test(heure)) {
        throw Object.assign(new Error("Un point contient des champs invalides."), { status: 400 });
      }
      return { typePoint, elementVerifie, statut, heure, observations: cleanText(item?.observations, 20000) || null, agentNom: cleanText(item?.agentNom) };
    });
    if (entries.some((entry) => !entry.agentNom)) return json(response, 400, { error: "Le nom de l’agent contrôleur est obligatoire." });

    await client.query("BEGIN");
    const account = await accountFor(client, userId);
    const siteId = await resolveSite(client, account, submitted[0]?.siteId);
    const created = [];
    for (const entry of entries) {
      const result = await client.query(
        `INSERT INTO point_vigilance (type_point, element_verifie, statut, observations, heure, agent_nom, site_id, utilisateur_id)
         VALUES ($1, $2, $3, $4, $5::time, $6, $7::uuid, $8::uuid)
         RETURNING id, type_point AS "typePoint", element_verifie AS "elementVerifie", statut, observations,
                   to_char(heure, 'HH24:MI') AS heure, agent_nom AS "agentNom", cree_le AS "createdAt"`,
        [entry.typePoint, entry.elementVerifie, entry.statut, entry.observations, entry.heure, entry.agentNom, siteId, userId],
      );
      created.push({ ...result.rows[0], siteId });
    }
    await client.query("COMMIT");
    json(response, 201, { entries: created });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("POST /vigilance failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible d’enregistrer les points de vigilance." });
  } finally {
    client.release();
  }
}
