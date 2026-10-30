import { randomUUID } from "node:crypto";
import { json, readJson } from "../utils/helpers.js";
import { resolveServicePosteId } from "../utils/priseDePoste.js";

const cleanText = (value, max = 255) => typeof value === "string" ? value.trim().slice(0, max) : "";
const validDate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const validTime = (value) => typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
const validPassengerCount = (value) => Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 10000;
const vehicleKinds = new Set(["Particulier", "Star"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function getAccount(pool, userId) {
  const result = await pool.query("SELECT id, role, site_id FROM utilisateur WHERE id=$1::uuid LIMIT 1", [userId]);
  if (!result.rows[0]) throw Object.assign(new Error("Utilisateur introuvable."), { status: 401 });
  return result.rows[0];
}

async function resolveSite(pool, account, body) {
  if (account.site_id && account.role !== 1) return account.site_id;
  const siteId = cleanText(body.siteId, 36);
  if (siteId) {
    const result = await pool.query("SELECT id FROM site WHERE id=$1::uuid AND actif=true LIMIT 1", [siteId]);
    if (result.rows[0]) return result.rows[0].id;
  }
  const siteName = cleanText(body.siteName);
  if (siteName) {
    const result = await pool.query("SELECT id FROM site WHERE LOWER(nom)=LOWER($1) AND actif=true LIMIT 1", [siteName]);
    if (result.rows[0]) return result.rows[0].id;
  }
  if (account.site_id) return account.site_id;
  throw Object.assign(new Error("Sélectionnez un site actif."), { status: 400 });
}

export async function getVisitors(request, response, pool, userId) {
  try {
    const account = await getAccount(pool, userId);
    const siteId = account.site_id && account.role !== 1 ? account.site_id
      : new URL(request.url || "/", `http://${request.headers.host || "localhost"}`).searchParams.get("siteId") || null;
    const result = await pool.query(
      `SELECT p.id, v.identite AS full_name, COALESCE(v.societe,'') AS company,
              COALESCE(p.piece_fin,'') AS id_document, COALESCE(p.type_piece,'') AS document_type,
              COALESCE(p.hote,'') AS host, COALESCE(p.motif,'') AS reason,
              COALESCE(p.badge_numero,b.uid_nfc) AS badge, COALESCE(p.immatriculation,'') AS vehicle,
              COALESCE(p.zone,'') AS zone, COALESCE(p.materiel,'') AS equipment,
              p.entree AS entered_at, p.sortie AS exited_at, p.notes_sortie AS exit_notes,
              p.service_poste_id AS "servicePosteId",
              v.site_id, s.nom AS site_name, s.type_site AS site_type,
              v.liste_noire AS site_banned
       FROM passage p JOIN visiteur v ON v.id=p.visiteur_id JOIN badge b ON b.id=p.badge_id
       LEFT JOIN site s ON s.id=v.site_id
       WHERE ($1::uuid IS NULL OR v.site_id=$1::uuid)
       ORDER BY p.entree DESC LIMIT 500`,
      [siteId],
    );
    json(response, 200, { visitors: result.rows });
  } catch (error) {
    console.error("GET /visitors failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible de charger le registre des visiteurs." });
  }
}

export async function createVisitor(request, response, pool, userId) {
  let client;
  try {
    const body = await readJson(request);
    const name = cleanText(body.full_name);
    const reason = cleanText(body.reason, 20000);
    const host = cleanText(body.host);
    const entryDate = cleanText(body.entryDate ?? body.entry_date, 10);
    const entryTime = cleanText(body.entryTime ?? body.entry_time, 5);
    if (!name || !reason || ((entryDate || entryTime) && (!validDate(entryDate) || !validTime(entryTime)))) {
      return json(response, 400, { error: "Renseignez le nom, le motif, une date et une heure d’entrée valides." });
    }
    client = await pool.connect();
    await client.query("BEGIN");
    const account = await getAccount(client, userId);
    const siteId = await resolveSite(client, account, body);
    const servicePosteId = await resolveServicePosteId(client, siteId, body.priseDePosteId);
    const banned = await client.query(
      `SELECT identite FROM visiteur
       WHERE site_id=$1::uuid AND liste_noire=true
         AND LOWER(BTRIM(identite))=LOWER(BTRIM($2)) LIMIT 1`,
      [siteId, name],
    );
    if (banned.rows[0]) {
      await client.query("ROLLBACK");
      return json(response, 403, { error: `Accès interdit sur ce site pour ${banned.rows[0].identite}.` });
    }
    const badgeNumber = cleanText(body.badge, 80) || `V-${randomUUID().slice(0, 8).toUpperCase()}`;
    const badge = await client.query(
      "INSERT INTO badge (uid_nfc, statut, validite) VALUES ($1,1,NOW() + INTERVAL '1 year') RETURNING id",
      [`VIS-${randomUUID()}`],
    );
    const visitor = await client.query(
      "INSERT INTO visiteur (identite, societe, site_id, badge_id) VALUES ($1,$2,$3::uuid,$4::uuid) RETURNING id",
      [name, cleanText(body.company) || null, siteId, badge.rows[0].id],
    );
    const passage = await client.query(
      `INSERT INTO passage (entree, motif, badge_id, visiteur_id, type_piece, piece_fin, hote, zone, materiel, immatriculation, badge_numero, saisi_par_id,service_poste_id)
       VALUES (COALESCE($12::date + $13::time,NOW()),$1,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11::uuid,$14::uuid)
       RETURNING id, entree AS entered_at, service_poste_id AS "servicePosteId"`,
      [reason, badge.rows[0].id, visitor.rows[0].id, cleanText(body.document_type, 80) || null,
        cleanText(body.id_document, 4) || null, host, cleanText(body.zone) || "Accueil",
        cleanText(body.equipment, 20000) || null, cleanText(body.vehicle, 50) || null, badgeNumber, userId,
        entryDate || null, entryTime || null, servicePosteId],
    );
    const site = await client.query("SELECT id AS site_id, nom AS site_name, type_site AS site_type FROM site WHERE id=$1::uuid", [siteId]);
    await client.query("COMMIT");
    json(response, 201, { visitor: {
      id: passage.rows[0].id, site_id: site.rows[0]?.site_id, full_name: name, company: cleanText(body.company),
      id_document: cleanText(body.id_document, 4), document_type: cleanText(body.document_type, 80),
      host, reason, badge: badgeNumber, vehicle: cleanText(body.vehicle, 50), zone: cleanText(body.zone) || "Accueil",
      equipment: cleanText(body.equipment, 20000), entered_at: passage.rows[0].entered_at,
      servicePosteId: passage.rows[0].servicePosteId,
      exited_at: null,
      site_name: site.rows[0]?.site_name, site_type: site.rows[0]?.site_type,
    } });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("POST /visitors failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible d’enregistrer l’entrée visiteur." });
  } finally { client?.release(); }
}

export async function setVisitorSiteBan(request, response, pool, userId, passageId) {
  let client;
  try {
    if (!uuidPattern.test(passageId)) return json(response, 404, { error: "Passage visiteur introuvable." });
    const body = await readJson(request);
    if (typeof body.banned !== "boolean") return json(response, 400, { error: "Indiquez si l’interdiction doit être activée." });
    client = await pool.connect();
    await client.query("BEGIN");
    const account = await getAccount(client, userId);
    if (![1, 2].includes(Number(account.role))) {
      await client.query("ROLLBACK");
      return json(response, 403, { error: "Seuls les administrateurs et superviseurs peuvent gérer les interdictions de site." });
    }
    const identity = await client.query(
      `SELECT v.identite, v.site_id
       FROM passage p JOIN visiteur v ON v.id=p.visiteur_id
       WHERE p.id=$1::uuid AND ($2::uuid IS NULL OR v.site_id=$2::uuid)
       LIMIT 1 FOR UPDATE OF v`,
      [passageId, account.site_id || body.siteId || null],
    );
    if (!identity.rows[0]) {
      await client.query("ROLLBACK");
      return json(response, 404, { error: "Visiteur introuvable sur ce site." });
    }
    await client.query(
      `UPDATE visiteur SET liste_noire=$1
       WHERE site_id=$2::uuid AND LOWER(BTRIM(identite))=LOWER(BTRIM($3))`,
      [body.banned, identity.rows[0].site_id, identity.rows[0].identite],
    );
    await client.query("COMMIT");
    json(response, 200, { visitorId: passageId, siteId: identity.rows[0].site_id, banned: body.banned });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    json(response, error.status || 500, { error: error.status ? error.message : "Mise à jour de l’interdiction impossible." });
  } finally { client?.release(); }
}

export async function updateVisitor(request, response, pool, userId, passageId) {
  let client;
  try {
    if (!uuidPattern.test(passageId)) return json(response, 404, { error: "Passage visiteur introuvable." });
    const body = await readJson(request);
    const name = cleanText(body.full_name);
    const company = cleanText(body.company);
    const badge = cleanText(body.badge, 80);
    const reason = cleanText(body.reason, 20000);
    const entryDate = cleanText(body.entryDate, 10);
    const entryTime = cleanText(body.entryTime, 5);
    if (!name || !reason || !validDate(entryDate) || !validTime(entryTime)) {
      return json(response, 400, { error: "Renseignez le nom, le motif, une date et une heure d’entrée valides." });
    }
    client = await pool.connect();
    await client.query("BEGIN");
    const account = await getAccount(client, userId);
    const siteId = await resolveSite(client, account, body);
    const result = await client.query(
      `UPDATE passage p
       SET motif=$2, badge_numero=$3, entree=$4::date + $5::time
       FROM visiteur v
       WHERE p.id=$1::uuid AND p.visiteur_id=v.id AND v.site_id=$6::uuid
       RETURNING p.id, v.id AS "visitorId", p.badge_id AS "badgeId",
                 p.entree AS entered_at, p.sortie AS exited_at`,
      [passageId, reason, badge || null, entryDate, entryTime, siteId],
    );
    if (!result.rows[0]) {
      await client.query("ROLLBACK");
      return json(response, 404, { error: "Passage visiteur introuvable sur ce site." });
    }
    await client.query(
      "UPDATE visiteur SET identite=$2, societe=$3 WHERE id=$1::uuid",
      [result.rows[0].visitorId, name, company || null],
    );
    const site = await client.query("SELECT id AS site_id, nom AS site_name, type_site AS site_type FROM site WHERE id=$1::uuid", [siteId]);
    await client.query("COMMIT");
    json(response, 200, { visitor: {
      id: result.rows[0].id, site_id: site.rows[0]?.site_id,
      full_name: name, company,
      reason, badge,
      entered_at: result.rows[0].entered_at, exited_at: result.rows[0].exited_at,
      site_name: site.rows[0]?.site_name, site_type: site.rows[0]?.site_type,
    } });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("PUT /visitors/:id failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible de modifier le passage visiteur." });
  } finally {
    client?.release();
  }
}

export async function deleteVisitor(request, response, pool, userId, passageId) {
  let client;
  try {
    if (!uuidPattern.test(passageId)) return json(response, 404, { error: "Passage visiteur introuvable." });
    client = await pool.connect();
    await client.query("BEGIN");
    const account = await getAccount(client, userId);
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const requestedSite = account.site_id && account.role !== 1 ? account.site_id : url.searchParams.get("siteId");
    const passage = await client.query(
      `SELECT p.sortie
       FROM passage p JOIN visiteur v ON v.id=p.visiteur_id
       WHERE p.id=$1::uuid AND ($2::uuid IS NULL OR v.site_id=$2::uuid)
       FOR UPDATE OF p`,
      [passageId, requestedSite || null],
    );
    if (!passage.rows[0]) {
      await client.query("ROLLBACK");
      return json(response, 404, { error: "Passage visiteur introuvable pour ce site." });
    }
    if (!passage.rows[0].sortie) {
      await client.query("ROLLBACK");
      return json(response, 409, { error: "Enregistrez la sortie du visiteur avant de supprimer ce passage." });
    }
    const result = await client.query(
      `DELETE FROM passage p USING visiteur v
       WHERE p.id=$1::uuid AND p.visiteur_id=v.id
         AND ($2::uuid IS NULL OR v.site_id=$2::uuid)
       RETURNING p.id`,
      [passageId, requestedSite || null],
    );
    if (!result.rows[0]) {
      await client.query("ROLLBACK");
      return json(response, 404, { error: "Passage visiteur introuvable pour ce site." });
    }
    await client.query("COMMIT");
    json(response, 200, { id: result.rows[0].id, deleted: true });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("DELETE /visitors/:id failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible de supprimer le passage visiteur." });
  } finally {
    client?.release();
  }
}

export async function exitVisitor(request, response, pool, userId, passageId) {
  try {
    const body = await readJson(request);
    const account = await getAccount(pool, userId);
    const extra = cleanText(body.extraEquipment, 500);
    const note = extra
      ? `Autre matériel déclaré à la sortie : ${extra}`
      : body.equipmentOut === true
        ? "Contrôle de sortie effectué."
        : "Sortie visiteur enregistrée.";
    const result = await pool.query(
      `UPDATE passage p SET sortie=NOW(), notes_sortie=$1, sortie_par_id=$2::uuid
       FROM visiteur v WHERE p.id=$3::uuid AND p.visiteur_id=v.id AND p.sortie IS NULL
         AND ($4::uuid IS NULL OR v.site_id=$4::uuid)
       RETURNING p.id, p.sortie AS exited_at, p.notes_sortie AS exit_notes`,
      [note, userId, passageId, account.site_id && account.role !== 1 ? account.site_id : null],
    );
    if (!result.rows[0]) return json(response, 404, { error: "Visiteur absent du site ou déjà sorti." });
    json(response, 200, { visitor: result.rows[0] });
  } catch (error) {
    console.error("PATCH /visitors/:id/exit failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible d’enregistrer la sortie visiteur." });
  }
}

export async function getVehicles(request, response, pool, userId) {
  try {
    const account = await getAccount(pool, userId);
    const siteId = account.site_id && account.role !== 1 ? account.site_id
      : new URL(request.url || "/", `http://${request.headers.host || "localhost"}`).searchParams.get("siteId") || null;
    const result = await pool.query(
      `SELECT pv.id, v.immatriculation AS plate, v.type, COALESCE(pv.transporteur,'') AS company,
              COALESCE(pv.transporteur,'') AS category, COALESCE(pv.conducteur,'') AS "ownerName",
              COALESCE(pv.operation,'') AS operation, COALESCE(pv.plomb,'') AS seal_number,
              COALESCE(pv.reference,'') AS document_reference, COALESCE(pv.etat_chargement,'') AS load_state,
              COALESCE(pv.conducteur,'') AS driver, COALESCE(pv.passagers,'') AS passengers,
              CASE
                WHEN pv.passagers ~ '^[0-9]{1,5}$' THEN
                  CASE WHEN pv.passagers::integer <= 10000 THEN pv.passagers::integer END
                ELSE NULL
              END AS "passengersEntry",
              pv.passagers_sortie AS "passengersOut",
              COALESCE(pv.motif,'') AS reason, COALESCE(pv.zone,'') AS zone, pv.controle_conforme AS compliant,
              s.nom AS site_name, pv.site_id AS "siteId", pv.service_poste_id AS "servicePosteId",
              pv.entree AS entered_at, pv.sortie AS exited_at,
              pv.annule_le AS "annuleLe",
              to_char(pv.entree, 'YYYY-MM-DD') AS "entryDate",
              to_char(pv.entree, 'HH24:MI') AS "entryTime",
              to_char(pv.sortie, 'YYYY-MM-DD') AS "exitDate",
              to_char(pv.sortie, 'HH24:MI') AS "exitTime"
       FROM passage_vehicule pv JOIN vehicule v ON v.id=pv.vehicule_id
       LEFT JOIN site s ON s.id=pv.site_id
       WHERE ($1::uuid IS NULL OR pv.site_id=$1::uuid)
       ORDER BY pv.entree DESC LIMIT 500`,
      [siteId],
    );
    json(response, 200, { vehicles: result.rows });
  } catch (error) {
    console.error("GET /vehicles failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible de charger le registre des véhicules." });
  }
}

export async function createVehicle(request, response, pool, userId) {
  let client;
  try {
    const body = await readJson(request);
    const plate = cleanText(body.plate, 50).toUpperCase();
    const newMovement = body.ownerName !== undefined || body.category !== undefined || body.passengersEntry !== undefined;
    const driver = cleanText(body.ownerName ?? body.driver);
    const reason = cleanText(body.reason, 20000) || (newMovement ? "Mouvement véhicule" : "");
    const category = cleanText(body.category ?? body.company, 40);
    const passengersEntry = body.passengersEntry ?? body.passengers;
    const entryDate = cleanText(body.date, 10);
    const entryTime = cleanText(body.entryTime, 5);
    if (!plate || !driver || !reason) return json(response, 400, { error: "L’immatriculation, le nom du propriétaire et le motif sont obligatoires." });
    if (newMovement && (!vehicleKinds.has(category) || !validDate(entryDate) || !validTime(entryTime)
      || !validPassengerCount(passengersEntry))) {
      return json(response, 400, { error: "Vérifiez la date, l’heure d’entrée, le type de véhicule et le nombre de personnes à l’entrée." });
    }
    client = await pool.connect();
    await client.query("BEGIN");
    const account = await getAccount(client, userId);
    const siteId = await resolveSite(client, account, body);
    const servicePosteId = await resolveServicePosteId(client, siteId, body.priseDePosteId);
    const type = cleanText(body.type, 100) || "Véhicule";
    const vehicle = await client.query(
      `INSERT INTO vehicule (immatriculation, type) VALUES ($1,$2)
       ON CONFLICT (immatriculation) DO UPDATE SET type=EXCLUDED.type RETURNING id`,
      [plate, type],
    );
    const result = await client.query(
      `INSERT INTO passage_vehicule (entree, vehicule_id, vacation_id, transporteur, conducteur, passagers,
         motif, zone, operation, reference, plomb, etat_chargement, controle_conforme, saisi_par_id, site_id, service_poste_id)
      VALUES (${newMovement ? "$15::date + $16::time" : "NOW()"},$1::uuid,(SELECT id FROM vacation WHERE utilisateur_id=$2::uuid AND cloture IS NULL ORDER BY ouverture DESC LIMIT 1),
         $3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$2::uuid,$13::uuid,$14::uuid)
       RETURNING id, entree AS entered_at, service_poste_id AS "servicePosteId"`,
      [vehicle.rows[0].id, userId, newMovement ? category : cleanText(body.company) || null, driver,
       newMovement ? String(passengersEntry) : cleanText(body.passengers, 255) || null,
       reason, cleanText(body.zone) || "Accueil", cleanText(body.operation, 40) || "Autre passage",
       cleanText(body.document_reference, 100) || null, cleanText(body.seal_number, 100) || null,
       cleanText(body.load_state, 40) || null, body.compliant === true, siteId,
       servicePosteId, ...(newMovement ? [entryDate, entryTime] : [])],
    );
    const site = await client.query("SELECT id AS site_id, nom AS site_name FROM site WHERE id=$1::uuid", [siteId]);
    await client.query("COMMIT");
    json(response, 201, { vehicle: {
      id: result.rows[0].id, plate, type, company: category, category, ownerName: driver,
      passengersEntry: newMovement ? Number(passengersEntry) : null, passengersOut: null,
      entryDate: newMovement ? entryDate : result.rows[0].entered_at,
      entryTime: newMovement ? entryTime : null, exitDate: null, exitTime: null,
      operation: cleanText(body.operation, 40),
      seal_number: cleanText(body.seal_number, 100), document_reference: cleanText(body.document_reference, 100),
      load_state: cleanText(body.load_state, 40), driver, passengers: cleanText(body.passengers, 255), reason,
      zone: cleanText(body.zone) || "Accueil", site_name: site.rows[0]?.site_name, compliant: body.compliant === true,
      siteId: site.rows[0]?.site_id || siteId,
      servicePosteId: result.rows[0].servicePosteId,
      entered_at: result.rows[0].entered_at, exited_at: null,
    } });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("POST /vehicles failed:", error.code || error.name, error.message || "");
    const status = error.code === "23505" ? 409 : error.status || 500;
    json(response, status, { error: error.code === "23505" ? "Ce véhicule est déjà enregistré comme présent." : error.status ? error.message : "Impossible d’enregistrer l’entrée du véhicule." });
  } finally { client?.release(); }
}

export async function exitVehicle(request, response, pool, userId, passageId) {
  try {
    const body = await readJson(request);
    const hasPassengerCount = body.passengersOut !== undefined && body.passengersOut !== null && body.passengersOut !== "";
    if (hasPassengerCount && !validPassengerCount(body.passengersOut)) {
      return json(response, 400, { error: "Le nombre de personnes à la sortie doit être un entier entre 0 et 10 000." });
    }
    const account = await getAccount(pool, userId);
    const requestedSiteId = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`).searchParams.get("siteId");
    const result = await pool.query(
      `UPDATE passage_vehicule SET sortie=NOW(), sortie_par_id=$1::uuid,modifie_par=$1::uuid,
         passagers_sortie=CASE WHEN $4::boolean THEN $5::integer ELSE passagers_sortie END
       WHERE id=$2::uuid AND sortie IS NULL AND annule_le IS NULL AND ($3::uuid IS NULL OR site_id=$3::uuid)
       RETURNING id, sortie AS exited_at, passagers_sortie AS "passengersOut",
                 to_char(sortie, 'HH24:MI') AS "exitTime"`,
      [userId, passageId, account.site_id && account.role !== 1 ? account.site_id : requestedSiteId || null,
        hasPassengerCount, hasPassengerCount ? Number(body.passengersOut) : null],
    );
    if (!result.rows[0]) return json(response, 404, { error: "Véhicule présent introuvable ou déjà sorti." });
    json(response, 200, { vehicle: result.rows[0] });
  } catch (error) {
    console.error("PATCH /vehicles/:id/exit failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible d’enregistrer la sortie véhicule." });
  }
}

export async function updateVehicle(request, response, pool, userId, passageId) {
  let client;
  try {
    if (!uuidPattern.test(passageId)) return json(response, 404, { error: "Mouvement véhicule introuvable." });
    const body = await readJson(request);
    const plate = cleanText(body.plate, 50).toUpperCase();
    const ownerName = cleanText(body.ownerName, 255);
    const category = cleanText(body.category, 40);
    const entryDate = cleanText(body.date, 10);
    const entryTime = cleanText(body.entryTime, 5);
    const passengersEntry = Number(body.passengersEntry);
    const exitDate = body.exitTime ? cleanText(body.exitDate, 10) || entryDate : "";
    const exitTime = body.exitTime ? cleanText(body.exitTime, 5) : "";
    const passengersOut = body.passengersOut === "" || body.passengersOut == null ? null : Number(body.passengersOut);
    if (!plate || !ownerName || !vehicleKinds.has(category) || !validDate(entryDate)
      || !validTime(entryTime) || !validPassengerCount(passengersEntry)
      || (exitTime && (!validDate(exitDate) || !validTime(exitTime) || passengersOut == null || !validPassengerCount(passengersOut)))
      || (!exitTime && passengersOut != null)) {
      return json(response, 400, { error: "Vérifiez la date, l’immatriculation, le propriétaire, le type de véhicule et les nombres de personnes." });
    }
    client = await pool.connect();
    await client.query("BEGIN");
    const account = await getAccount(client, userId);
    const siteFilter = account.site_id && account.role !== 1 ? account.site_id : body.siteId || null;
    const existing = await client.query(
      `SELECT pv.vehicule_id AS "vehicleId"
       FROM passage_vehicule pv
       WHERE pv.id=$1::uuid AND pv.annule_le IS NULL AND ($2::uuid IS NULL OR pv.site_id=$2::uuid)
       FOR UPDATE`,
      [passageId, siteFilter],
    );
    if (!existing.rows[0]) {
      await client.query("ROLLBACK");
      return json(response, 404, { error: "Mouvement véhicule introuvable pour ce site." });
    }
    const vehicle = await client.query(
      `UPDATE vehicule SET immatriculation=$2 WHERE id=$1::uuid RETURNING id`,
      [existing.rows[0].vehicleId, plate],
    );
    if (!vehicle.rows[0]) throw Object.assign(new Error("Véhicule introuvable."), { status: 404 });
    const result = await client.query(
      `UPDATE passage_vehicule
       SET entree=$2::date + $3::time, conducteur=$4, transporteur=$5,modifie_par=$11::uuid,
           passagers=$6, passagers_sortie=$7,
           sortie=CASE WHEN $8::time IS NULL THEN NULL ELSE $9::date + $8::time END,
           sortie_par_id=CASE WHEN $8::time IS NULL THEN NULL ELSE $10::uuid END
       WHERE id=$1::uuid AND annule_le IS NULL
       RETURNING id, entree AS entered_at, sortie AS exited_at,
                 to_char(entree, 'YYYY-MM-DD') AS "entryDate",
                 to_char(entree, 'HH24:MI') AS "entryTime",
                 to_char(sortie, 'YYYY-MM-DD') AS "exitDate",
                 to_char(sortie, 'HH24:MI') AS "exitTime"`,
      [passageId, entryDate, entryTime, ownerName, category, String(passengersEntry), passengersOut,
        exitTime || null, exitDate || null, userId, userId],
    );
    await client.query("COMMIT");
    json(response, 200, { vehicle: {
      id: result.rows[0].id, plate, ownerName, category,
      passengersEntry, passengersOut, ...result.rows[0],
    } });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("PUT /vehicles/:id failed:", error.code || error.name, error.message || "");
    const status = error.code === "23505" ? 409 : error.status || 500;
    json(response, status, { error: error.code === "23505" ? "Cette immatriculation est déjà utilisée par un autre véhicule." : error.status ? error.message : "Impossible de modifier le mouvement véhicule." });
  } finally {
    client?.release();
  }
}

export async function deleteVehicle(request, response, pool, userId, passageId) {
  let client;
  try {
    if (!uuidPattern.test(passageId)) return json(response, 404, { error: "Mouvement véhicule introuvable." });
    client = await pool.connect();
    await client.query("BEGIN");
    const account = await getAccount(client, userId);
    const siteFilter = account.site_id && account.role !== 1 ? account.site_id
      : new URL(request.url || "/", `http://${request.headers.host || "localhost"}`).searchParams.get("siteId");
    const existing = await client.query(
      `SELECT sortie,annule_le
       FROM passage_vehicule
       WHERE id=$1::uuid AND ($2::uuid IS NULL OR site_id=$2::uuid)
       FOR UPDATE`,
      [passageId, siteFilter || null],
    );
    if (!existing.rows[0]) {
      await client.query("ROLLBACK");
      return json(response, 404, { error: "Mouvement véhicule introuvable pour ce site." });
    }
    if (existing.rows[0].annule_le) {
      await client.query("ROLLBACK");
      return json(response, 409, { error: "Ce mouvement véhicule est déjà annulé." });
    }
    if (!existing.rows[0].sortie) {
      await client.query("ROLLBACK");
      return json(response, 409, { error: "Enregistrez la sortie du véhicule avant de supprimer ce mouvement." });
    }
    const result = await client.query(
      `UPDATE passage_vehicule SET annule_le=CURRENT_TIMESTAMP,annule_par=$3::uuid,modifie_par=$3::uuid
       WHERE id=$1::uuid AND annule_le IS NULL AND ($2::uuid IS NULL OR site_id=$2::uuid)
       RETURNING id,annule_le AS "annuleLe"`,
      [passageId, siteFilter || null, userId],
    );
    if (!result.rows[0]) {
      await client.query("ROLLBACK");
      return json(response, 404, { error: "Mouvement véhicule introuvable pour ce site." });
    }
    await client.query("COMMIT");
    json(response, 200, { id: result.rows[0].id, deleted: false, cancelled: true, annuleLe: result.rows[0].annuleLe });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("DELETE /vehicles/:id failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible de supprimer le mouvement véhicule." });
  } finally {
    client?.release();
  }
}
