import { apiPrefix, getPool, json, readJson, requestUser, text } from "../server-support.js";

const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const entryTypes = new Set(["STANDARD", "VIOLATION", "DIVERS"]);
const severities = new Set(["normal", "important", "grave", "urgent"]);

export async function handleMainCourante(request, response, pathname) {
  const account = requestUser(request, response);
  if (!account) return;
  if (pathname !== `${apiPrefix}/main-courante`) {
    json(response, 404, { error: "Route de main courante introuvable." });
    return;
  }

  let pool;
  try {
    pool = await getPool();
  } catch (error) {
    json(response, 503, { error: error.message || "Base de données inaccessible." });
    return;
  }

  if (request.method === "GET") {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const siteId = account.siteId || url.searchParams.get("siteId") || null;
    try {
      const result = await pool.query(
        `SELECT e.id, e.type_entree AS "typeEntree", e.category, e.severity, e.zone, e.people,
           e.statut_auteur AS "statutAuteur", e.nature_violation AS "natureViolation",
           e.description, e.mesures_prises AS "mesuresPrises", to_char(e.heure,'HH24:MI') AS heure,
           e.site_id AS "siteId", s.nom AS "siteName", e.cree_le AS "createdAt"
         FROM main_courante e JOIN site s ON s.id=e.site_id
         WHERE ($1::uuid IS NULL OR e.site_id=$1::uuid)
         ORDER BY e.cree_le DESC, e.heure DESC LIMIT 500`,
        [siteId],
      );
      json(response, 200, { entries: result.rows });
    } catch (error) {
      json(response, 500, { error: error.message || "Chargement de la main courante impossible." });
    }
    return;
  }

  if (request.method !== "POST") {
    json(response, 405, { error: "Méthode non autorisée." });
    return;
  }

  try {
    const body = await readJson(request);
    const typeEntree = text(body?.typeEntree, 40);
    const category = text(body?.category, 80);
    const severity = text(body?.severity, 20);
    const description = text(body?.description, 20000);
    const heure = text(body?.heure, 5);
    const siteId = account.siteId || text(body?.siteId, 64);
    if (!entryTypes.has(typeEntree) || !category || !severities.has(severity) || !description || !timePattern.test(heure) || !siteId) {
      json(response, 400, { error: "Vérifiez le site, la catégorie, la gravité, la description et l’heure (HH:MM)." });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const site = await client.query("SELECT id, nom FROM site WHERE id=$1 AND actif=true", [siteId]);
      if (!site.rows[0]) throw Object.assign(new Error("Site introuvable ou inactif."), { status: 404 });
      const entry = {
        typeEntree, category, severity,
        zone: text(body.zone, 255) || null,
        people: text(body.people, 255) || null,
        statutAuteur: text(body.statutAuteur, 80) || null,
        natureViolation: text(body.natureViolation, 160) || null,
        description,
        mesuresPrises: text(body.mesuresPrises, 20000) || null,
        heure,
      };
      const inserted = await client.query(
        `INSERT INTO main_courante
           (type_entree, category, severity, zone, people, statut_auteur, nature_violation,
            description, mesures_prises, heure, site_id, utilisateur_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::time,$11,$12)
         RETURNING id, cree_le AS "createdAt"`,
        [entry.typeEntree, entry.category, entry.severity, entry.zone, entry.people,
          entry.statutAuteur, entry.natureViolation, entry.description, entry.mesuresPrises,
          entry.heure, siteId, account.sub],
      );
      await client.query("COMMIT");
      json(response, 201, { entry: { ...entry, id: inserted.rows[0].id, siteId, siteName: site.rows[0].nom, createdAt: inserted.rows[0].createdAt } });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      json(response, error.status || 500, { error: error.message || "Enregistrement dans la main courante impossible." });
    } finally {
      client.release();
    }
  } catch (error) {
    json(response, error.status || 500, { error: error.message || "Enregistrement dans la main courante impossible." });
  }
}
