import { json, readJson } from "../utils/helpers.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const functions = new Set(["CR", "ADM", "Qualite", "Labo", "Maintenance", "Logistique", "Pile & Face", "Sécurité", "Pronete", "Néa"]);
const results = new Set(["Positif", "Négatif"]);
const civilities = new Set(["Monsieur", "Madame"]);
const devices = new Set(["Electronique", "Ballon"]);
const cleanText = (value, max = 255) => typeof value === "string" ? value.trim().slice(0, max) : "";

function validDate(value) {
  if (!datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

async function getSiteId(pool, userId, requestedSiteId) {
  const account = await pool.query(
    "SELECT site_id, role FROM utilisateur WHERE id = $1::uuid LIMIT 1",
    [userId],
  );
  if (!account.rows[0]) throw Object.assign(new Error("Utilisateur introuvable."), { status: 401 });
  const siteId = account.rows[0].role === 1
    ? cleanText(requestedSiteId, 36) || account.rows[0].site_id
    : account.rows[0].site_id;
  if (!siteId) throw Object.assign(new Error("Sélectionnez un site avant d’enregistrer le contrôle."), { status: 400 });
  const activeSite = await pool.query(
    "SELECT id FROM site WHERE id = $1::uuid AND actif = true LIMIT 1",
    [siteId],
  );
  if (!activeSite.rows[0]) throw Object.assign(new Error("Site introuvable ou archivé."), { status: 404 });
  return activeSite.rows[0].id;
}

function validate(body) {
  const date = cleanText(body.date, 10);
  const heure = cleanText(body.heure, 5);
  const matricule = cleanText(body.matricule, 100);
  const personne = cleanText(body.personne, 255);
  const demandeur = cleanText(body.demandeur, 255);
  const fonction = cleanText(body.fonction, 40);
  const resultat = cleanText(body.resultat, 20);
  const civilite = cleanText(body.civilite, 10);
  const typeAppareil = cleanText(body.typeAppareil, 20);
  const tauxMesure = body.tauxMesure === "" || body.tauxMesure == null ? null : Number(body.tauxMesure);
  const testeurNom = cleanText(body.testeurNom, 255);
  const testeurMatricule = cleanText(body.testeurMatricule, 100);
  const testeurFonction = cleanText(body.testeurFonction, 100);
  const temoinNom = cleanText(body.temoinNom, 255);
  const temoinMatricule = cleanText(body.temoinMatricule, 100);
  const temoinFonction = cleanText(body.temoinFonction, 100);
  const temoin2Nom = cleanText(body.temoin2Nom, 255);
  const temoin2Matricule = cleanText(body.temoin2Matricule, 100);
  const temoin2Fonction = cleanText(body.temoin2Fonction, 100);
  if (!validDate(date) || !timePattern.test(heure) || !matricule || !personne
    || !functions.has(fonction) || !results.has(resultat) || !civilities.has(civilite)
    || !devices.has(typeAppareil) || !Number.isFinite(tauxMesure) || tauxMesure < 0 || tauxMesure > 999.99
    || !testeurNom || !testeurFonction) {
    throw Object.assign(new Error("Vérifiez la date, l’heure, les informations de la personne testée, le résultat, le taux et les informations du testeur."), { status: 400 });
  }
  return {
    date, heure, matricule, personne, demandeur, fonction, resultat, civilite, typeAppareil, tauxMesure,
    testeurNom, testeurMatricule, testeurFonction,
    temoinNom, temoinMatricule, temoinFonction, temoin2Nom, temoin2Matricule, temoin2Fonction,
  };
}

const selectEntry = `
  SELECT c.id, c.date_controle::text AS date, to_char(c.heure, 'HH24:MI') AS heure,
         c.matricule, c.personne, c.fonction, c.resultat,
         c.demandeur,
         c.taux_mesure AS "tauxMesure", c.civilite, c.type_appareil AS "typeAppareil",
         c.testeur_nom AS "testeurNom", c.testeur_matricule AS "testeurMatricule",
         c.testeur_fonction AS "testeurFonction",
         c.temoin_nom AS "temoinNom", c.temoin_matricule AS "temoinMatricule",
         c.temoin_fonction AS "temoinFonction", c.temoin2_nom AS "temoin2Nom",
         c.temoin2_matricule AS "temoin2Matricule", c.temoin2_fonction AS "temoin2Fonction",
         c.site_id AS "siteId", s.nom AS "siteName", c.annule_le AS "annuleLe"
  FROM controle_alcoolemie c
  JOIN site s ON s.id = c.site_id`;

export async function listAlcoholChecks(request, response, pool, userId) {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const siteId = await getSiteId(pool, userId, url.searchParams.get("siteId"));
    const result = await pool.query(
      `${selectEntry}
       WHERE c.site_id = $1::uuid
       ORDER BY c.date_controle DESC, c.heure DESC, c.cree_le DESC
       LIMIT 500`,
      [siteId],
    );
    json(response, 200, { entries: result.rows });
  } catch (error) {
    console.error("GET alcohol checks failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible de charger les tests alcool." });
  }
}

export async function createAlcoholCheck(request, response, pool, userId) {
  try {
    const body = await readJson(request);
    const entry = validate(body);
    const siteId = await getSiteId(pool, userId, body.siteId);
    const result = await pool.query(
      `INSERT INTO controle_alcoolemie
         (date_controle, heure, matricule, personne, fonction, resultat,
          appartenance, demandeur, type_demande, taux_mesure, civilite, type_appareil,
          testeur_nom, testeur_matricule, testeur_fonction,
          temoin_nom, temoin_matricule, temoin_fonction,
          temoin2_nom, temoin2_matricule, temoin2_fonction, site_id, utilisateur_id)
       VALUES ($1::date, $2::time, $3, $4, $5, $6, 'STAR', $7, 'Test ordinaire (Entrée/Sortie)',
          $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20::uuid, $21::uuid)
       RETURNING id`,
      [entry.date, entry.heure, entry.matricule, entry.personne, entry.fonction, entry.resultat,
        entry.demandeur || null, entry.tauxMesure, entry.civilite, entry.typeAppareil, entry.testeurNom, entry.testeurMatricule,
        entry.testeurFonction, entry.temoinNom, entry.temoinMatricule, entry.temoinFonction,
        entry.temoin2Nom, entry.temoin2Matricule, entry.temoin2Fonction, siteId, userId],
    );
    const created = await pool.query(
      `${selectEntry} WHERE c.id = $1::uuid`,
      [result.rows[0].id],
    );
    json(response, 201, { entry: created.rows[0] });
  } catch (error) {
    console.error("POST alcohol check failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible d’enregistrer le test alcool." });
  }
}

export async function updateAlcoholCheck(request, response, pool, userId, entryId) {
  try {
    if (!uuidPattern.test(entryId)) return json(response, 404, { error: "Test alcool introuvable." });
    const body = await readJson(request);
    const entry = validate(body);
    const siteId = await getSiteId(pool, userId, body.siteId);
    const result = await pool.query(
      `UPDATE controle_alcoolemie
       SET date_controle = $2::date, heure = $3::time, matricule = $4,
           personne = $5, demandeur = $6, fonction = $7, resultat = $8, taux_mesure = $9,
           civilite = $10, type_appareil = $11, testeur_nom = $12, testeur_matricule = $13,
           testeur_fonction = $14, temoin_nom = $15, temoin_matricule = $16,
           temoin_fonction = $17, temoin2_nom = $18, temoin2_matricule = $19,
           temoin2_fonction = $20, modifie_par = $22::uuid
       WHERE id = $1::uuid AND site_id = $21::uuid AND annule_le IS NULL
       RETURNING id`,
      [entryId, entry.date, entry.heure, entry.matricule, entry.personne, entry.demandeur || null,
        entry.fonction, entry.resultat, entry.tauxMesure, entry.civilite, entry.typeAppareil, entry.testeurNom,
        entry.testeurMatricule, entry.testeurFonction, entry.temoinNom, entry.temoinMatricule,
        entry.temoinFonction, entry.temoin2Nom, entry.temoin2Matricule, entry.temoin2Fonction, siteId, userId],
    );
    if (!result.rows[0]) return json(response, 404, { error: "Test alcool introuvable sur ce site." });
    const updated = await pool.query(
      `${selectEntry} WHERE c.id = $1::uuid`,
      [entryId],
    );
    json(response, 200, { entry: updated.rows[0] });
  } catch (error) {
    console.error("PUT alcohol check failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible de modifier le test alcool." });
  }
}

export async function deleteAlcoholCheck(request, response, pool, userId, entryId) {
  try {
    if (!uuidPattern.test(entryId)) return json(response, 404, { error: "Test alcool introuvable." });
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const siteId = await getSiteId(pool, userId, url.searchParams.get("siteId"));
    const result = await pool.query(
      "UPDATE controle_alcoolemie SET annule_le=CURRENT_TIMESTAMP,annule_par=$3::uuid,modifie_par=$3::uuid WHERE id = $1::uuid AND site_id = $2::uuid AND annule_le IS NULL RETURNING id,annule_le AS \"annuleLe\"",
      [entryId, siteId, userId],
    );
    if (!result.rows[0]) return json(response, 404, { error: "Test alcool introuvable sur ce site." });
    json(response, 200, { id: result.rows[0].id, deleted: false, cancelled: true, annuleLe: result.rows[0].annuleLe });
  } catch (error) {
    console.error("DELETE alcohol check failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible de supprimer le test alcool." });
  }
}
