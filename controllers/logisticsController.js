import { json, readJson } from "../utils/helpers.js";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const truckTypes = new Set(["DECHARGEMENT", "CHARGEMENT"]);
const fluxTypes = new Set(["DECHARGEMENT", "CHARGEMENT", "INVENTAIRE", "DECHETS", "BOUTEILLES_VIDES", "MATIERE_PREMIERE", "DEPOTAGE_FUEL"]);
const incidentTypes = new Set(["ANOMALIE", "VIOLATION_PROCEDURE"]);
const stockCategories = new Set(["VIDES", "PLEINS_EAUX"]);
const bottleDesignations = new Set([
  "Bouteilles vides - 65 Cl", "Bouteilles vides - 50 Cl", "Bouteilles vides - 33 Cl",
  "Fût - 30 L", "Fût - 20 L", "Fût - 20L export", "Fût - 30L export",
  "Cageau jaune - C20", "Cageau jaune - C24",
  "Bouteilles neuves - 65 Cl", "Bouteilles neuves - 50 Cl", "Bouteilles neuves - 33 Cl",
  "Palette neuve - 1310 x 1055", "Palette neuve - 1000 x 1200", "Palette neuve - 800 x 1200",
  "Palette réparée - 1310 x 1055", "Palette réparée - 1000 x 1200", "Palette réparée - 800 x 1200",
  "65 Cl", "50 Cl", "33 Cl", "30 Cl", "1 L",
]);
const maxBottleDesignationLines = 16;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const cleanText = (value, max = 255) => typeof value === "string" ? value.trim().slice(0, max) : "";
const normalizeDate = (value) => {
  if (typeof value !== "string") return "";
  const input = value.trim();
  const isoDate = input.match(/^(\d{4}-\d{2}-\d{2})(?:T.*)?$/);
  if (isoDate) return isoDate[1];
  const localDate = input.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return localDate ? `${localDate[3]}-${localDate[2]}-${localDate[1]}` : input;
};
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

async function requireRegisteredDriverVehicle(pool, siteId, vehicule) {
  const result = await pool.query(
    `SELECT 1 FROM chauffeur
     WHERE site_id = $1::uuid AND LOWER(BTRIM(vehicule)) = LOWER($2)
     LIMIT 1`,
    [siteId, vehicule],
  );
  if (!result.rows[0]) {
    throw Object.assign(
      new Error("Ce véhicule n’est pas enregistré dans le module Chauffeurs pour ce site."),
      { status: 400 },
    );
  }
}

async function requireRegisteredDriverName(pool, siteId, nomPrenom) {
  const result = await pool.query(
    `SELECT 1 FROM chauffeur
     WHERE site_id = $1::uuid AND LOWER(BTRIM(nom_prenom)) = LOWER($2)
     LIMIT 1`,
    [siteId, nomPrenom],
  );
  if (!result.rows[0]) {
    throw Object.assign(
      new Error("Ce chauffeur n’est pas enregistré dans le module Chauffeurs pour ce site."),
      { status: 400 },
    );
  }
}

export async function getLogisticsEntries(request, response, pool, userId) {
  try {
    const account = await getAccount(pool, userId);
    const siteId = await querySiteForRead(pool, account, request);
    if (!siteId) return json(response, 200, { entries: [] });
    const result = await pool.query(
      `SELECT f.id, f.date_operation::text AS date, f.type_flux AS type,
              f.camion, f.transporteur, f.document, f.plomb,
              to_char(COALESCE(f.heure_sortie, f.heure_arrivee), 'HH24:MI') AS "heureSortie", f.numero_pesage AS "numeroPesage",
              to_char(f.heure_sortie, 'HH24:MI') AS "heureFin",
              COALESCE(f.facture, f.document) AS facture, f.type_dechet AS "typeDechet", f.poids, f.destinataire,
              COALESCE(f.vehicule, f.camion) AS vehicule,
              to_char(f.heure_arrivee, 'HH24:MI') AS "heureArrivee",
              COALESCE(f.immatriculation_vehicule, f.vehicule, f.camion) AS "immatriculationVehicule",
              f.nom_chauffeur AS "nomChauffeur", f.nbr,
              f.numero_titre AS "numeroTitre", f.plomb, f.provenance,
              f.details_bouteilles AS "detailsBouteilles",
              to_char(f.heure_pointe, 'HH24:MI') AS "heurePointe", f.designation, f.provenance,
              f.titre, f.cree, f.chauffeur, f.magasinier,
              f.type_chargement AS "typeChargement", f.proprietaire,
              f.quantite_texte AS "quantiteTexte", f.lp,
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

export async function getStarParticulierLoadings(request, response, pool, userId) {
  try {
    const account = await getAccount(pool, userId);
    const siteId = await querySiteForRead(pool, account, request);
    if (!siteId) return json(response, 200, { entries: [] });
    const result = await pool.query(
      `SELECT f.id, f.site_id AS "siteId", f.date_operation::text AS date,
              f.type_flux AS type, f.type_chargement AS "typeChargement",
              to_char(f.heure_arrivee, 'HH24:MI') AS "heureDebut",
              to_char(f.heure_sortie, 'HH24:MI') AS "heureSortie", f.camion,
              f.proprietaire, f.nom_chauffeur AS "nomChauffeur", f.designation,
              f.quantite_texte AS "quantiteTexte", f.poids, f.destinataire,
              f.provenance, f.lp, f.titre, f.plomb, s.nom AS "siteName"
       FROM flux_logistique f JOIN site s ON s.id = f.site_id
       WHERE f.site_id = $1::uuid
         AND f.type_flux = 'CHARGEMENT'
         AND f.type_chargement IN ('STAR', 'PARTICULIER')
       ORDER BY f.date_operation DESC, f.cree_le DESC LIMIT 1000`,
      [siteId],
    );
    json(response, 200, { entries: result.rows });
  } catch (error) {
    console.error("GET star/particulier loadings failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible de charger le registre des chargements." });
  }
}

function validateStarParticulierLoading(body) {
  const heureDebut = cleanText(body.heureDebut, 5);
  const heureSortie = cleanText(body.heureSortie, 5);
  const camion = cleanText(body.camion, 160);
  const proprietaire = cleanText(body.proprietaire, 255);
  const nomChauffeur = cleanText(body.nomChauffeur, 255);
  const designation = cleanText(body.designation, 20000);
  const quantiteTexte = cleanText(body.quantiteTexte, 5000);
  const poidsInput = typeof body.poids === "string" ? body.poids.trim() : body.poids;
  const poids = typeof poidsInput === "number" || (typeof poidsInput === "string" && poidsInput !== "")
    ? Number(poidsInput)
    : Number.NaN;
  const poidsHasValidPrecision = /^\d{1,10}(?:\.\d{1,2})?$/.test(String(poidsInput));
  const destinataire = cleanText(body.destinataire, 255);
  const provenance = cleanText(body.provenance, 255);
  const lp = cleanText(body.lp, 6);
  const titre = cleanText(body.titre, 8);
  const plomb = cleanText(body.plomb, 8);
  const typeChargement = cleanText(body.typeChargement, 20).toUpperCase();
  if (!timePattern.test(heureDebut) || !timePattern.test(heureSortie)
    || !camion || !proprietaire || !nomChauffeur || !designation
    || !quantiteTexte || !poidsHasValidPrecision || !Number.isFinite(poids) || poids < 0 || poids > 9999999999.99
    || !destinataire || !provenance || !/^\d{1,6}$/.test(lp) || !/^\d{1,8}$/.test(titre)
    || !/^\d{1,8}$/.test(plomb) || !["STAR", "PARTICULIER"].includes(typeChargement)) {
    throw Object.assign(new Error("Vérifiez le type de chargement, les heures HD/HF, le véhicule, le propriétaire, le chauffeur, la désignation, la quantité, le poids, la destination, la provenance et les numéros LP/titre/plomb."), { status: 400 });
  }
  return { heureDebut, heureSortie, camion, proprietaire, nomChauffeur, designation, quantiteTexte, poids, destinataire, provenance, lp, titre, plomb, typeChargement };
}

export async function createStarParticulierLoading(request, response, pool, userId) {
  let client;
  try {
    const body = await readJson(request);
    const entry = validateStarParticulierLoading(body);
    client = await pool.connect();
    await client.query("BEGIN");
    const account = await getAccount(client, userId);
    const siteId = await resolveSite(client, account, body);
    const result = await client.query(
      `INSERT INTO flux_logistique
         (date_operation, type_flux, heure_arrivee, heure_sortie, camion, proprietaire, nom_chauffeur,
          designation, quantite_texte, poids, destinataire, provenance, lp, titre, plomb,
          type_chargement, site_id, utilisateur_id)
       VALUES (timezone('Indian/Antananarivo', CURRENT_TIMESTAMP)::date, 'CHARGEMENT', $1::time, $2::time,
          $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::uuid, $16::uuid)
       RETURNING id, site_id AS "siteId", date_operation::text AS date, type_flux AS type,
          to_char(heure_arrivee, 'HH24:MI') AS "heureDebut",
          to_char(heure_sortie, 'HH24:MI') AS "heureSortie", camion, proprietaire,
          nom_chauffeur AS "nomChauffeur", designation, quantite_texte AS "quantiteTexte",
          poids, destinataire, provenance, lp, titre, plomb, type_chargement AS "typeChargement"`,
      [entry.heureDebut, entry.heureSortie, entry.camion, entry.proprietaire, entry.nomChauffeur,
        entry.designation, entry.quantiteTexte, entry.poids, entry.destinataire, entry.provenance,
        entry.lp, entry.titre, entry.plomb, entry.typeChargement, siteId, userId],
    );
    const site = await client.query("SELECT nom AS \"siteName\" FROM site WHERE id = $1::uuid", [siteId]);
    await client.query("COMMIT");
    json(response, 201, { entry: { ...result.rows[0], siteName: site.rows[0]?.siteName } });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("POST star/particulier loading failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible d’enregistrer le chargement." });
  } finally {
    client?.release();
  }
}

export async function updateStarParticulierLoading(request, response, pool, userId, entryId) {
  let client;
  try {
    if (!uuidPattern.test(entryId)) return json(response, 404, { error: "Chargement introuvable." });
    const body = await readJson(request);
    const entry = validateStarParticulierLoading(body);
    client = await pool.connect();
    await client.query("BEGIN");
    const account = await getAccount(client, userId);
    const siteId = await resolveSite(client, account, body);
    const result = await client.query(
      `UPDATE flux_logistique
       SET heure_arrivee = $2::time, heure_sortie = $3::time, camion = $4,
           proprietaire = $5, nom_chauffeur = $6, designation = $7,
           quantite_texte = $8, poids = $9, destinataire = $10, provenance = $11,
           lp = $12, titre = $13, plomb = $14, type_chargement = $15
       WHERE id = $1::uuid AND site_id = $16::uuid
         AND type_flux = 'CHARGEMENT' AND type_chargement IS NOT NULL
       RETURNING id, site_id AS "siteId", date_operation::text AS date, type_flux AS type,
          to_char(heure_arrivee, 'HH24:MI') AS "heureDebut",
          to_char(heure_sortie, 'HH24:MI') AS "heureSortie", camion, proprietaire,
          nom_chauffeur AS "nomChauffeur", designation, quantite_texte AS "quantiteTexte",
          poids, destinataire, provenance, lp, titre, plomb, type_chargement AS "typeChargement"`,
      [entryId, entry.heureDebut, entry.heureSortie, entry.camion, entry.proprietaire,
        entry.nomChauffeur, entry.designation, entry.quantiteTexte, entry.poids,
        entry.destinataire, entry.provenance, entry.lp, entry.titre, entry.plomb,
        entry.typeChargement, siteId],
    );
    if (!result.rows[0]) {
      await client.query("ROLLBACK");
      return json(response, 404, { error: "Chargement introuvable sur ce site." });
    }
    const site = await client.query("SELECT nom AS \"siteName\" FROM site WHERE id = $1::uuid", [siteId]);
    await client.query("COMMIT");
    json(response, 200, { entry: { ...result.rows[0], siteName: site.rows[0]?.siteName } });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("PUT star/particulier loading failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible de modifier le chargement." });
  } finally {
    client?.release();
  }
}

export async function deleteStarParticulierLoading(request, response, pool, userId, entryId) {
  try {
    if (!uuidPattern.test(entryId)) return json(response, 404, { error: "Chargement introuvable." });
    const account = await getAccount(pool, userId);
    const siteId = await querySiteForRead(pool, account, request);
    if (!siteId) return json(response, 400, { error: "Sélectionnez un site pour supprimer le chargement." });
    const result = await pool.query(
      `DELETE FROM flux_logistique
       WHERE id = $1::uuid AND site_id = $2::uuid
         AND type_flux = 'CHARGEMENT' AND type_chargement IS NOT NULL
       RETURNING id`,
      [entryId, siteId],
    );
    if (!result.rows[0]) return json(response, 404, { error: "Chargement introuvable sur ce site." });
    json(response, 200, { id: result.rows[0].id, deleted: true });
  } catch (error) {
    console.error("DELETE star/particulier loading failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible de supprimer le chargement." });
  }
}

export async function createLogisticsEntry(request, response, pool, userId) {
  const client = await pool.connect();
  try {
    const body = await readJson(request);
    const requestedType = typeof body.type === "string" ? body.type : body.typeFlux;
    const type = typeof requestedType === "string" ? requestedType.trim().toUpperCase() : "";
    const date = normalizeDate(body.date ?? body.dateOperation);
    if (!fluxTypes.has(type)) {
      return json(response, 400, { error: "Le type de flux est invalide. Sélectionnez le déchargement de bouteilles vides." });
    }
    if (!validDate(date)) {
      return json(response, 400, { error: "La date est invalide. Choisissez une date valide dans le formulaire." });
    }

    await client.query("BEGIN");
    const account = await getAccount(client, userId);
    const siteId = await resolveSite(client, account, body);
    const siteResult = await client.query("SELECT nom, type_site FROM site WHERE id = $1::uuid", [siteId]);
    const site = siteResult.rows[0];
    if (!site) throw Object.assign(new Error("Site de travail introuvable."), { status: 404 });

    if (type === "BOUTEILLES_VIDES") {
      const time = cleanText(body.heureArrivee, 5);
      const endTimeInput = typeof body.heureFin === "string" ? body.heureFin.trim() : "";
      const endTime = endTimeInput || null;
      const immatriculation = cleanText(body.immatriculationVehicule, 100);
      const nomChauffeur = cleanText(body.nomChauffeur, 255);
      const numeroTitre = cleanText(body.numeroTitre, 100);
      const plomb = cleanText(body.plomb, 100);
      const provenance = typeof body.provenance === "number"
        ? String(body.provenance)
        : cleanText(body.provenance, 100);
      const poids = Number(body.poids);
      const details = Array.isArray(body.detailsBouteilles) ? body.detailsBouteilles : [];
      const seenDesignations = new Set();
      const normalizedDetails = details.map((item) => {
        const designation = cleanText(item?.designation, 50);
        const quantity = Number(item?.quantite);
        if (!bottleDesignations.has(designation) || seenDesignations.has(designation)
          || !Number.isInteger(quantity) || quantity < 1 || quantity > 1_000_000) {
          throw Object.assign(new Error("Vérifiez chaque type d’article et sa quantité."), { status: 400 });
        }
        seenDesignations.add(designation);
        return { designation, quantite: quantity };
      });
      if (!timePattern.test(time) || (endTime && !timePattern.test(endTime))
        || !immatriculation || !nomChauffeur || !/^\d+$/.test(numeroTitre)
        || !/^\d+$/.test(provenance)
        || !Number.isFinite(poids) || poids <= 0 || poids > 9999999999.99
        || normalizedDetails.length === 0 || normalizedDetails.length > maxBottleDesignationLines) {
        throw Object.assign(new Error("Renseignez l’heure d’arrivée, l’immatriculation, le nom du chauffeur, le numéro de titre, une provenance numérique, un poids positif et les quantités par format."), { status: 400 });
      }
      const result = await client.query(
        `INSERT INTO flux_logistique
           (date_operation, type_flux, heure_arrivee, heure_sortie, immatriculation_vehicule,
            nom_chauffeur, numero_titre, plomb, provenance, poids, details_bouteilles, site_id, utilisateur_id)
         VALUES ($1::date, 'BOUTEILLES_VIDES', $2::time, $3::time, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::uuid, $12::uuid)
         RETURNING id, cree_le AS "createdAt"`,
        [date, time, endTime, immatriculation, nomChauffeur, numeroTitre, plomb, provenance, poids,
          JSON.stringify(normalizedDetails), siteId, userId],
      );
      await client.query("COMMIT");
      return json(response, 201, {
        entry: {
          ...result.rows[0], date, type, heureArrivee: time, heureFin: endTime,
          immatriculationVehicule: immatriculation, nomChauffeur, numeroTitre, plomb, provenance,
          poids, detailsBouteilles: normalizedDetails,
          siteName: site.nom, siteType: site.type_site,
        },
      });
    }

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

    if (type === "DECHETS") {
      const typeDechet = cleanText(body.typeDechet, 20).toUpperCase();
      const time = cleanText(body.heureSortie, 5);
      const numeroPesage = cleanText(body.numeroPesage, 100);
      const facture = cleanText(body.facture, 160);
      const poids = Number(body.poids);
      const destinataire = cleanText(body.destinataire, 255);
      const vehicule = cleanText(body.vehicule, 160);
      if (!["LEVURE", "DRECHE"].includes(typeDechet) || !timePattern.test(time) || !numeroPesage || !facture || !Number.isFinite(poids) || poids <= 0 || poids > 9999999999.99 || !destinataire || !vehicule) {
        throw Object.assign(new Error("Choisissez le type de sortie et renseignez l’heure, le pesage, la facture, un poids positif, le destinataire et le véhicule."), { status: 400 });
      }
      await requireRegisteredDriverVehicle(client, siteId, vehicule);
      const result = await client.query(
        `INSERT INTO flux_logistique
           (date_operation, type_flux, type_dechet, heure_sortie, numero_pesage, facture, poids, destinataire, vehicule, site_id, utilisateur_id)
         VALUES ($1::date, 'DECHETS', $2, $3::time, $4, $5, $6, $7, $8, $9::uuid, $10::uuid)
         RETURNING id, cree_le AS "createdAt"`,
        [date, typeDechet, time, numeroPesage, facture, poids, destinataire, vehicule, siteId, userId],
      );
      await client.query("COMMIT");
      return json(response, 201, {
        entry: {
          ...result.rows[0], date, type, typeDechet, heureSortie: time, numeroPesage, facture, poids, destinataire, vehicule,
          siteName: site.nom, siteType: site.type_site,
        },
      });
    }

    if (type === "MATIERE_PREMIERE") {
      const time = cleanText(body.heurePointe, 5);
      const vehicule = cleanText(body.vehicule, 160);
      const designation = cleanText(body.designation, 160);
      const quantity = Number(body.quantite);
      const document = cleanText(body.document, 160);
      const provenance = cleanText(body.provenance, 255);
      if (!timePattern.test(time) || !vehicule || !designation || !Number.isFinite(quantity) ||
          quantity <= 0 || quantity > 9999999999.99 || !document || !provenance) {
        throw Object.assign(new Error("Renseignez l’heure de pointe, le véhicule, la désignation, une quantité positive, le bon de livraison/facture et la provenance."), { status: 400 });
      }
      await requireRegisteredDriverVehicle(client, siteId, vehicule);
      const result = await client.query(
        `INSERT INTO flux_logistique
           (date_operation, type_flux, camion, heure_pointe, designation, quantite, document, provenance, site_id, utilisateur_id)
         VALUES ($1::date, 'MATIERE_PREMIERE', $2, $3::time, $4, $5, $6, $7, $8::uuid, $9::uuid)
         RETURNING id, cree_le AS "createdAt"`,
        [date, vehicule, time, designation, quantity, document, provenance, siteId, userId],
      );
      await client.query("COMMIT");
      return json(response, 201, {
        entry: {
          ...result.rows[0], date, type, vehicule, heurePointe: time, designation,
          quantite: quantity, document, provenance, siteName: site.nom, siteType: site.type_site,
        },
      });
    }

    if (type === "DEPOTAGE_FUEL") {
      const time = cleanText(body.heurePointe, 5);
      const titre = cleanText(body.titre, 160);
      const plomb = cleanText(body.plomb, 100);
      const designation = cleanText(body.designation, 160);
      const quantity = Number(body.quantite);
      const cree = cleanText(body.cree, 160);
      const chauffeur = cleanText(body.chauffeur, 160);
      const magasinier = cleanText(body.magasinier, 160);
      if (!timePattern.test(time) || !titre || !plomb || !designation || !cree ||
          !Number.isFinite(quantity) || quantity <= 0 || quantity > 9999999999.99 ||
          !chauffeur || !magasinier) {
        throw Object.assign(new Error("Renseignez l’heure de pointe, le titre, le plomb, la désignation, une quantité positive, le nom du créateur, le chauffeur et le magasinier."), { status: 400 });
      }
      await requireRegisteredDriverName(client, siteId, chauffeur);
      const result = await client.query(
        `INSERT INTO flux_logistique
           (date_operation, type_flux, heure_pointe, titre, plomb, designation, quantite, cree, chauffeur, magasinier, site_id, utilisateur_id)
         VALUES ($1::date, 'DEPOTAGE_FUEL', $2::time, $3, $4, $5, $6, $7, $8, $9, $10::uuid, $11::uuid)
         RETURNING id, cree_le AS "createdAt"`,
        [date, time, titre, plomb, designation, quantity, cree, chauffeur, magasinier, siteId, userId],
      );
      await client.query("COMMIT");
      return json(response, 201, {
        entry: {
          ...result.rows[0], date, type, heurePointe: time, titre, plomb, designation,
          quantite: quantity, cree, chauffeur, magasinier, siteName: site.nom, siteType: site.type_site,
        },
      });
    }

    if (!truckTypes.has(type)) {
      throw Object.assign(new Error("Le type de flux camion est invalide."), { status: 400 });
    }
    if (type === "DECHARGEMENT") {
      const immatriculation = cleanText(body.immatriculationVehicule, 100);
      const heureSortie = cleanText(body.heureSortie, 5);
      const designation = cleanText(body.designation, 20000);
      const nbr = cleanText(body.nbr, 255);
      const facture = cleanText(body.facture, 160);
      if (!immatriculation || !timePattern.test(heureSortie) || !designation || !nbr || !/^\d{1,4}$/.test(facture)) {
        throw Object.assign(new Error("Renseignez le matricule, une heure de sortie, la désignation, le nombre et une facture de 1 à 4 chiffres."), { status: 400 });
      }
      const result = await client.query(
        `INSERT INTO flux_logistique
           (date_operation, type_flux, camion, immatriculation_vehicule, vehicule,
            heure_sortie, designation, nbr, facture, document, site_id, utilisateur_id)
         VALUES ($1::date, 'DECHARGEMENT', $2, $2, $2, $3::time, $4, $5, $6, $6, $7::uuid, $8::uuid)
         RETURNING id, cree_le AS "createdAt"`,
        [date, immatriculation, heureSortie, designation, nbr, facture, siteId, userId],
      );
      await client.query("COMMIT");
      return json(response, 201, {
        entry: {
          ...result.rows[0], date, type, immatriculationVehicule: immatriculation,
          heureSortie, designation, nbr, facture, siteName: site.nom, siteType: site.type_site,
        },
      });
    }

    const camion = cleanText(body.camion, 160);
    const nomChauffeur = cleanText(body.nomChauffeur, 255);
    const heureArrivee = cleanText(body.heureArrivee, 5);
    const designation = cleanText(body.designation, 20000);
    const nbr = cleanText(body.nbr, 255);
    const document = cleanText(body.document, 160) || null;
    const destinataire = cleanText(body.destinataire, 255);
    if (!camion || !nomChauffeur || !timePattern.test(heureArrivee)
      || !designation || !nbr || !document || !destinataire) {
      throw Object.assign(new Error("Renseignez le transport, le nom du chauffeur, l’heure d’entrée, la désignation, le NBR, le numéro de bon ou facture et la destination."), { status: 400 });
    }
    const result = await client.query(
      `INSERT INTO flux_logistique
         (date_operation, type_flux, camion, nom_chauffeur, heure_arrivee, designation, nbr, document, destinataire, site_id, utilisateur_id)
       VALUES ($1::date, $2, $3, $4, $5::time, $6, $7, $8, $9, $10::uuid, $11::uuid)
       RETURNING id, cree_le AS "createdAt"`,
      [date, type, camion, nomChauffeur, heureArrivee, designation, nbr, document, destinataire, siteId, userId],
    );
    await client.query("COMMIT");
    json(response, 201, {
      entry: {
        ...result.rows[0], date, type, camion, nomChauffeur, heureArrivee,
        designation, nbr, document, destinataire, siteName: site.nom, siteType: site.type_site,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("POST /logistics failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible d'enregistrer le flux logistique." });
  } finally {
    client.release();
  }
}

export async function updateTruckLogisticsEntry(request, response, pool, userId, entryId) {
  const client = await pool.connect();
  try {
    if (!uuidPattern.test(entryId)) return json(response, 404, { error: "Mouvement camion introuvable." });
    const body = await readJson(request);
    const date = normalizeDate(body.date);
    const type = cleanText(body.type, 20).toUpperCase();
    if (type === "DECHARGEMENT") {
      const immatriculation = cleanText(body.immatriculationVehicule, 100);
      const heureSortie = cleanText(body.heureSortie, 5);
      const designation = cleanText(body.designation, 20000);
      const nbr = cleanText(body.nbr, 255);
      const facture = cleanText(body.facture, 160);
      if (!validDate(date) || !immatriculation || !timePattern.test(heureSortie)
        || !designation || !nbr || !/^\d{1,4}$/.test(facture)) {
        return json(response, 400, { error: "Renseignez une date, un matricule, une heure de sortie, une désignation, un nombre et une facture de 1 à 4 chiffres." });
      }

      await client.query("BEGIN");
      const account = await getAccount(client, userId);
      const siteId = await resolveSite(client, account, body);
      const result = await client.query(
        `UPDATE flux_logistique
         SET date_operation = $2::date, camion = $3, immatriculation_vehicule = $3, vehicule = $3,
             heure_sortie = $4::time, designation = $5, nbr = $6, facture = $7, document = $7
         WHERE id = $1::uuid AND site_id = $8::uuid AND type_flux = 'DECHARGEMENT'
         RETURNING id, date_operation::text AS date, type_flux AS type,
                   immatriculation_vehicule AS "immatriculationVehicule",
                   to_char(heure_sortie, 'HH24:MI') AS "heureSortie",
                   designation, nbr, facture`,
        [entryId, date, immatriculation, heureSortie, designation, nbr, facture, siteId],
      );
      if (!result.rows[0]) {
        await client.query("ROLLBACK");
        return json(response, 404, { error: "Mouvement camion introuvable sur ce site." });
      }
      await client.query("COMMIT");
      return json(response, 200, { entry: result.rows[0] });
    }
    const camion = cleanText(body.camion, 160);
    const nomChauffeur = cleanText(body.nomChauffeur, 255);
    const heureArrivee = cleanText(body.heureArrivee, 5);
    const designation = cleanText(body.designation, 20000);
    const nbr = cleanText(body.nbr, 255);
    const document = cleanText(body.document, 160);
    const destinataire = cleanText(body.destinataire, 255);
    if (!validDate(date) || !truckTypes.has(type) || !camion || !nomChauffeur
      || !timePattern.test(heureArrivee) || !designation || !nbr || !document || !destinataire) {
      return json(response, 400, { error: "Vérifiez les champs du mouvement camion et l’heure d’entrée." });
    }

    await client.query("BEGIN");
    const account = await getAccount(client, userId);
    const siteId = await resolveSite(client, account, body);
    const result = await client.query(
      `UPDATE flux_logistique
       SET date_operation = $2::date, type_flux = $3, camion = $4, nom_chauffeur = $5,
           heure_arrivee = $6::time, designation = $7, nbr = $8, document = $9, destinataire = $10
       WHERE id = $1::uuid AND site_id = $11::uuid
         AND type_flux IN ('DECHARGEMENT', 'CHARGEMENT')
       RETURNING id, date_operation::text AS date, type_flux AS type, camion,
                 nom_chauffeur AS "nomChauffeur", to_char(heure_arrivee, 'HH24:MI') AS "heureArrivee",
                 designation, nbr, document, destinataire`,
      [entryId, date, type, camion, nomChauffeur, heureArrivee, designation, nbr, document, destinataire, siteId],
    );
    if (!result.rows[0]) {
      await client.query("ROLLBACK");
      return json(response, 404, { error: "Mouvement camion introuvable sur ce site." });
    }
    await client.query("COMMIT");
    json(response, 200, { entry: { ...result.rows[0] } });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("PUT truck logistics entry failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible de modifier le mouvement camion." });
  } finally {
    client.release();
  }
}

export async function deleteTruckLogisticsEntry(request, response, pool, userId, entryId) {
  try {
    if (!uuidPattern.test(entryId)) return json(response, 404, { error: "Mouvement camion introuvable." });
    const account = await getAccount(pool, userId);
    const siteId = await querySiteForRead(pool, account, request);
    if (!siteId) return json(response, 400, { error: "Sélectionnez un site pour supprimer le mouvement." });
    const result = await pool.query(
      `DELETE FROM flux_logistique
       WHERE id = $1::uuid AND site_id = $2::uuid
         AND type_flux IN ('DECHARGEMENT', 'CHARGEMENT')
       RETURNING id`,
      [entryId, siteId],
    );
    if (!result.rows[0]) return json(response, 404, { error: "Mouvement camion introuvable sur ce site." });
    json(response, 200, { id: result.rows[0].id, deleted: true });
  } catch (error) {
    console.error("DELETE truck logistics entry failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible de supprimer le mouvement camion." });
  }
}

export async function updateEmptyBottleEntry(request, response, pool, userId, entryId) {
  const client = await pool.connect();
  try {
    if (!uuidPattern.test(entryId)) return json(response, 404, { error: "Réception de bouteilles introuvable." });
    const body = await readJson(request);
    const date = cleanText(body.date, 10);
    const time = cleanText(body.heureArrivee, 5);
    const endTimeInput = typeof body.heureFin === "string" ? body.heureFin.trim() : "";
    const endTime = endTimeInput || null;
    const immatriculation = cleanText(body.immatriculationVehicule, 100);
    const nomChauffeur = cleanText(body.nomChauffeur, 255);
    const numeroTitre = cleanText(body.numeroTitre, 100);
    const plomb = cleanText(body.plomb, 100);
    const provenance = typeof body.provenance === "number"
      ? String(body.provenance)
      : cleanText(body.provenance, 100);
    const poids = Number(body.poids);
    const details = Array.isArray(body.detailsBouteilles) ? body.detailsBouteilles : [];
    const seenDesignations = new Set();
    const normalizedDetails = details.map((item) => {
      const designation = cleanText(item?.designation, 50);
      const quantity = Number(item?.quantite);
      if (!bottleDesignations.has(designation) || seenDesignations.has(designation)
        || !Number.isInteger(quantity) || quantity < 1 || quantity > 1_000_000) {
        throw Object.assign(new Error("Vérifiez chaque type d’article et sa quantité."), { status: 400 });
      }
      seenDesignations.add(designation);
      return { designation, quantite: quantity };
    });
    if (!validDate(date) || !timePattern.test(time) || (endTime && !timePattern.test(endTime))
      || !immatriculation || !nomChauffeur
      || !/^\d+$/.test(numeroTitre) || !/^\d+$/.test(provenance)
      || !Number.isFinite(poids) || poids <= 0 || poids > 9999999999.99
      || normalizedDetails.length === 0 || normalizedDetails.length > maxBottleDesignationLines) {
      return json(response, 400, { error: "Vérifiez les informations de la réception, le nom du chauffeur et les quantités par format." });
    }

    await client.query("BEGIN");
    const account = await getAccount(client, userId);
    const siteId = await resolveSite(client, account, body);
    const result = await client.query(
      `UPDATE flux_logistique
       SET date_operation = $2::date, heure_arrivee = $3::time, heure_sortie = $4::time,
           immatriculation_vehicule = $5, nom_chauffeur = $6, numero_titre = $7,
           plomb = $8, provenance = $9, poids = $10, details_bouteilles = $11::jsonb
       WHERE id = $1::uuid AND site_id = $12::uuid AND type_flux = 'BOUTEILLES_VIDES'
       RETURNING id`,
      [entryId, date, time, endTime, immatriculation, nomChauffeur, numeroTitre, plomb, provenance,
        poids, JSON.stringify(normalizedDetails), siteId],
    );
    if (!result.rows[0]) {
      await client.query("ROLLBACK");
      return json(response, 404, { error: "Réception de bouteilles introuvable sur ce site." });
    }
    await client.query("COMMIT");
    json(response, 200, { entry: {
      id: entryId, date, type: "BOUTEILLES_VIDES", heureArrivee: time, heureFin: endTime,
      immatriculationVehicule: immatriculation, nomChauffeur, numeroTitre, plomb, provenance,
      poids, detailsBouteilles: normalizedDetails,
    } });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("PUT empty bottle delivery failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible de modifier la réception de bouteilles." });
  } finally {
    client.release();
  }
}

export async function deleteEmptyBottleEntry(request, response, pool, userId, entryId) {
  try {
    if (!uuidPattern.test(entryId)) return json(response, 404, { error: "Réception de bouteilles introuvable." });
    const account = await getAccount(pool, userId);
    const siteId = await querySiteForRead(pool, account, request);
    if (!siteId) return json(response, 400, { error: "Sélectionnez un site pour supprimer la réception." });
    const result = await pool.query(
      `DELETE FROM flux_logistique
       WHERE id = $1::uuid AND site_id = $2::uuid AND type_flux = 'BOUTEILLES_VIDES'
       RETURNING id`,
      [entryId, siteId],
    );
    if (!result.rows[0]) return json(response, 404, { error: "Réception de bouteilles introuvable sur ce site." });
    json(response, 200, { id: result.rows[0].id, deleted: true });
  } catch (error) {
    console.error("DELETE empty bottle delivery failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible de supprimer la réception de bouteilles." });
  }
}

export async function updateWasteEntry(request, response, pool, userId, entryId) {
  const client = await pool.connect();
  try {
    if (!uuidPattern.test(entryId)) {
      return json(response, 404, { error: "Sortie de déchets introuvable." });
    }
    const body = await readJson(request);
    const date = cleanText(body.date, 10);
    const typeDechet = cleanText(body.typeDechet, 20).toUpperCase();
    const time = cleanText(body.heureSortie, 5);
    const numeroPesage = cleanText(body.numeroPesage, 100);
    const facture = cleanText(body.facture, 160);
    const poids = Number(body.poids);
    const destinataire = cleanText(body.destinataire, 255);
    const vehicule = cleanText(body.vehicule, 160);
    if (!validDate(date) || !["LEVURE", "DRECHE"].includes(typeDechet) || !timePattern.test(time) || !numeroPesage || !facture ||
        !Number.isFinite(poids) || poids <= 0 || poids > 9999999999.99 || !destinataire || !vehicule) {
      return json(response, 400, { error: "Renseignez une date et une heure valides, le pesage, la facture, un poids positif, le destinataire et le véhicule." });
    }

    await client.query("BEGIN");
    const account = await getAccount(client, userId);
    const siteId = await resolveSite(client, account, body);
    const existing = await client.query(
      `SELECT id FROM flux_logistique
       WHERE id = $1::uuid AND type_flux = 'DECHETS' AND site_id = $2::uuid
       FOR UPDATE`,
      [entryId, siteId],
    );
    if (!existing.rows[0]) {
      await client.query("ROLLBACK");
      return json(response, 404, { error: "Sortie de déchets introuvable sur ce site." });
    }
    await requireRegisteredDriverVehicle(client, siteId, vehicule);
    const result = await client.query(
      `UPDATE flux_logistique
       SET date_operation = $2::date, type_dechet = $3, heure_sortie = $4::time, numero_pesage = $5,
           facture = $6, poids = $7, destinataire = $8, vehicule = $9
       WHERE id = $1::uuid
       RETURNING id, date_operation AS date, to_char(heure_sortie, 'HH24:MI') AS "heureSortie",
                 type_dechet AS "typeDechet", numero_pesage AS "numeroPesage", facture, poids, destinataire, vehicule`,
      [entryId, date, typeDechet, time, numeroPesage, facture, poids, destinataire, vehicule],
    );
    await client.query("COMMIT");
    json(response, 200, { entry: { ...result.rows[0], type: "DECHETS" } });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("PUT /logistics/:id failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible de modifier la sortie de déchets." });
  } finally {
    client.release();
  }
}

export async function deleteWasteEntry(request, response, pool, userId, entryId) {
  try {
    if (!uuidPattern.test(entryId)) {
      return json(response, 404, { error: "Sortie de déchets introuvable." });
    }
    const account = await getAccount(pool, userId);
    const siteId = await querySiteForRead(pool, account, request);
    if (!siteId) return json(response, 400, { error: "Sélectionnez un site pour supprimer la sortie." });
    const result = await pool.query(
      `DELETE FROM flux_logistique
       WHERE id = $1::uuid AND type_flux = 'DECHETS' AND site_id = $2::uuid
       RETURNING id`,
      [entryId, siteId],
    );
    if (!result.rows[0]) return json(response, 404, { error: "Sortie de déchets introuvable sur ce site." });
    json(response, 200, { id: result.rows[0].id, deleted: true });
  } catch (error) {
    console.error("DELETE /logistics/:id failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible de supprimer la sortie de déchets." });
  }
}

export async function updateMatierePremiereEntry(request, response, pool, userId, entryId) {
  const client = await pool.connect();
  try {
    if (!uuidPattern.test(entryId)) {
      return json(response, 404, { error: "Déchargement introuvable." });
    }
    const body = await readJson(request);
    const date = cleanText(body.date, 10);
    const time = cleanText(body.heurePointe, 5);
    const vehicule = cleanText(body.vehicule, 160);
    const designation = cleanText(body.designation, 160);
    const quantity = Number(body.quantite);
    const document = cleanText(body.document, 160);
    const provenance = cleanText(body.provenance, 255);
    if (!validDate(date) || !timePattern.test(time) || !vehicule || !designation ||
        !Number.isFinite(quantity) || quantity <= 0 || quantity > 9999999999.99 || !document || !provenance) {
      return json(response, 400, { error: "Renseignez une date et heure valides, le véhicule, la désignation, une quantité positive, le bon de livraison/facture et la provenance." });
    }

    await client.query("BEGIN");
    const account = await getAccount(client, userId);
    const siteId = await resolveSite(client, account, body);
    const existing = await client.query(
      `SELECT id FROM flux_logistique
       WHERE id = $1::uuid AND type_flux = 'MATIERE_PREMIERE' AND site_id = $2::uuid
       FOR UPDATE`,
      [entryId, siteId],
    );
    if (!existing.rows[0]) {
      await client.query("ROLLBACK");
      return json(response, 404, { error: "Déchargement introuvable sur ce site." });
    }
    await requireRegisteredDriverVehicle(client, siteId, vehicule);
    const result = await client.query(
      `UPDATE flux_logistique
       SET date_operation = $2::date, camion = $3, heure_pointe = $4::time,
           designation = $5, quantite = $6, document = $7, provenance = $8
       WHERE id = $1::uuid
       RETURNING id, date_operation::text AS date, to_char(heure_pointe, 'HH24:MI') AS "heurePointe",
                 camion AS vehicule, designation, quantite, document, provenance`,
      [entryId, date, vehicule, time, designation, quantity, document, provenance],
    );
    await client.query("COMMIT");
    json(response, 200, { entry: { ...result.rows[0], type: "MATIERE_PREMIERE" } });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("PUT /logistics/:id matter-premiere failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible de modifier le déchargement." });
  } finally {
    client.release();
  }
}

export async function deleteMatierePremiereEntry(request, response, pool, userId, entryId) {
  try {
    if (!uuidPattern.test(entryId)) {
      return json(response, 404, { error: "Déchargement introuvable." });
    }
    const account = await getAccount(pool, userId);
    const siteId = await querySiteForRead(pool, account, request);
    if (!siteId) return json(response, 400, { error: "Sélectionnez un site pour supprimer le déchargement." });
    const result = await pool.query(
      `DELETE FROM flux_logistique
       WHERE id = $1::uuid AND type_flux = 'MATIERE_PREMIERE' AND site_id = $2::uuid
       RETURNING id`,
      [entryId, siteId],
    );
    if (!result.rows[0]) return json(response, 404, { error: "Déchargement introuvable sur ce site." });
    json(response, 200, { id: result.rows[0].id, deleted: true });
  } catch (error) {
    console.error("DELETE /logistics/:id matter-premiere failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible de supprimer le déchargement." });
  }
}

export async function updateDepotageFuelEntry(request, response, pool, userId, entryId) {
  const client = await pool.connect();
  try {
    if (!uuidPattern.test(entryId)) {
      return json(response, 404, { error: "Dépotage fuel/gasoil introuvable." });
    }
    const body = await readJson(request);
    const date = cleanText(body.date, 10);
    const time = cleanText(body.heurePointe, 5);
    const titre = cleanText(body.titre, 160);
    const plomb = cleanText(body.plomb, 100);
    const designation = cleanText(body.designation, 160);
    const quantity = Number(body.quantite);
    const cree = cleanText(body.cree, 160);
    const chauffeur = cleanText(body.chauffeur, 160);
    const magasinier = cleanText(body.magasinier, 160);
    if (!validDate(date) || !timePattern.test(time) || !titre || !plomb || !designation || !cree ||
        !Number.isFinite(quantity) || quantity <= 0 || quantity > 9999999999.99 ||
        !chauffeur || !magasinier) {
      return json(response, 400, { error: "Renseignez une date et une heure valides, le titre, le plomb, la désignation, une quantité positive, le créateur, le chauffeur et le magasinier." });
    }

    await client.query("BEGIN");
    const account = await getAccount(client, userId);
    const siteId = await resolveSite(client, account, body);
    const existing = await client.query(
      `SELECT id FROM flux_logistique
       WHERE id = $1::uuid AND type_flux = 'DEPOTAGE_FUEL' AND site_id = $2::uuid
       FOR UPDATE`,
      [entryId, siteId],
    );
    if (!existing.rows[0]) {
      await client.query("ROLLBACK");
      return json(response, 404, { error: "Dépotage fuel/gasoil introuvable sur ce site." });
    }
    await requireRegisteredDriverName(client, siteId, chauffeur);
    const result = await client.query(
      `UPDATE flux_logistique
       SET date_operation = $2::date, heure_pointe = $3::time, titre = $4, plomb = $5,
           designation = $6, quantite = $7, cree = $8, chauffeur = $9, magasinier = $10
       WHERE id = $1::uuid
       RETURNING id, date_operation::text AS date, to_char(heure_pointe, 'HH24:MI') AS "heurePointe",
                 titre, plomb, designation, quantite, cree, chauffeur, magasinier`,
      [entryId, date, time, titre, plomb, designation, quantity, cree, chauffeur, magasinier],
    );
    await client.query("COMMIT");
    json(response, 200, { entry: { ...result.rows[0], type: "DEPOTAGE_FUEL" } });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("PUT /logistics/:id fuel-depotage failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible de modifier le dépotage fuel/gasoil." });
  } finally {
    client.release();
  }
}

export async function deleteDepotageFuelEntry(request, response, pool, userId, entryId) {
  try {
    if (!uuidPattern.test(entryId)) {
      return json(response, 404, { error: "Dépotage fuel/gasoil introuvable." });
    }
    const account = await getAccount(pool, userId);
    const siteId = await querySiteForRead(pool, account, request);
    if (!siteId) return json(response, 400, { error: "Sélectionnez un site pour supprimer le dépotage." });
    const result = await pool.query(
      `DELETE FROM flux_logistique
       WHERE id = $1::uuid AND type_flux = 'DEPOTAGE_FUEL' AND site_id = $2::uuid
       RETURNING id`,
      [entryId, siteId],
    );
    if (!result.rows[0]) return json(response, 404, { error: "Dépotage fuel/gasoil introuvable sur ce site." });
    json(response, 200, { id: result.rows[0].id, deleted: true });
  } catch (error) {
    console.error("DELETE /logistics/:id fuel-depotage failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible de supprimer le dépotage fuel/gasoil." });
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

export async function updateLogisticsIncident(request, response, pool, userId, entryId) {
  try {
    const body = await readJson(request);
    const date = normalizeDate(body.date);
    const time = cleanText(body.time, 5);
    const facts = cleanText(body.facts, 20000);
    if (!validDate(date) || !timePattern.test(time) || !facts) {
      return json(response, 400, { error: "Indiquez une date, une heure et une description valides." });
    }
    const account = await getAccount(pool, userId);
    const siteId = await resolveSite(pool, account, body);
    const result = await pool.query(
      `UPDATE signalement_logistique
       SET date_operation=$1::date, heure=$2::time, personne=$3, observations=$4,
           description_faits=$5, mesures_prises=$6
       WHERE id=$7::uuid AND site_id=$8::uuid AND type_signalement='ANOMALIE'
       RETURNING id, date_operation AS date, to_char(heure, 'HH24:MI') AS time,
                 personne AS person, observations, description_faits AS facts,
                 mesures_prises AS measures`,
      [date, time, cleanText(body.person) || null, cleanText(body.observations, 20000) || null,
        facts, cleanText(body.measures, 20000) || null, entryId, siteId],
    );
    if (!result.rows[0]) return json(response, 404, { error: "Anomalie introuvable pour ce site." });
    json(response, 200, { entry: result.rows[0] });
  } catch (error) {
    console.error("PUT /logistics/incidents/:id failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible de modifier l'anomalie." });
  }
}

export async function deleteLogisticsIncident(request, response, pool, userId, entryId) {
  try {
    const account = await getAccount(pool, userId);
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const siteId = await resolveSite(pool, account, { siteId: url.searchParams.get("siteId") });
    const result = await pool.query(
      "DELETE FROM signalement_logistique WHERE id=$1::uuid AND site_id=$2::uuid AND type_signalement='ANOMALIE' RETURNING id",
      [entryId, siteId],
    );
    if (!result.rows[0]) return json(response, 404, { error: "Anomalie introuvable pour ce site." });
    json(response, 200, { id: result.rows[0].id, deleted: true });
  } catch (error) {
    console.error("DELETE /logistics/incidents/:id failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible de supprimer l'anomalie." });
  }
}
