import { json, readJson } from "../utils/helpers.js";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const timeFields = [
  "perceptionMatin",
  "reintegrationMatin",
  "perceptionApresMidi",
  "reintegrationApresMidi",
];
const responsibleFields = [
  "responsablePerceptionMatin",
  "responsableReintegrationMatin",
  "responsablePerceptionApresMidi",
  "responsableReintegrationApresMidi",
];
const validDate = (value) => {
  if (!datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

function cleanText(value, maxLength = 255) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

async function getUserSiteId(pool, userId) {
  const result = await pool.query(
    "SELECT site_id FROM utilisateur WHERE id = $1::uuid LIMIT 1",
    [userId],
  );
  if (!result.rows[0]) throw Object.assign(new Error("Utilisateur introuvable."), { status: 401 });
  if (!result.rows[0].site_id) {
    throw Object.assign(new Error("Associez un site à ce compte avant d'utiliser ce registre."), { status: 400 });
  }
  return result.rows[0].site_id;
}

export async function getKeyTracking(request, response, pool, userId) {
  try {
    const siteId = await getUserSiteId(pool, userId);
    const result = await pool.query(
      `SELECT k.id, k.date_suivi AS date, k.lieu,
              to_char(k.perception_matin, 'HH24:MI') AS "perceptionMatin",
              k.responsable_perception_matin AS "responsablePerceptionMatin",
              to_char(k.reintegration_matin, 'HH24:MI') AS "reintegrationMatin",
              k.responsable_reintegration_matin AS "responsableReintegrationMatin",
              to_char(k.perception_apres_midi, 'HH24:MI') AS "perceptionApresMidi",
              k.responsable_perception_apres_midi AS "responsablePerceptionApresMidi",
              to_char(k.reintegration_apres_midi, 'HH24:MI') AS "reintegrationApresMidi",
              k.responsable_reintegration_apres_midi AS "responsableReintegrationApresMidi",
              k.observations, s.nom AS "siteName", k.cree_le AS "createdAt"
       FROM suivi_cle k JOIN site s ON s.id = k.site_id
       WHERE k.site_id = $1::uuid
       ORDER BY k.date_suivi DESC, k.cree_le DESC LIMIT 300`,
      [siteId],
    );
    json(response, 200, { entries: result.rows });
  } catch (error) {
    console.error("GET access-control keys failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible de charger le suivi des clés." });
  }
}

export async function createKeyTracking(request, response, pool, userId) {
  try {
    const body = await readJson(request);
    const date = cleanText(body.date, 10);
    const lieu = cleanText(body.lieu);
    const values = timeFields.map((field) => {
      const value = body[field];
      if (value === "" || value == null) return null;
      if (typeof value !== "string" || !timePattern.test(value)) {
        throw Object.assign(new Error("Les heures doivent être au format HH:MM."), { status: 400 });
      }
      return value;
    });
    if (!validDate(date) || !lieu) {
      return json(response, 400, { error: "Indiquez une date valide et le lieu de suivi des clés." });
    }
    if (values.every((value) => value === null)) {
      return json(response, 400, { error: "Saisissez au moins une heure de perception ou de réintégration." });
    }
    const responsables = responsibleFields.map((field) => cleanText(body[field]) || null);
    const siteId = await getUserSiteId(pool, userId);
    const result = await pool.query(
      `INSERT INTO suivi_cle
         (date_suivi, lieu, perception_matin, reintegration_matin,
          perception_apres_midi, reintegration_apres_midi,
          responsable_perception_matin, responsable_reintegration_matin,
          responsable_perception_apres_midi, responsable_reintegration_apres_midi,
          observations, site_id, utilisateur_id)
       VALUES ($1::date, $2, $3::time, $4::time, $5::time, $6::time,
               $7, $8, $9, $10, $11, $12::uuid, $13::uuid)
       RETURNING id, cree_le AS "createdAt"`,
      [date, lieu, values[0], values[1], values[2], values[3], ...responsables,
        cleanText(body.observations, 20000) || null, siteId, userId],
    );
    json(response, 201, { entry: { ...body, id: result.rows[0].id, createdAt: result.rows[0].createdAt } });
  } catch (error) {
    console.error("POST access-control keys failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible d'enregistrer le suivi des clés." });
  }
}

export async function getBreathTests(request, response, pool, userId) {
  try {
    const siteId = await getUserSiteId(pool, userId);
    const result = await pool.query(
      `SELECT c.id, c.date_controle AS date, to_char(c.heure, 'HH24:MI') AS heure,
              c.personne, c.appartenance, c.demandeur,
              c.type_demande AS "typeDemande", c.resultat,
              c.taux_mesure AS "tauxMesure", s.nom AS "siteName", c.cree_le AS "createdAt"
       FROM controle_alcoolemie c JOIN site s ON s.id = c.site_id
       WHERE c.site_id = $1::uuid
       ORDER BY c.date_controle DESC, c.heure DESC LIMIT 300`,
      [siteId],
    );
    json(response, 200, { entries: result.rows });
  } catch (error) {
    console.error("GET breath tests failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible de charger les contrôles d'alcoolémie." });
  }
}

export async function createBreathTest(request, response, pool, userId) {
  try {
    const body = await readJson(request);
    const date = cleanText(body.date, 10);
    const heure = cleanText(body.heure, 5);
    const personne = cleanText(body.personne);
    const appartenance = body.appartenance;
    const typeDemande = body.typeDemande;
    const resultat = body.resultat;
    const demandeur = cleanText(body.demandeur);
    const rate = body.tauxMesure === "" || body.tauxMesure == null ? null : Number(body.tauxMesure);

    if (!validDate(date) ||
        !timePattern.test(heure) || !personne || !["STAR", "NON STAR"].includes(appartenance) ||
        !["Test ordinaire (Entrée/Sortie)", "À la demande d'un service"].includes(typeDemande) ||
        !["Positif", "Négatif"].includes(resultat) ||
        (rate !== null && (!Number.isFinite(rate) || rate < 0 || rate > 999.99)) ||
        (typeDemande === "À la demande d'un service" && !demandeur)) {
      return json(response, 400, { error: "Vérifiez les champs du contrôle d'alcoolémie." });
    }

    const siteId = await getUserSiteId(pool, userId);
    const result = await pool.query(
      `INSERT INTO controle_alcoolemie
         (date_controle, heure, personne, appartenance, demandeur, type_demande,
          resultat, taux_mesure, site_id, utilisateur_id)
       VALUES ($1::date, $2::time, $3, $4, $5, $6, $7, $8, $9::uuid, $10::uuid)
       RETURNING id, cree_le AS "createdAt"`,
      [date, heure, personne, appartenance, demandeur || null, typeDemande,
        resultat, rate, siteId, userId],
    );
    json(response, 201, { entry: { ...body, id: result.rows[0].id, createdAt: result.rows[0].createdAt } });
  } catch (error) {
    console.error("POST breath test failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible d'enregistrer le contrôle d'alcoolémie." });
  }
}
