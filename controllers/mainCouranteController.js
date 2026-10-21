import { json, readJson } from "../utils/helpers.js";

const entryTypes = new Set(["STANDARD", "VIOLATION", "DIVERS"]);
const severities = new Set(["normal", "important", "grave", "urgent"]);
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const cleanText = (value, max = 255) => typeof value === "string" ? value.trim().slice(0, max) : "";

async function getAccount(pool, userId) {
  const result = await pool.query("SELECT id, role, site_id FROM utilisateur WHERE id=$1::uuid LIMIT 1", [userId]);
  if (!result.rows[0]) throw Object.assign(new Error("Utilisateur introuvable."), { status: 401 });
  return result.rows[0];
}

async function resolveSite(pool, account, siteId) {
  if (account.site_id && account.role !== 1) return account.site_id;
  if (!siteId) throw Object.assign(new Error("Sélectionnez un site de travail."), { status: 400 });
  const result = await pool.query("SELECT id FROM site WHERE id=$1::uuid AND actif=true LIMIT 1", [siteId]);
  if (!result.rows[0]) throw Object.assign(new Error("Site de travail introuvable ou archivé."), { status: 404 });
  return result.rows[0].id;
}

export async function getMainCouranteEntries(request, response, pool, userId) {
  try {
    const account = await getAccount(pool, userId);
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const siteId = account.site_id && account.role !== 1 ? account.site_id : cleanText(url.searchParams.get("siteId"), 36);
    if (!siteId) return json(response, 200, { entries: [] });
    const result = await pool.query(
      `SELECT m.id, m.type_entree AS "typeEntree", m.category, m.severity, m.zone, m.people,
              m.statut_auteur AS "statutAuteur", m.nature_violation AS "natureViolation",
              m.description, m.mesures_prises AS "mesuresPrises", to_char(m.heure, 'HH24:MI') AS heure,
              m.cree_le AS "createdAt", m.site_id AS "siteId", s.nom AS "siteName", u.nom AS "agentNom"
       FROM main_courante m JOIN site s ON s.id=m.site_id JOIN utilisateur u ON u.id=m.utilisateur_id
       WHERE m.site_id=$1::uuid
       ORDER BY m.cree_le DESC LIMIT 1000`,
      [siteId],
    );
    json(response, 200, { entries: result.rows });
  } catch (error) {
    console.error("GET /main-courante failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible de charger la main courante." });
  }
}

export async function createMainCouranteEntry(request, response, pool, userId) {
  const client = await pool.connect();
  try {
    const body = await readJson(request);
    const typeEntree = entryTypes.has(body.typeEntree) ? body.typeEntree : "";
    const category = cleanText(body.category, 80);
    const severity = severities.has(body.severity) ? body.severity : "";
    const description = cleanText(body.description, 20000);
    const heure = cleanText(body.heure, 5);
    if (!typeEntree || !category || !severity || !description || !timePattern.test(heure)) {
      return json(response, 400, { error: "Indiquez un type, une catégorie, une gravité, une description et une heure valides." });
    }
    const values = {
      zone: cleanText(body.zone) || null,
      people: cleanText(body.people) || null,
      statutAuteur: cleanText(body.statutAuteur, 80) || null,
      natureViolation: cleanText(body.natureViolation, 160) || null,
      mesuresPrises: cleanText(body.mesuresPrises, 20000) || null,
    };
    if (typeEntree === "VIOLATION" && (!values.people || !values.statutAuteur || !values.natureViolation || !values.mesuresPrises)) {
      return json(response, 400, { error: "Complétez l’auteur, son statut, la nature de la violation et les mesures prises." });
    }
    if (typeEntree === "DIVERS" && (!values.zone || !values.people || !values.mesuresPrises)) {
      return json(response, 400, { error: "Complétez le lieu, les personnes impliquées et les mesures prises." });
    }

    await client.query("BEGIN");
    const account = await getAccount(client, userId);
    const siteId = await resolveSite(client, account, body.siteId);
    const result = await client.query(
      `INSERT INTO main_courante
         (type_entree, category, severity, zone, people, statut_auteur, nature_violation,
          description, mesures_prises, heure, site_id, utilisateur_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::time, $11::uuid, $12::uuid)
       RETURNING id, cree_le AS "createdAt", to_char(heure, 'HH24:MI') AS heure`,
      [typeEntree, category, severity, values.zone, values.people, values.statutAuteur, values.natureViolation,
        description, values.mesuresPrises, heure, siteId, userId],
    );
    const siteResult = await client.query("SELECT nom AS \"siteName\" FROM site WHERE id=$1::uuid", [siteId]);
    await client.query("COMMIT");
    json(response, 201, { entry: { id: result.rows[0].id, createdAt: result.rows[0].createdAt, heure: result.rows[0].heure,
      typeEntree, category, severity, ...values, description, siteId, siteName: siteResult.rows[0]?.siteName } });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("POST /main-courante failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible d’enregistrer l’événement." });
  } finally {
    client.release();
  }
}
