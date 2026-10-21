import { json, readJson } from "../utils/helpers.js";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const truckTypes = new Set(["DECHARGEMENT", "CHARGEMENT"]);
const fluxTypes = new Set(["DECHARGEMENT", "CHARGEMENT", "INVENTAIRE"]);
const incidentTypes = new Set(["ANOMALIE", "VIOLATION_PROCEDURE"]);
const stockCategories = new Set(["VIDES", "PLEINS_EAUX"]);

const cleanText = (value, max = 255) => typeof value === "string" ? value.trim().slice(0, max) : "";
const validDate = (value) => {
  if (typeof value !== "string" || !datePattern.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

async function getAccount(pool, userId) {
  const result = await pool.query(
    "SELECT id, site_id, role FROM utilisateur WHERE id = $1::uuid LIMIT 1",
    [userId],
  );
  if (!result.rows[0]) throw Object.assign(new Error("Utilisateur introuvable."), { status: 401 });
  return result.rows[0];
}

async function resolveSite(pool, account, body = {}) {
  if (account.site_id && account.role !== 1) return account.site_id;
  const requestedId = cleanText(body.siteId, 36);
  const requestedName = cleanText(body.siteName);
  if (requestedId) {
    const result = await pool.query("SELECT id FROM site WHERE id = $1::uuid AND actif = true LIMIT 1", [requestedId]);
    if (result.rows[0]) return result.rows[0].id;
  }
  if (requestedName) {
    const result = await pool.query("SELECT id FROM site WHERE LOWER(nom) = LOWER($1) AND actif = true LIMIT 1", [requestedName]);
    if (result.rows[0]) return result.rows[0].id;
  }
  if (account.site_id) return account.site_id;
  throw Object.assign(new Error("Sélectionnez un site de travail actif."), { status: 400 });
}

async function querySiteForRead(pool, account, request) {
  if (account.site_id && account.role !== 1) return account.site_id;
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const siteId = url.searchParams.get("siteId");
  if (!siteId) return null;
  const result = await pool.query("SELECT id FROM site WHERE id = $1::uuid AND actif = true LIMIT 1", [siteId]);
  return result.rows[0]?.id || null;
}

export async function getLogisticsEntries(request, response, pool, userId) {
  try {
    const account = await getAccount(pool, userId);
    const siteId = await querySiteForRead(pool, account, request);
    if (!siteId) return json(response, 200, { entries: [] });
    const result = await pool.query(
      `SELECT f.id, f.date_operation AS date, f.type_flux AS type,
              f.camion, f.transporteur, f.document, f.plomb,
              f.categorie_stock AS "categorieStock", f.article, f.quantite,
              s.nom AS "siteName", s.type_site AS "siteType", f.cree_le AS "createdAt"
       FROM flux_logistique f JOIN site s ON s.id = f.site_id
       WHERE f.site_id = $1::uuid
       ORDER BY f.date_operation DESC, f.cree_le DESC LIMIT 1000`,
      [siteId],
    );
    json(response, 200, { entries: result.rows });
  } catch (error) {
    console.error("GET /logistics failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible de charger les flux logistiques." });
  }
}

export async function createLogisticsEntry(request, response, pool, userId) {
  const client = await pool.connect();
  try {
    const body = await readJson(request);
    const type = fluxTypes.has(body.type) ? body.type : "";
    const date = cleanText(body.date, 10);
    if (!type || !validDate(date)) {
      return json(response, 400, { error: "Choisissez un type de flux et une date valide." });
    }

    await client.query("BEGIN");
    const account = await getAccount(client, userId);
    const siteId = await resolveSite(client, account, body);
    const siteResult = await client.query("SELECT nom, type_site FROM site WHERE id = $1::uuid", [siteId]);
    const site = siteResult.rows[0];
    if (!site) throw Object.assign(new Error("Site de travail introuvable."), { status: 404 });

    if (type === "INVENTAIRE") {
      if (site.type_site !== "AGENCE") {
        throw Object.assign(new Error("L’inventaire de stock est disponible pour les sites de type Agence."), { status: 400 });
      }
      const category = stockCategories.has(body.categorieStock) ? body.categorieStock : "";
      const items = Array.isArray(body.items)
        ? body.items.slice(0, 50).filter((item) => item?.quantite !== "" && item?.quantite != null)
        : [];
      if (!category || items.length === 0) {
        throw Object.assign(new Error("Choisissez la catégorie et saisissez au moins une quantité."), { status: 400 });
      }
      const created = [];
      for (const item of items) {
        const article = cleanText(item?.article, 100);
        const quantity = Number(item?.quantite);
        if (!article || !Number.isFinite(quantity) || quantity < 0 || quantity > 9999999999.99) {
          throw Object.assign(new Error("Chaque article doit avoir une quantité valide supérieure ou égale à zéro."), { status: 400 });
        }
        const result = await client.query(
          `INSERT INTO flux_logistique
             (date_operation, type_flux, categorie_stock, article, quantite, site_id, utilisateur_id)
           VALUES ($1::date, 'INVENTAIRE', $2, $3, $4, $5::uuid, $6::uuid)
           RETURNING id, cree_le AS "createdAt"`,
          [date, category, article, quantity, siteId, userId],
        );
        created.push({
          ...result.rows[0], date, type, categorieStock: category, article, quantite: quantity,
          siteName: site.nom, siteType: site.type_site,
        });
      }
      await client.query("COMMIT");
      return json(response, 201, { entries: created });
    }

    const camion = cleanText(body.camion, 160);
    if (!truckTypes.has(type) || !camion) {
      throw Object.assign(new Error("Le numéro du camion et de la remorque est obligatoire."), { status: 400 });
    }
    const transporteur = cleanText(body.transporteur) || null;
    const document = cleanText(body.document, 160) || null;
    const plomb = cleanText(body.plomb, 100) || null;
    const result = await client.query(
      `INSERT INTO flux_logistique
         (date_operation, type_flux, camion, transporteur, document, plomb, site_id, utilisateur_id)
       VALUES ($1::date, $2, $3, $4, $5, $6, $7::uuid, $8::uuid)
       RETURNING id, cree_le AS "createdAt"`,
      [date, type, camion, transporteur, document, plomb, siteId, userId],
    );
    await client.query("COMMIT");
    json(response, 201, {
      entry: { ...result.rows[0], date, type, camion, transporteur, document, plomb, siteName: site.nom, siteType: site.type_site },
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("POST /logistics failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible d'enregistrer le flux logistique." });
  } finally {
    client.release();
  }
}

export async function getLogisticsIncidents(request, response, pool, userId) {
  try {
    const account = await getAccount(pool, userId);
    const siteId = await querySiteForRead(pool, account, request);
    if (!siteId) return json(response, 200, { entries: [] });
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const filterType = incidentTypes.has(url.searchParams.get("type")) ? url.searchParams.get("type") : null;
    const result = await pool.query(
      `SELECT e.id, e.date_operation AS date, to_char(e.heure, 'HH24:MI') AS time,
              e.type_signalement AS type, e.camion, e.transporteur, e.document,
              e.casse AS broken, e.manquant AS missing, e.vides AS empty, e.phn,
              e.description_faits AS facts, e.personne AS person, e.observations,
              e.mesures_prises AS measures, s.nom AS "siteName", s.type_site AS "siteType",
              e.cree_le AS "createdAt"
       FROM signalement_logistique e JOIN site s ON s.id = e.site_id
       WHERE e.site_id = $1::uuid AND ($2::varchar IS NULL OR e.type_signalement = $2::varchar)
       ORDER BY e.date_operation DESC, e.heure DESC, e.cree_le DESC LIMIT 1000`,
      [siteId, filterType],
    );
    json(response, 200, { entries: result.rows });
  } catch (error) {
    console.error("GET /logistics/incidents failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible de charger les signalements logistiques." });
  }
}

export async function createLogisticsIncident(request, response, pool, userId) {
  const client = await pool.connect();
  try {
    const body = await readJson(request);
    const type = incidentTypes.has(body.type) ? body.type : "";
    const date = cleanText(body.date, 10);
    const time = cleanText(body.time, 5);
    if (!type || !validDate(date) || !timePattern.test(time)) {
      return json(response, 400, { error: "Choisissez une rubrique et indiquez une date et une heure valides." });
    }
    const values = {
      camion: cleanText(body.camion, 160) || null,
      transporteur: cleanText(body.transporteur) || null,
      document: cleanText(body.document, 160) || null,
      broken: cleanText(body.broken, 2000) || null,
      missing: cleanText(body.missing, 2000) || null,
      empty: cleanText(body.empty, 2000) || null,
      phn: cleanText(body.phn, 2000) || null,
      facts: cleanText(body.facts, 20000) || null,
      person: cleanText(body.person) || null,
      observations: cleanText(body.observations, 20000) || null,
      measures: cleanText(body.measures, 20000) || null,
    };
    if (type === "ANOMALIE" && !values.facts) {
      return json(response, 400, { error: "Décrivez les faits de l’anomalie." });
    }
    if (type === "VIOLATION_PROCEDURE" && (!values.person || !values.observations)) {
      return json(response, 400, { error: "Indiquez le nom de la personne et les observations." });
    }

    await client.query("BEGIN");
    const account = await getAccount(client, userId);
    const siteId = await resolveSite(client, account, body);
    const siteResult = await client.query("SELECT nom, type_site FROM site WHERE id = $1::uuid", [siteId]);
    const site = siteResult.rows[0];
    if (!site) throw Object.assign(new Error("Site de travail introuvable."), { status: 404 });
    const result = await client.query(
      `INSERT INTO signalement_logistique
         (date_operation, heure, type_signalement, camion, transporteur, document,
          casse, manquant, vides, phn, description_faits, personne, observations,
          mesures_prises, site_id, utilisateur_id)
       VALUES ($1::date, $2::time, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::uuid, $16::uuid)
       RETURNING id, cree_le AS "createdAt"`,
      [date, time, type, values.camion, values.transporteur, values.document, values.broken,
        values.missing, values.empty, values.phn, values.facts, values.person,
        values.observations, values.measures, siteId, userId],
    );
    await client.query("COMMIT");
    json(response, 201, {
      entry: { ...result.rows[0], date, time, type, ...values, siteName: site.nom, siteType: site.type_site },
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("POST /logistics/incidents failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible d'enregistrer le signalement logistique." });
  } finally {
    client.release();
  }
}
