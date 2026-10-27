import { json, readJson } from "../utils/helpers.js";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validDate = (value) => {
  if (!datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

function cleanText(value, maxLength = 255) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

async function getUserSiteId(pool, userId, requestedSiteId) {
  const result = await pool.query(
    "SELECT site_id, role FROM utilisateur WHERE id = $1::uuid LIMIT 1",
    [userId],
  );
  if (!result.rows[0]) throw Object.assign(new Error("Utilisateur introuvable."), { status: 401 });
  if (!result.rows[0].site_id && !(result.rows[0].role === 1 && requestedSiteId)) {
    throw Object.assign(new Error("Sélectionnez un site avant d'utiliser ce registre."), { status: 400 });
  }
  const siteId = result.rows[0].role === 1 ? requestedSiteId || result.rows[0].site_id : result.rows[0].site_id;
  const activeSite = await pool.query("SELECT id FROM site WHERE id = $1::uuid AND actif = true LIMIT 1", [siteId]);
  if (!activeSite.rows[0]) throw Object.assign(new Error("Site introuvable ou archivé."), { status: 404 });
  return activeSite.rows[0].id;
}

export async function getKeyTracking(request, response, pool, userId) {
  try {
    const siteId = await getUserSiteId(pool, userId, new URL(request.url || "/", `http://${request.headers.host || "localhost"}`).searchParams.get("siteId"));
    const result = await pool.query(
      `SELECT k.id, k.date_suivi AS date,
              k.nom_personne AS "lastName", k.prenom_personne AS "firstName",
              k.matricule_personne AS matricule, k.type_cle AS "keyType",
              k.nombre_cles AS quantity,
              to_char(k.heure_sortie, 'HH24:MI') AS "departureTime",
              to_char(k.heure_retour, 'HH24:MI') AS "returnTime",
              s.nom AS "siteName", k.cree_le AS "createdAt"
       FROM suivi_cle k JOIN site s ON s.id = k.site_id
       WHERE k.site_id = $1::uuid AND k.type_cle IS NOT NULL
       ORDER BY k.date_suivi DESC, k.heure_sortie DESC, k.cree_le DESC LIMIT 300`,
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
    const employeeId = cleanText(body.employeeId, 36);
    const keyType = cleanText(body.keyType, 100);
    const departureTime = cleanText(body.departureTime, 5);
    const quantity = Number(body.quantity);
    if (!validDate(date) || !uuidPattern.test(employeeId) || !keyType ||
        !timePattern.test(departureTime) || !Number.isInteger(quantity) || quantity < 1 || quantity > 10000) {
      return json(response, 400, { error: "Vérifiez la date, l’employé, le type de clé, la quantité et l’heure de sortie." });
    }
    const siteId = await getUserSiteId(pool, userId, body.siteId);
    const employee = await pool.query(
      `SELECT e.nom, e.prenom, e.matricule, e.role
       FROM employe e
       JOIN cle_habilitation ch ON LOWER(TRIM(ch.role_autorise)) = LOWER(TRIM(e.role))
       WHERE e.id=$1::uuid AND e.actif=true
         AND (e.site_id=$2::uuid OR e.site_id IS NULL)
         AND LOWER(TRIM(ch.trousse_cle))=LOWER(TRIM($3))
       LIMIT 1`,
      [employeeId, siteId, keyType],
    );
    if (!employee.rows[0]) {
      return json(response, 400, { error: "Cet employé n’est pas habilité à prendre ce type de clé sur ce site." });
    }
    const result = await pool.query(
      `INSERT INTO suivi_cle
         (date_suivi, matricule_personne, nom_personne, prenom_personne,
          type_cle, nombre_cles, heure_sortie, site_id, utilisateur_id)
       VALUES ($1::date, $2, $3, $4, $5, $6, $7::time, $8::uuid, $9::uuid)
       RETURNING id, cree_le AS "createdAt"`,
      [date, employee.rows[0].matricule, employee.rows[0].nom, employee.rows[0].prenom,
        keyType, quantity, departureTime, siteId, userId],
    );
    json(response, 201, { entry: {
      id: result.rows[0].id, date, lastName: employee.rows[0].nom, firstName: employee.rows[0].prenom,
      matricule: employee.rows[0].matricule, keyType, quantity, departureTime, returnTime: null,
      createdAt: result.rows[0].createdAt,
    } });
  } catch (error) {
    console.error("POST access-control keys failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible d'enregistrer le suivi des clés." });
  }
}

export async function getKeyTypes(response, pool) {
  try {
    const result = await pool.query(
      `SELECT DISTINCT TRIM(trousse_cle) AS "keyType"
       FROM cle_habilitation
       WHERE TRIM(trousse_cle) <> ''
       ORDER BY "keyType"`,
    );
    json(response, 200, { keyTypes: result.rows.map((row) => row.keyType) });
  } catch (error) {
    console.error("GET key types failed:", error.code || error.name, error.message || "");
    json(response, 500, { error: "Impossible de charger les types de clés." });
  }
}

export async function getKeyEmployees(request, response, pool, userId) {
  try {
    const query = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`).searchParams;
    const keyType = cleanText(query.get("keyType"), 100);
    if (!keyType) return json(response, 400, { error: "Sélectionnez un type de clé." });
    const siteId = await getUserSiteId(pool, userId, query.get("siteId"));
    const result = await pool.query(
      `SELECT DISTINCT e.id, e.nom AS "lastName", e.prenom AS "firstName", e.matricule, e.role
       FROM employe e
       JOIN cle_habilitation ch ON LOWER(TRIM(ch.role_autorise)) = LOWER(TRIM(e.role))
       WHERE LOWER(TRIM(ch.trousse_cle)) = LOWER(TRIM($1))
         AND e.actif = true AND (e.site_id = $2::uuid OR e.site_id IS NULL)
       ORDER BY e.nom, e.prenom`,
      [keyType, siteId],
    );
    json(response, 200, { employees: result.rows });
  } catch (error) {
    console.error("GET key employees failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible de charger les employés habilités." });
  }
}

export async function returnKeyTracking(request, response, pool, userId, entryId) {
  try {
    if (!/^\d+$/.test(entryId) && !uuidPattern.test(entryId)) {
      return json(response, 400, { error: "Mouvement de clé invalide." });
    }
    const body = await readJson(request);
    const returnTime = cleanText(body.returnTime, 5);
    if (!timePattern.test(returnTime)) return json(response, 400, { error: "Indiquez une heure de retour valide (HH:MM)." });
    const siteId = await getUserSiteId(pool, userId, body.siteId);
    const result = await pool.query(
      `UPDATE suivi_cle
       SET heure_retour = $1::time
       WHERE id::text = $2 AND site_id = $3::uuid
         AND type_cle IS NOT NULL AND heure_retour IS NULL
       RETURNING id, to_char(heure_retour, 'HH24:MI') AS "returnTime"`,
      [returnTime, entryId, siteId],
    );
    if (!result.rows[0]) {
      const existing = await pool.query(
        "SELECT heure_retour FROM suivi_cle WHERE id::text=$1 AND site_id=$2::uuid AND type_cle IS NOT NULL",
        [entryId, siteId],
      );
      return json(response, existing.rows[0] ? 409 : 404, {
        error: existing.rows[0] ? "Le retour de cette clé est déjà enregistré." : "Mouvement de clé introuvable.",
      });
    }
    json(response, 200, { entry: result.rows[0] });
  } catch (error) {
    console.error("PATCH key return failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible d'enregistrer l’heure de retour." });
  }
}

export async function getBreathTests(request, response, pool, userId) {
  try {
    const siteId = await getUserSiteId(pool, userId, new URL(request.url || "/", `http://${request.headers.host || "localhost"}`).searchParams.get("siteId"));
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

    const siteId = await getUserSiteId(pool, userId, body.siteId);
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
