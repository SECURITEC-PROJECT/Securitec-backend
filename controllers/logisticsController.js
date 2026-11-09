import { json, readJson } from "../utils/helpers.js";
import { resolvePriseDePosteId } from "../utils/priseDePoste.js";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const truckTypes = new Set(["DECHARGEMENT", "CHARGEMENT", "ORDURES"]);
const fluxTypes = new Set(["DECHARGEMENT", "CHARGEMENT", "INVENTAIRE", "DECHETS", "BOUTEILLES_VIDES", "MATIERE_PREMIERE", "DEPOTAGE_FUEL", "ORDURES"]);
const wasteRegisterDesignations = new Set(["Verres cassées", "Ordures", "Gravat"]);
const paletteLoadingDesignations = new Set([
  "Palette : 1055 x 1310",
  "Palette : 1000 x 1200",
  "Palette : 800 x 1200",
]);
const logisticsDocumentTypes = new Set(["BON", "FACTURE", "BON_SORTIE"]);
const incidentTypes = new Set(["ANOMALIE", "DIVERS", "VIOLATION_PROCEDURE"]);
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
const normalizeFuelDesignation = (value) => {
  const normalized = cleanText(value, 160).toLocaleUpperCase("fr");
  return normalized === "FUEL OIL" ? "Fuel oil" : normalized === "GASOIL" ? "Gasoil" : "";
};
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

const readPondBrut = (value) => {
  if (!value || typeof value !== "object") return null;
  const brut = Number(value.brut);
  const tare = Number(value.tare);
  const net = Number(value.net);
  const clientFournisseur = cleanText(value.clientFournisseur, 255);
  const produit = cleanText(value.produit, 255);
  const remarque = cleanText(value.remarque, 2000);
  if (!Number.isFinite(brut) || !Number.isFinite(tare) || brut <= 0 || tare <= 0
    || !Number.isFinite(net) || brut > 9999999999.99 || tare > 9999999999.99 || net <= 0 || net > 9999999999.99
  ) {
    throw Object.assign(new Error("Saisissez un BRUT, une TARE et un NET positifs."), { status: 400 });
  }
  return { brut, tare, net, clientFournisseur, produit, remarque, observation: remarque };
};

async function getAccount(pool, userId) {
  const result = await pool.query(
    "SELECT id, nom, site_id, role FROM utilisateur WHERE id = $1::uuid LIMIT 1",
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

async function resolveOpenPostShift(client, siteId, requestedId = null, posteId = null) {
  if (requestedId && !uuidPattern.test(requestedId)) {
    throw Object.assign(new Error("La prise de poste sélectionnée est invalide."), { status: 400 });
  }
  if (posteId && !uuidPattern.test(posteId)) {
    throw Object.assign(new Error("Le poste sélectionné est invalide."), { status: 400 });
  }
  const result = await client.query(
    `SELECT DISTINCT ON (COALESCE(sp.id,p.service_id,p.id)) p.id
     FROM prise_de_poste p
     LEFT JOIN service_poste sp ON sp.id=COALESCE(p.service_id,p.id)
     LEFT JOIN poste po ON po.id=COALESCE(sp.poste_id,p.poste_id)
     JOIN site s ON s.id=$1::uuid AND s.actif=true
     WHERE (sp.site_id=s.id OR po.site_id=s.id OR EXISTS (
       SELECT 1 FROM site legacy_site
       WHERE legacy_site.id=s.id
         AND LOWER(BTRIM(legacy_site.nom))=LOWER(BTRIM(p.site_de_travail))
     ))
       AND ($2::uuid IS NULL OR p.id=$2::uuid OR sp.id=$2::uuid OR p.service_id=$2::uuid)
       AND ($3::uuid IS NULL OR COALESCE(sp.poste_id,p.poste_id)=$3::uuid)
       AND p.ended_at IS NULL AND sp.ended_at IS NULL
     ORDER BY COALESCE(sp.id,p.service_id,p.id), CASE WHEN p.fonction_service='CHEF' THEN 0 ELSE 1 END, p.started_at DESC LIMIT 2`,
    [siteId, requestedId, posteId],
  );
  if (!requestedId && !posteId && result.rows.length > 1) {
    throw Object.assign(new Error("Plusieurs services sont ouverts sur ce site. Sélectionnez le poste concerné avant de saisir."), { status: 409 });
  }
  if (!result.rows[0]) {
    throw Object.assign(new Error("Ouvrez une prise de poste pour ce site avant d’enregistrer un flux logistique."), { status: 409 });
  }
  return result.rows[0].id;
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
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const from = validDate(url.searchParams.get("from")) ? url.searchParams.get("from") : null;
    const to = validDate(url.searchParams.get("to")) ? url.searchParams.get("to") : null;
    const type = fluxTypes.has(url.searchParams.get("type")) ? url.searchParams.get("type") : null;
    const result = await pool.query(
      `SELECT f.id, f.date_operation::text AS date, f.type_flux AS type,
              f.camion, f.transporteur, f.document, f.plomb,
              to_char(COALESCE(f.heure_sortie, f.heure_arrivee), 'HH24:MI') AS "heureSortie", f.numero_pesage AS "numeroPesage",
              to_char(f.heure_sortie, 'HH24:MI') AS "heureFin",
              COALESCE(f.facture, f.document) AS facture, f.type_dechet AS "typeDechet", f.poids, f.destinataire,
              f.type_document AS "typeDocument", f.emetteur, f.verification, f.visa_agent AS "visaAgent",
              COALESCE(f.vehicule, f.camion) AS vehicule,
              to_char(f.heure_arrivee, 'HH24:MI') AS "heureArrivee",
              COALESCE(f.immatriculation_vehicule, f.vehicule, f.camion) AS "immatriculationVehicule",
              f.nom_chauffeur AS "nomChauffeur", f.nbr,
              f.numero_titre AS "numeroTitre", f.plomb, f.provenance,
              f.details_bouteilles AS "detailsBouteilles",
              pond.brut, pond.tare, pond.net, pond.observation,
              pond.client_fournisseur AS "clientFournisseur", pond.produit,
              COALESCE(NULLIF(pond.remarque, ''), pond.observation, '') AS remarque,
              to_char(f.heure_pointe, 'HH24:MI') AS "heurePointe", f.designation, f.provenance,
              f.titre, f.cree, f.chauffeur, f.magasinier,
              f.type_chargement AS "typeChargement", f.proprietaire,
              f.quantite_texte AS "quantiteTexte", f.lp,
              f.categorie_stock AS "categorieStock", f.article, f.quantite,
              s.nom AS "siteName", s.type_site AS "siteType", f.cree_le AS "createdAt",
              u.nom AS "createdBy", f.prise_de_poste_id AS "priseDePosteId",
              f.service_poste_id AS "servicePosteId",
              COALESCE(po.nom, service_post.nom) AS "posteNom",
              COALESCE(service_poste.shift_type, pp.shift_type) AS "shiftType",
              (SELECT COUNT(*)::int FROM flux_logistique_document fd WHERE fd.flux_id=f.id) AS "attachmentCount"
       FROM flux_logistique f JOIN site s ON s.id = f.site_id
       JOIN utilisateur u ON u.id=f.utilisateur_id
       LEFT JOIN prise_de_poste pp ON pp.id=f.prise_de_poste_id
       LEFT JOIN poste po ON po.id=pp.poste_id
       LEFT JOIN service_poste ON service_poste.id=f.service_poste_id
       LEFT JOIN poste service_post ON service_post.id=service_poste.poste_id
       LEFT JOIN pond_brut pond ON pond.flux_id=f.id
       WHERE f.site_id = $1::uuid AND f.annule_le IS NULL
         AND ($2::date IS NULL OR f.date_operation >= $2::date)
         AND ($3::date IS NULL OR f.date_operation <= $3::date)
         AND ($4::varchar IS NULL OR f.type_flux = $4::varchar)
       ORDER BY f.date_operation DESC, f.cree_le DESC LIMIT 5000`,
      [siteId, from, to, type],
    );
    json(response, 200, { entries: result.rows });
  } catch (error) {
    console.error("GET /logistics failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible de charger les flux logistiques." });
  }
}

export async function getPondBrutEntries(request, response, pool, userId) {
  try {
    const account = await getAccount(pool, userId);
    const siteId = await querySiteForRead(pool, account, request);
    if (!siteId) return json(response, 200, { entries: [] });
    const result = await pool.query(
      `SELECT pond.id, pond.flux_id AS "fluxId", pond.date_operation::text AS date,
              COALESCE(flux.immatriculation_vehicule, flux.vehicule, flux.camion) AS vehicule,
              pond.brut, pond.tare, pond.net, pond.client_fournisseur AS "clientFournisseur", pond.produit,
              COALESCE(NULLIF(pond.remarque, ''), pond.observation, '') AS remarque,
              site.nom AS "siteName"
       FROM pond_brut pond
       JOIN flux_logistique flux ON flux.id=pond.flux_id
       JOIN site ON site.id=pond.site_id
       WHERE pond.site_id=$1::uuid AND flux.annule_le IS NULL
       ORDER BY pond.date_operation DESC, pond.cree_le DESC LIMIT 5000`,
      [siteId],
    );
    json(response, 200, { entries: result.rows });
  } catch (error) {
    console.error("GET /pond-brut failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible de charger le registre Pond Brut." });
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
              f.immatriculation_vehicule AS "immatriculationVehicule",
              f.proprietaire, f.nom_chauffeur AS "nomChauffeur", f.designation,
              f.quantite_texte AS "quantiteTexte", f.poids, f.destinataire,
              f.provenance, f.lp, f.titre, f.plomb, s.nom AS "siteName"
       FROM flux_logistique f JOIN site s ON s.id = f.site_id
       WHERE f.site_id = $1::uuid AND f.annule_le IS NULL
         AND f.type_flux = 'CHARGEMENT'
         AND f.type_chargement IN ('STAR', 'PARTICULIER', 'PALETTE')
       ORDER BY f.date_operation DESC, f.cree_le DESC LIMIT 1000`,
      [siteId],
    );
    json(response, 200, { entries: result.rows });
  } catch (error) {
    console.error("GET star/particulier loadings failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible de charger le registre des chargements." });
  }
}

export async function getLogisticsAudit(request, response, pool, userId, entryId) {
  try {
    if (!uuidPattern.test(entryId)) return json(response, 404, { error: "Enregistrement introuvable." });
    const account = await getAccount(pool, userId);
    const siteId = await querySiteForRead(pool, account, request);
    if (!siteId) return json(response, 404, { error: "Enregistrement introuvable." });
    const result = await pool.query(
      `SELECT a.id, a.action, a.avant AS "before", a.apres AS "after", a.cree_le AS "createdAt",
              u.nom AS "createdBy"
       FROM audit_flux_logistique a
       JOIN flux_logistique f ON f.id=a.flux_id
       LEFT JOIN utilisateur u ON u.id=a.utilisateur_id
       WHERE a.flux_id=$1::uuid AND f.site_id=$2::uuid
       ORDER BY a.cree_le DESC LIMIT 200`,
      [entryId, siteId],
    );
    json(response, 200, { entries: result.rows });
  } catch (error) {
    console.error("GET logistics audit failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible de charger l’historique." });
  }
}

export async function getLogisticsAttachments(request, response, pool, userId, entryId) {
  try {
    if (!uuidPattern.test(entryId)) return json(response, 404, { error: "Enregistrement introuvable." });
    const account = await getAccount(pool, userId);
    const siteId = await querySiteForRead(pool, account, request);
    if (!siteId) return json(response, 404, { error: "Enregistrement introuvable." });
    const result = await pool.query(
      `SELECT d.id, d.nom AS name, d.extension, d.mime_type AS "mimeType", d.taille AS size,
              d.cree_le AS "createdAt", u.nom AS "createdBy"
       FROM flux_logistique_document fd
       JOIN flux_logistique f ON f.id=fd.flux_id
       JOIN document_site d ON d.id=fd.document_id
       LEFT JOIN utilisateur u ON u.id=fd.utilisateur_id
       WHERE fd.flux_id=$1::uuid AND f.site_id=$2::uuid AND d.site_id=$2::uuid
       ORDER BY fd.cree_le`,
      [entryId, siteId],
    );
    json(response, 200, { attachments: result.rows });
  } catch (error) {
    console.error("GET logistics attachments failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible de charger les pièces jointes." });
  }
}

export async function linkLogisticsAttachment(request, response, pool, userId, entryId) {
  const client = await pool.connect();
  try {
    if (!uuidPattern.test(entryId)) return json(response, 404, { error: "Enregistrement introuvable." });
    const body = await readJson(request);
    const documentId = cleanText(body.documentId, 36);
    if (!uuidPattern.test(documentId)) return json(response, 400, { error: "Document invalide." });
    await client.query("BEGIN");
    const account = await getAccount(client, userId);
    const siteId = await resolveSite(client, account, body);
    const entry = await client.query(
      "SELECT id FROM flux_logistique WHERE id=$1::uuid AND site_id=$2::uuid AND annule_le IS NULL FOR UPDATE",
      [entryId, siteId],
    );
    if (!entry.rows[0]) throw Object.assign(new Error("Enregistrement introuvable sur ce site."), { status: 404 });
    const document = await client.query(
      "SELECT id FROM document_site WHERE id=$1::uuid AND site_id=$2::uuid",
      [documentId, siteId],
    );
    if (!document.rows[0]) throw Object.assign(new Error("Document introuvable sur ce site."), { status: 404 });
    const result = await client.query(
      `INSERT INTO flux_logistique_document (flux_id, document_id, utilisateur_id)
       VALUES ($1::uuid, $2::uuid, $3::uuid)
       ON CONFLICT (flux_id, document_id) DO NOTHING
       RETURNING id, cree_le AS "createdAt"`,
      [entryId, documentId, userId],
    );
    await client.query("COMMIT");
    json(response, 201, { linked: true, attachment: result.rows[0] || { documentId } });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("POST logistics attachment failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible d’associer la pièce jointe." });
  } finally {
    client.release();
  }
}

function validateStarParticulierLoading(body) {
  const date = normalizeDate(body.date);
  const heureDebut = cleanText(body.heureDebut, 5);
  const heureSortie = cleanText(body.heureSortie, 5);
  const camion = cleanText(body.camion, 160);
  const immatriculationVehicule = cleanText(body.immatriculationVehicule, 100);
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
  if (!validDate(date) || !timePattern.test(heureDebut) || !timePattern.test(heureSortie)
    || !camion || !immatriculationVehicule || !proprietaire || !nomChauffeur || !designation
    || !quantiteTexte || !poidsHasValidPrecision || !Number.isFinite(poids) || poids < 0 || poids > 9999999999.99
    || !destinataire || !provenance || !/^\d{1,6}$/.test(lp) || !/^\d{1,8}$/.test(titre)
    || !/^\d{1,8}$/.test(plomb)
    || !["STAR", "PARTICULIER", "PALETTE"].includes(typeChargement)
    || (typeChargement === "PALETTE" && !paletteLoadingDesignations.has(designation))) {
    throw Object.assign(new Error("Vérifiez la date, le type de chargement, les heures HD/HF, le véhicule, le propriétaire, le chauffeur, la désignation, la quantité, le poids, la destination, la provenance et les numéros LP/titre/plomb."), { status: 400 });
  }
  return { date, heureDebut, heureSortie, camion, immatriculationVehicule, proprietaire, nomChauffeur, designation, quantiteTexte, poids, destinataire, provenance, lp, titre, plomb, typeChargement };
}

export async function createStarParticulierLoading(request, response, pool, userId) {
  let client;
  try {
    const body = await readJson(request);
    const entry = validateStarParticulierLoading(body);
    const clientRequestId = uuidPattern.test(body.clientRequestId || "") ? body.clientRequestId : null;
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    await client.query("SELECT set_config('app.client_request_id', $1, true)", [clientRequestId || ""]);
    const account = await getAccount(client, userId);
    const siteId = await resolveSite(client, account, body);
    if (clientRequestId) {
      const duplicate = await client.query(
        `SELECT id, site_id AS "siteId", date_operation::text AS date, type_flux AS type,
                type_chargement AS "typeChargement", cree_le AS "createdAt"
         FROM flux_logistique WHERE client_request_id=$1::uuid AND site_id=$2::uuid LIMIT 1`,
        [clientRequestId, siteId],
      );
      if (duplicate.rows[0]) {
        await client.query("COMMIT");
        return json(response, 200, { entry: duplicate.rows[0], duplicate: true });
      }
    }
    const postShiftId = await resolveOpenPostShift(client, siteId, body.priseDePosteId || null, body.posteId || null);
    await client.query("SELECT set_config('app.prise_de_poste_id', $1, true)", [postShiftId]);
    const result = await client.query(
      `INSERT INTO flux_logistique
         (date_operation, type_flux, heure_arrivee, heure_sortie, camion, immatriculation_vehicule, proprietaire, nom_chauffeur,
          designation, quantite_texte, poids, destinataire, provenance, lp, titre, plomb,
          type_chargement, site_id, utilisateur_id)
       VALUES ($1::date, 'CHARGEMENT', $2::time, $3::time,
          $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::uuid, $18::uuid)
       RETURNING id, site_id AS "siteId", date_operation::text AS date, type_flux AS type,
          to_char(heure_arrivee, 'HH24:MI') AS "heureDebut",
          to_char(heure_sortie, 'HH24:MI') AS "heureSortie", camion,
          immatriculation_vehicule AS "immatriculationVehicule", proprietaire,
          nom_chauffeur AS "nomChauffeur", designation, quantite_texte AS "quantiteTexte",
          poids, destinataire, provenance, lp, titre, plomb, type_chargement AS "typeChargement"`,
      [entry.date, entry.heureDebut, entry.heureSortie, entry.camion, entry.immatriculationVehicule,
        entry.proprietaire, entry.nomChauffeur,
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
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const account = await getAccount(client, userId);
    const siteId = await resolveSite(client, account, body);
    const result = await client.query(
      `UPDATE flux_logistique
       SET date_operation = $2::date, heure_arrivee = $3::time, heure_sortie = $4::time, camion = $5,
           immatriculation_vehicule = $6, proprietaire = $7, nom_chauffeur = $8, designation = $9,
           quantite_texte = $10, poids = $11, destinataire = $12, provenance = $13,
           lp = $14, titre = $15, plomb = $16, type_chargement = $17
       WHERE id = $1::uuid AND site_id = $18::uuid AND annule_le IS NULL
         AND type_flux = 'CHARGEMENT' AND type_chargement IS NOT NULL
       RETURNING id, site_id AS "siteId", date_operation::text AS date, type_flux AS type,
          to_char(heure_arrivee, 'HH24:MI') AS "heureDebut",
          to_char(heure_sortie, 'HH24:MI') AS "heureSortie", camion,
          immatriculation_vehicule AS "immatriculationVehicule", proprietaire,
          nom_chauffeur AS "nomChauffeur", designation, quantite_texte AS "quantiteTexte",
          poids, destinataire, provenance, lp, titre, plomb, type_chargement AS "typeChargement"`,
      [entryId, entry.date, entry.heureDebut, entry.heureSortie, entry.camion,
        entry.immatriculationVehicule, entry.proprietaire,
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
      `UPDATE flux_logistique SET annule_le=CURRENT_TIMESTAMP, modifie_par=$3::uuid
       WHERE id = $1::uuid AND site_id = $2::uuid
         AND type_flux = 'CHARGEMENT' AND type_chargement IS NOT NULL AND annule_le IS NULL
       RETURNING id`,
      [entryId, siteId, userId],
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

    const clientRequestId = uuidPattern.test(body.clientRequestId || "") ? body.clientRequestId : null;
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    await client.query("SELECT set_config('app.client_request_id', $1, true)", [clientRequestId || ""]);
    const account = await getAccount(client, userId);
    const siteId = await resolveSite(client, account, body);
    const siteResult = await client.query("SELECT nom, type_site FROM site WHERE id = $1::uuid", [siteId]);
    const site = siteResult.rows[0];
    if (!site) throw Object.assign(new Error("Site de travail introuvable."), { status: 404 });
    if (clientRequestId) {
      const duplicate = await client.query(
        `SELECT id, date_operation::text AS date, type_flux AS type, cree_le AS "createdAt"
         FROM flux_logistique WHERE client_request_id=$1::uuid AND site_id=$2::uuid LIMIT 1`,
        [clientRequestId, siteId],
      );
      if (duplicate.rows[0]) {
        await client.query("COMMIT");
        return json(response, 200, { entry: duplicate.rows[0], duplicate: true });
      }
    }
    const postShiftId = await resolveOpenPostShift(client, siteId, body.priseDePosteId || null, body.posteId || null);
    await client.query("SELECT set_config('app.prise_de_poste_id', $1, true)", [postShiftId]);

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
      const pondBrut = readPondBrut(body.pondBrut);
      const poids = pondBrut ? pondBrut.net : Number(body.poids);
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
      if (pondBrut) {
        await client.query(
          `INSERT INTO pond_brut
             (flux_id, site_id, utilisateur_id, date_operation, brut, tare, net, observation, client_fournisseur, produit, remarque)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::date, $5, $6, $7, $8, $9, $10, $11)`,
          [result.rows[0].id, siteId, userId, date, pondBrut.brut, pondBrut.tare, pondBrut.net,
            pondBrut.observation, pondBrut.clientFournisseur, pondBrut.produit, pondBrut.remarque],
        );
      }
      await client.query("COMMIT");
      return json(response, 201, {
        entry: {
          ...result.rows[0], date, type, heureArrivee: time, heureFin: endTime,
          immatriculationVehicule: immatriculation, nomChauffeur, numeroTitre, plomb, provenance,
          poids, ...(pondBrut || {}), detailsBouteilles: normalizedDetails,
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
      const plomb = cleanText(body.plomb, 100);
      const poids = Number(body.poids);
      const destinataire = cleanText(body.destinataire, 255);
      const vehicule = cleanText(body.vehicule, 160);
      const transporteur = cleanText(body.transporteur, 255);
      if (!["LEVURE", "DRECHE"].includes(typeDechet) || !timePattern.test(time) || !numeroPesage || !Number.isFinite(poids) || poids <= 0 || poids > 9999999999.99 || !destinataire || !vehicule || !transporteur) {
        throw Object.assign(new Error("Choisissez le type de sortie et renseignez l’heure, le pesage, un poids positif, le destinataire, le véhicule et le transporteur."), { status: 400 });
      }
      const result = await client.query(
        `INSERT INTO flux_logistique
           (date_operation, type_flux, type_dechet, heure_sortie, numero_pesage, facture, plomb, poids, destinataire, vehicule, transporteur, site_id, utilisateur_id)
         VALUES ($1::date, 'DECHETS', $2, $3::time, $4, $5, $6, $7, $8, $9, $10, $11::uuid, $12::uuid)
         RETURNING id, cree_le AS "createdAt"`,
        [date, typeDechet, time, numeroPesage, facture, plomb, poids, destinataire, vehicule, transporteur, siteId, userId],
      );
      await client.query("COMMIT");
      return json(response, 201, {
        entry: {
          ...result.rows[0], date, type, typeDechet, heureSortie: time, numeroPesage, facture, plomb, poids, destinataire, vehicule, transporteur,
          siteName: site.nom, siteType: site.type_site,
        },
      });
    }

    if (type === "MATIERE_PREMIERE") {
      const time = cleanText(body.heurePointe, 5);
      const immatriculation = cleanText(body.immatriculationVehicule, 100);
      const vehicule = cleanText(body.vehicule, 160);
      const designation = cleanText(body.designation, 160);
      const quantity = Number(body.quantite);
      const document = cleanText(body.document, 160);
      const provenance = cleanText(body.provenance, 255);
      if (!timePattern.test(time) || !immatriculation || !vehicule || !designation || !Number.isFinite(quantity) ||
          quantity <= 0 || quantity > 9999999999.99 || !document || !provenance) {
        throw Object.assign(new Error("Renseignez l’heure de pointe, l’immatriculation du camion, le véhicule, la désignation, une quantité positive, le bon de livraison/facture et la provenance."), { status: 400 });
      }
      const result = await client.query(
        `INSERT INTO flux_logistique
           (date_operation, type_flux, camion, immatriculation_vehicule, heure_pointe, designation, quantite, document, provenance, site_id, utilisateur_id)
         VALUES ($1::date, 'MATIERE_PREMIERE', $2, $3, $4::time, $5, $6, $7, $8, $9::uuid, $10::uuid)
         RETURNING id, cree_le AS "createdAt"`,
        [date, vehicule, immatriculation, time, designation, quantity, document, provenance, siteId, userId],
      );
      await client.query("COMMIT");
      return json(response, 201, {
        entry: {
          ...result.rows[0], date, type, vehicule, heurePointe: time, designation,
          immatriculationVehicule: immatriculation, quantite: quantity, document, provenance, siteName: site.nom, siteType: site.type_site,
        },
      });
    }

    if (type === "DEPOTAGE_FUEL") {
      const time = cleanText(body.heurePointe, 5);
      const immatriculation = cleanText(body.immatriculationVehicule, 100);
      const titre = cleanText(body.titre, 160);
      const plomb = cleanText(body.plomb, 100);
      const designation = normalizeFuelDesignation(body.designation);
      const quantity = Number(body.quantite);
      const cree = cleanText(body.cree, 160);
      const chauffeur = cleanText(body.chauffeur, 160);
      const magasinier = cleanText(body.magasinier, 160);
      if (!timePattern.test(time) || !immatriculation || !titre || !plomb || !designation || !cree ||
          !Number.isFinite(quantity) || quantity <= 0 || quantity > 9999999999.99 ||
          !chauffeur || !magasinier) {
        throw Object.assign(new Error("Renseignez l’heure de pointe, l’immatriculation du camion, le titre, le plomb, une désignation Fuel oil ou Gasoil, une quantité positive, le nom du créateur, le chauffeur et le magasinier."), { status: 400 });
      }
      const result = await client.query(
        `INSERT INTO flux_logistique
           (date_operation, type_flux, heure_pointe, immatriculation_vehicule, titre, plomb, designation, quantite, cree, chauffeur, magasinier, site_id, utilisateur_id)
         VALUES ($1::date, 'DEPOTAGE_FUEL', $2::time, $3, $4, $5, $6, $7, $8, $9, $10, $11::uuid, $12::uuid)
         RETURNING id, cree_le AS "createdAt"`,
        [date, time, immatriculation, titre, plomb, designation, quantity, cree, chauffeur, magasinier, siteId, userId],
      );
      await client.query("COMMIT");
      return json(response, 201, {
        entry: {
          ...result.rows[0], date, type, heurePointe: time, titre, plomb, designation,
          immatriculationVehicule: immatriculation, quantite: quantity, cree, chauffeur, magasinier, siteName: site.nom, siteType: site.type_site,
        },
      });
    }

    if (type === "ORDURES") {
      const immatriculation = cleanText(body.immatriculationVehicule, 100);
      const transporteur = cleanText(body.transporteur, 255);
      const designation = cleanText(body.designation, 80);
      const nbr = cleanText(body.nbr, 255);
      const facture = cleanText(body.facture, 160);
      const plomb = cleanText(body.plomb, 100);
      const destinataire = cleanText(body.destinataire, 255);
      if (!immatriculation || !transporteur || !wasteRegisterDesignations.has(designation) || !nbr
        || !facture || !destinataire) {
        throw Object.assign(new Error("Renseignez le véhicule, le transporteur, une désignation autorisée, le nombre, le numéro de facture et la destination."), { status: 400 });
      }
      const result = await client.query(
        `INSERT INTO flux_logistique
           (date_operation, type_flux, camion, immatriculation_vehicule, vehicule, transporteur,
            designation, nbr, facture, document, plomb, destinataire, site_id, utilisateur_id)
         VALUES ($1::date, 'ORDURES', $2, $2, $2, $3, $4, $5, $6, $6, $7, $8, $9::uuid, $10::uuid)
         RETURNING id, cree_le AS "createdAt"`,
        [date, immatriculation, transporteur, designation, nbr, facture, plomb || null, destinataire, siteId, userId],
      );
      await client.query("COMMIT");
      return json(response, 201, {
        entry: {
          ...result.rows[0], date, type, immatriculationVehicule: immatriculation,
          transporteur, designation, nbr, facture, plomb, destinataire, siteName: site.nom, siteType: site.type_site,
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
      const destinataire = cleanText(body.destinataire, 255);
      const typeDocument = cleanText(body.typeDocument, 30).toUpperCase();
      const emetteur = cleanText(body.emetteur, 255);
      const verification = cleanText(body.verification, 2000);
      const visaAgent = cleanText(body.visaAgent, 255);
      if (!immatriculation || !timePattern.test(heureSortie) || !designation || !nbr
        || !facture || !destinataire || !logisticsDocumentTypes.has(typeDocument)) {
        throw Object.assign(new Error("Renseignez le type et le numéro du document, la date, le véhicule, l’heure, l’objet et la destination."), { status: 400 });
      }
      const result = await client.query(
        `INSERT INTO flux_logistique
           (date_operation, type_flux, camion, immatriculation_vehicule, vehicule,
            heure_sortie, designation, nbr, facture, document, destinataire,
            type_document, emetteur, verification, visa_agent, site_id, utilisateur_id)
         VALUES ($1::date, 'DECHARGEMENT', $2, $2, $2, $3::time, $4, $5, $6, $6, $7, $8, $9, $10, $11, $12::uuid, $13::uuid)
         RETURNING id, cree_le AS "createdAt"`,
        [date, immatriculation, heureSortie, designation, nbr, facture, destinataire, typeDocument, emetteur, verification, visaAgent, siteId, userId],
      );
      await client.query("COMMIT");
      return json(response, 201, {
        entry: {
          ...result.rows[0], date, type, immatriculationVehicule: immatriculation,
          heureSortie, designation, nbr, facture, destinataire, typeDocument, emetteur, verification, visaAgent,
          siteName: site.nom, siteType: site.type_site,
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
    if (type === "ORDURES") {
      const immatriculation = cleanText(body.immatriculationVehicule, 100);
      const transporteur = cleanText(body.transporteur, 255);
      const designation = cleanText(body.designation, 80);
      const nbr = cleanText(body.nbr, 255);
      const facture = cleanText(body.facture, 160);
      const plomb = cleanText(body.plomb, 100);
      const destinataire = cleanText(body.destinataire, 255);
      if (!validDate(date) || !immatriculation || !transporteur || !wasteRegisterDesignations.has(designation)
        || !nbr || !facture || !destinataire) {
        return json(response, 400, { error: "Renseignez la date, le véhicule, le transporteur, une désignation autorisée, le nombre, le numéro de facture et la destination." });
      }

      await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
      const account = await getAccount(client, userId);
      const siteId = await resolveSite(client, account, body);
      const result = await client.query(
        `UPDATE flux_logistique
         SET date_operation = $2::date, camion = $3, immatriculation_vehicule = $3,
             vehicule = $3, transporteur = $4, designation = $5, nbr = $6, facture = $7,
             document = $7, plomb = $8, destinataire = $9
         WHERE id = $1::uuid AND site_id = $10::uuid AND type_flux = 'ORDURES' AND annule_le IS NULL
         RETURNING id, date_operation::text AS date, type_flux AS type,
                   immatriculation_vehicule AS "immatriculationVehicule",
                   transporteur, designation, nbr, facture, plomb, destinataire`,
        [entryId, date, immatriculation, transporteur, designation, nbr, facture, plomb || null, destinataire, siteId],
      );
      if (!result.rows[0]) {
        await client.query("ROLLBACK");
        return json(response, 404, { error: "Enregistrement ordures introuvable sur ce site." });
      }
      await client.query("COMMIT");
      return json(response, 200, { entry: result.rows[0] });
    }
    if (type === "DECHARGEMENT") {
      const immatriculation = cleanText(body.immatriculationVehicule, 100);
      const heureSortie = cleanText(body.heureSortie, 5);
      const designation = cleanText(body.designation, 20000);
      const nbr = cleanText(body.nbr, 255);
      const facture = cleanText(body.facture, 160);
      const destinataire = cleanText(body.destinataire, 255);
      const typeDocument = cleanText(body.typeDocument, 30).toUpperCase();
      const emetteur = cleanText(body.emetteur, 255);
      const verification = cleanText(body.verification, 2000);
      const visaAgent = cleanText(body.visaAgent, 255);
      if (!validDate(date) || !immatriculation || !timePattern.test(heureSortie)
        || !designation || !nbr || !facture || !destinataire || !logisticsDocumentTypes.has(typeDocument)) {
        return json(response, 400, { error: "Renseignez la date, le véhicule, l’heure, le type/numéro du document, l’objet et la destination." });
      }

      await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
      const account = await getAccount(client, userId);
      const siteId = await resolveSite(client, account, body);
      const result = await client.query(
        `UPDATE flux_logistique
         SET date_operation = $2::date, camion = $3, immatriculation_vehicule = $3, vehicule = $3,
             heure_sortie = $4::time, designation = $5, nbr = $6, facture = $7, document = $7,
             destinataire = $8, type_document = $9, emetteur = $10, verification = $11, visa_agent = $12
         WHERE id = $1::uuid AND site_id = $13::uuid AND type_flux = 'DECHARGEMENT' AND annule_le IS NULL
         RETURNING id, date_operation::text AS date, type_flux AS type,
                   immatriculation_vehicule AS "immatriculationVehicule",
                   to_char(heure_sortie, 'HH24:MI') AS "heureSortie",
                   designation, nbr, facture, destinataire, type_document AS "typeDocument", emetteur, verification, visa_agent AS "visaAgent"`,
        [entryId, date, immatriculation, heureSortie, designation, nbr, facture, destinataire, typeDocument, emetteur, verification, visaAgent, siteId],
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
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const account = await getAccount(client, userId);
    const siteId = await resolveSite(client, account, body);
    const result = await client.query(
      `UPDATE flux_logistique
       SET date_operation = $2::date, type_flux = $3, camion = $4, nom_chauffeur = $5,
           heure_arrivee = $6::time, designation = $7, nbr = $8, document = $9, destinataire = $10
       WHERE id = $1::uuid AND site_id = $11::uuid AND annule_le IS NULL
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
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const type = cleanText(url.searchParams.get("type"), 20).toUpperCase();
    if (!truckTypes.has(type)) return json(response, 400, { error: "Le type de mouvement est invalide." });
    const account = await getAccount(pool, userId);
    const siteId = await querySiteForRead(pool, account, request);
    if (!siteId) return json(response, 400, { error: "Sélectionnez un site pour supprimer le mouvement." });
    const result = await pool.query(
      `UPDATE flux_logistique SET annule_le=CURRENT_TIMESTAMP, modifie_par=$4::uuid
       WHERE id = $1::uuid AND site_id = $2::uuid
         AND type_flux = $3 AND annule_le IS NULL
       RETURNING id`,
      [entryId, siteId, type, userId],
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
    const pondBrut = readPondBrut(body.pondBrut);
    const poids = pondBrut ? pondBrut.net : Number(body.poids);
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
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const account = await getAccount(client, userId);
    const siteId = await resolveSite(client, account, body);
    const result = await client.query(
      `UPDATE flux_logistique
       SET date_operation = $2::date, heure_arrivee = $3::time, heure_sortie = $4::time,
           immatriculation_vehicule = $5, nom_chauffeur = $6, numero_titre = $7,
           plomb = $8, provenance = $9, poids = $10, details_bouteilles = $11::jsonb
       WHERE id = $1::uuid AND site_id = $12::uuid AND type_flux = 'BOUTEILLES_VIDES' AND annule_le IS NULL
       RETURNING id`,
      [entryId, date, time, endTime, immatriculation, nomChauffeur, numeroTitre, plomb, provenance,
        poids, JSON.stringify(normalizedDetails), siteId],
    );
    if (!result.rows[0]) {
      await client.query("ROLLBACK");
      return json(response, 404, { error: "Réception de bouteilles introuvable sur ce site." });
    }
    if (pondBrut) {
      await client.query(
        `INSERT INTO pond_brut
           (flux_id, site_id, utilisateur_id, date_operation, brut, tare, net, observation, client_fournisseur, produit, remarque)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::date, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (flux_id) DO UPDATE SET
           site_id=EXCLUDED.site_id, utilisateur_id=EXCLUDED.utilisateur_id, date_operation=EXCLUDED.date_operation,
           brut=EXCLUDED.brut, tare=EXCLUDED.tare, net=EXCLUDED.net, observation=EXCLUDED.observation,
           client_fournisseur=EXCLUDED.client_fournisseur, produit=EXCLUDED.produit, remarque=EXCLUDED.remarque`,
        [entryId, siteId, userId, date, pondBrut.brut, pondBrut.tare, pondBrut.net,
          pondBrut.observation, pondBrut.clientFournisseur, pondBrut.produit, pondBrut.remarque],
      );
    }
    await client.query("COMMIT");
    json(response, 200, { entry: {
      id: entryId, date, type: "BOUTEILLES_VIDES", heureArrivee: time, heureFin: endTime,
      immatriculationVehicule: immatriculation, nomChauffeur, numeroTitre, plomb, provenance,
      poids, ...(pondBrut || {}), detailsBouteilles: normalizedDetails,
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
      `UPDATE flux_logistique SET annule_le=CURRENT_TIMESTAMP, modifie_par=$3::uuid
       WHERE id = $1::uuid AND site_id = $2::uuid AND type_flux = 'BOUTEILLES_VIDES' AND annule_le IS NULL
       RETURNING id`,
      [entryId, siteId, userId],
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
    const plomb = cleanText(body.plomb, 100);
    const poids = Number(body.poids);
    const destinataire = cleanText(body.destinataire, 255);
    const vehicule = cleanText(body.vehicule, 160);
    const transporteur = cleanText(body.transporteur, 255);
    if (!validDate(date) || !["LEVURE", "DRECHE"].includes(typeDechet) || !timePattern.test(time) || !numeroPesage ||
        !Number.isFinite(poids) || poids <= 0 || poids > 9999999999.99 || !destinataire || !vehicule || !transporteur) {
      return json(response, 400, { error: "Renseignez une date et une heure valides, le pesage, un poids positif, le destinataire, le véhicule et le transporteur." });
    }

    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const account = await getAccount(client, userId);
    const siteId = await resolveSite(client, account, body);
    const existing = await client.query(
      `SELECT id FROM flux_logistique
       WHERE id = $1::uuid AND type_flux = 'DECHETS' AND site_id = $2::uuid AND annule_le IS NULL
       FOR UPDATE`,
      [entryId, siteId],
    );
    if (!existing.rows[0]) {
      await client.query("ROLLBACK");
      return json(response, 404, { error: "Sortie de déchets introuvable sur ce site." });
    }
    const result = await client.query(
      `UPDATE flux_logistique
       SET date_operation = $2::date, type_dechet = $3, heure_sortie = $4::time, numero_pesage = $5,
           facture = $6, plomb = $7, poids = $8, destinataire = $9, vehicule = $10, transporteur = $11
       WHERE id = $1::uuid AND annule_le IS NULL
       RETURNING id, date_operation AS date, to_char(heure_sortie, 'HH24:MI') AS "heureSortie",
                 type_dechet AS "typeDechet", numero_pesage AS "numeroPesage", facture, plomb, poids, destinataire, vehicule, transporteur`,
      [entryId, date, typeDechet, time, numeroPesage, facture, plomb, poids, destinataire, vehicule, transporteur],
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
      `UPDATE flux_logistique SET annule_le=CURRENT_TIMESTAMP, modifie_par=$3::uuid
       WHERE id = $1::uuid AND type_flux = 'DECHETS' AND site_id = $2::uuid AND annule_le IS NULL
       RETURNING id`,
      [entryId, siteId, userId],
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
    const immatriculation = cleanText(body.immatriculationVehicule, 100);
    const vehicule = cleanText(body.vehicule, 160);
    const designation = cleanText(body.designation, 160);
    const quantity = Number(body.quantite);
    const document = cleanText(body.document, 160);
    const provenance = cleanText(body.provenance, 255);
    if (!validDate(date) || !timePattern.test(time) || !immatriculation || !vehicule || !designation ||
        !Number.isFinite(quantity) || quantity <= 0 || quantity > 9999999999.99 || !document || !provenance) {
      return json(response, 400, { error: "Renseignez une date et heure valides, l’immatriculation du camion, le véhicule, la désignation, une quantité positive, le bon de livraison/facture et la provenance." });
    }

    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const account = await getAccount(client, userId);
    const siteId = await resolveSite(client, account, body);
    const existing = await client.query(
      `SELECT id FROM flux_logistique
       WHERE id = $1::uuid AND type_flux = 'MATIERE_PREMIERE' AND site_id = $2::uuid AND annule_le IS NULL
       FOR UPDATE`,
      [entryId, siteId],
    );
    if (!existing.rows[0]) {
      await client.query("ROLLBACK");
      return json(response, 404, { error: "Déchargement introuvable sur ce site." });
    }
    const result = await client.query(
      `UPDATE flux_logistique
       SET date_operation = $2::date, camion = $3, immatriculation_vehicule = $4, heure_pointe = $5::time,
           designation = $6, quantite = $7, document = $8, provenance = $9
       WHERE id = $1::uuid AND annule_le IS NULL
       RETURNING id, date_operation::text AS date, to_char(heure_pointe, 'HH24:MI') AS "heurePointe",
                 camion AS vehicule, immatriculation_vehicule AS "immatriculationVehicule",
                 designation, quantite, document, provenance`,
      [entryId, date, vehicule, immatriculation, time, designation, quantity, document, provenance],
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
      `UPDATE flux_logistique SET annule_le=CURRENT_TIMESTAMP, modifie_par=$3::uuid
       WHERE id = $1::uuid AND type_flux = 'MATIERE_PREMIERE' AND site_id = $2::uuid AND annule_le IS NULL
       RETURNING id`,
      [entryId, siteId, userId],
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
    const immatriculation = cleanText(body.immatriculationVehicule, 100);
    const titre = cleanText(body.titre, 160);
    const plomb = cleanText(body.plomb, 100);
    const designation = normalizeFuelDesignation(body.designation);
    const quantity = Number(body.quantite);
    const cree = cleanText(body.cree, 160);
    const chauffeur = cleanText(body.chauffeur, 160);
    const magasinier = cleanText(body.magasinier, 160);
    if (!validDate(date) || !timePattern.test(time) || !immatriculation || !titre || !plomb || !designation || !cree ||
        !Number.isFinite(quantity) || quantity <= 0 || quantity > 9999999999.99 ||
        !chauffeur || !magasinier) {
      return json(response, 400, { error: "Renseignez une date et une heure valides, l’immatriculation du camion, le titre, le plomb, une désignation Fuel oil ou Gasoil, une quantité positive, le créateur, le chauffeur et le magasinier." });
    }

    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const account = await getAccount(client, userId);
    const siteId = await resolveSite(client, account, body);
    const existing = await client.query(
      `SELECT id FROM flux_logistique
       WHERE id = $1::uuid AND type_flux = 'DEPOTAGE_FUEL' AND site_id = $2::uuid AND annule_le IS NULL
       FOR UPDATE`,
      [entryId, siteId],
    );
    if (!existing.rows[0]) {
      await client.query("ROLLBACK");
      return json(response, 404, { error: "Dépotage fuel/gasoil introuvable sur ce site." });
    }
    const result = await client.query(
      `UPDATE flux_logistique
       SET date_operation = $2::date, heure_pointe = $3::time, immatriculation_vehicule = $4, titre = $5, plomb = $6,
           designation = $7, quantite = $8, cree = $9, chauffeur = $10, magasinier = $11
       WHERE id = $1::uuid AND annule_le IS NULL
       RETURNING id, date_operation::text AS date, to_char(heure_pointe, 'HH24:MI') AS "heurePointe",
                 immatriculation_vehicule AS "immatriculationVehicule",
                 titre, plomb, designation, quantite, cree, chauffeur, magasinier`,
      [entryId, date, time, immatriculation, titre, plomb, designation, quantity, cree, chauffeur, magasinier],
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
      `UPDATE flux_logistique SET annule_le=CURRENT_TIMESTAMP, modifie_par=$3::uuid
       WHERE id = $1::uuid AND type_flux = 'DEPOTAGE_FUEL' AND site_id = $2::uuid AND annule_le IS NULL
       RETURNING id`,
      [entryId, siteId, userId],
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
              e.cree_le AS "createdAt", e.service_poste_id AS "servicePosteId",
              COALESCE(sp.poste_id,p.poste_id) AS "posteId", COALESCE(spo.nom,po.nom) AS "posteNom",
              COALESCE(sp.shift_type,p.shift_type) AS "shiftType"
       FROM signalement_logistique e JOIN site s ON s.id = e.site_id
       LEFT JOIN prise_de_poste p ON p.id=e.prise_de_poste_id
       LEFT JOIN poste po ON po.id=p.poste_id
       LEFT JOIN service_poste sp ON sp.id=e.service_poste_id
       LEFT JOIN poste spo ON spo.id=sp.poste_id
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
    const rawPostIds = Array.isArray(body.posteIds) ? body.posteIds : [];
    const requestedPostIds = [...new Set(rawPostIds)];
    if (requestedPostIds.length > 10 || requestedPostIds.some((value) => typeof value !== "string" || !uuidPattern.test(value))) {
      return json(response, 400, { error: "Sélectionnez au maximum dix postes pour diffuser la consigne." });
    }
    if (type !== "VIOLATION_PROCEDURE" && !values.facts) {
      return json(response, 400, { error: "Décrivez les faits du signalement." });
    }
    if (type === "VIOLATION_PROCEDURE" && (!values.person || !values.observations)) {
      return json(response, 400, { error: "Indiquez le nom de la personne et les observations." });
    }

    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const account = await getAccount(client, userId);
    const siteId = await resolveSite(client, account, body);
    const priseDePosteId = await resolvePriseDePosteId(client, siteId, body.priseDePosteId, body.posteId || null);
    const siteResult = await client.query("SELECT nom, type_site FROM site WHERE id = $1::uuid", [siteId]);
    const site = siteResult.rows[0];
    if (!site) throw Object.assign(new Error("Site de travail introuvable."), { status: 404 });
    let targetPostIds = [];
    if (requestedPostIds.length) {
      const postsResult = await client.query(
        "SELECT id, nom FROM poste WHERE site_id=$1::uuid AND actif=true AND id=ANY($2::uuid[])",
        [siteId, requestedPostIds],
      );
      if (postsResult.rows.length !== requestedPostIds.length) {
        throw Object.assign(new Error("Un ou plusieurs postes sélectionnés ne sont pas actifs sur ce site."), { status: 400 });
      }
      targetPostIds = postsResult.rows;
    }
    const result = await client.query(
      `INSERT INTO signalement_logistique
         (date_operation, heure, type_signalement, camion, transporteur, document,
          casse, manquant, vides, phn, description_faits, personne, observations,
          mesures_prises, site_id, utilisateur_id, prise_de_poste_id)
       VALUES ($1::date, $2::time, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::uuid, $16::uuid, $17::uuid)
       RETURNING id, cree_le AS "createdAt", service_poste_id AS "servicePosteId"`,
      [date, time, type, values.camion, values.transporteur, values.document, values.broken,
        values.missing, values.empty, values.phn, values.facts, values.person,
        values.observations, values.measures, siteId, userId, priseDePosteId],
    );
    const incidentDescription = values.facts || values.observations || "Incident signalé";
    const typeLabel = type === "ANOMALIE" ? "anomalie" : type === "DIVERS" ? "divers" : "de procédure";
    const instruction = `Incident ${typeLabel} : ${incidentDescription}\nMesures : ${values.measures || "Informer le responsable et appliquer les consignes de sécurité du site."}`.slice(0, 20000);
    const postTargets = targetPostIds.length ? targetPostIds : [{ id: null, nom: null }];
    for (const post of postTargets) {
      await client.query(
        `INSERT INTO consigne_journal
           (site_id, date_consigne, heure, consigne, emetteur, destinataire, utilisateur_id,
            jusquau_nouvel_ordre, prise_de_poste_id, poste_id)
         VALUES ($1::uuid, CURRENT_DATE, CURRENT_TIME, $2, $3, $4, $5::uuid, true, $6::uuid, $7::uuid)`,
        [siteId, instruction, account.nom, post.nom ? `Poste : ${post.nom}` : "Tous les postes du site", userId, priseDePosteId, post.id],
      );
    }
    const notificationTitle = type === "ANOMALIE"
      ? "Nouvelle anomalie signalée"
      : type === "DIVERS" ? "Nouveau signalement divers" : "Nouvelle violation de procédure";
    const notificationMessage = `${incidentDescription}${targetPostIds.length ? ` · ${targetPostIds.map((post) => post.nom).join(", ")}` : " · Tous les postes du site"}`.slice(0, 2000);
    await client.query(
      `INSERT INTO notification_interne (utilisateur_id, site_id, titre, message, type, entite_id)
       SELECT u.id, $1::uuid, $2, $3, 'INCIDENT', $4::uuid
       FROM utilisateur u
       WHERE u.actif=true
         AND (u.role=1 OR (u.role=2 AND u.site_id=$1::uuid))`,
      [siteId, notificationTitle, notificationMessage, result.rows[0].id],
    );
    await client.query("COMMIT");
    json(response, 201, {
      entry: { ...result.rows[0], date, time, type, ...values, siteName: site.nom, siteType: site.type_site, priseDePosteId },
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
    const camion = cleanText(body.camion, 160) || null;
    const transporteur = cleanText(body.transporteur) || null;
    const document = cleanText(body.document, 160) || null;
    const broken = cleanText(body.broken, 2000) || null;
    const missing = cleanText(body.missing, 2000) || null;
    const empty = cleanText(body.empty, 2000) || null;
    const phn = cleanText(body.phn, 2000) || null;
    const account = await getAccount(pool, userId);
    const siteId = await resolveSite(pool, account, body);
    const result = await pool.query(
      `UPDATE signalement_logistique
       SET date_operation=$1::date, heure=$2::time, camion=$3, transporteur=$4,
           document=$5, casse=$6, manquant=$7, vides=$8, phn=$9,
           description_faits=$10, mesures_prises=$11,
           personne=NULL, observations=NULL
       WHERE id=$12::uuid AND site_id=$13::uuid AND type_signalement IN ('ANOMALIE', 'DIVERS')
       RETURNING id, date_operation AS date, to_char(heure, 'HH24:MI') AS time,
                 camion, transporteur, document, casse AS broken, manquant AS missing,
                 vides AS empty, phn, description_faits AS facts, mesures_prises AS measures`,
      [date, time, camion, transporteur, document, broken, missing, empty, phn, facts,
        cleanText(body.measures, 20000) || null, entryId, siteId],
    );
    if (!result.rows[0]) return json(response, 404, { error: "Signalement introuvable pour ce site." });
    json(response, 200, { entry: result.rows[0] });
  } catch (error) {
    console.error("PUT /logistics/incidents/:id failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible de modifier le signalement." });
  }
}

export async function deleteLogisticsIncident(request, response, pool, userId, entryId) {
  try {
    const account = await getAccount(pool, userId);
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const siteId = await resolveSite(pool, account, { siteId: url.searchParams.get("siteId") });
    const result = await pool.query(
      "DELETE FROM signalement_logistique WHERE id=$1::uuid AND site_id=$2::uuid AND type_signalement IN ('ANOMALIE', 'DIVERS') RETURNING id",
      [entryId, siteId],
    );
    if (!result.rows[0]) return json(response, 404, { error: "Signalement introuvable pour ce site." });
    json(response, 200, { id: result.rows[0].id, deleted: true });
  } catch (error) {
    console.error("DELETE /logistics/incidents/:id failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible de supprimer le signalement." });
  }
}
