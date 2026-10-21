import { randomUUID } from "node:crypto";
import { json, readJson } from "../utils/helpers.js";

const cleanText = (value, max = 255) => typeof value === "string" ? value.trim().slice(0, max) : "";

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
              s.nom AS site_name
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
    if (!name || !reason || !host) return json(response, 400, { error: "Le nom, l’hôte et le motif sont obligatoires." });
    client = await pool.connect();
    await client.query("BEGIN");
    const account = await getAccount(client, userId);
    const siteId = await resolveSite(client, account, body);
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
      `INSERT INTO passage (entree, motif, badge_id, visiteur_id, type_piece, piece_fin, hote, zone, materiel, immatriculation, badge_numero, saisi_par_id)
       VALUES (NOW(),$1,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11::uuid)
       RETURNING id, entree AS entered_at`,
      [reason, badge.rows[0].id, visitor.rows[0].id, cleanText(body.document_type, 80) || null,
        cleanText(body.id_document, 4) || null, host, cleanText(body.zone) || "Accueil",
        cleanText(body.equipment, 20000) || null, cleanText(body.vehicle, 50) || null, badgeNumber, userId],
    );
    const site = await client.query("SELECT nom AS site_name FROM site WHERE id=$1::uuid", [siteId]);
    await client.query("COMMIT");
    json(response, 201, { visitor: {
      id: passage.rows[0].id, full_name: name, company: cleanText(body.company),
      id_document: cleanText(body.id_document, 4), document_type: cleanText(body.document_type, 80),
      host, reason, badge: badgeNumber, vehicle: cleanText(body.vehicle, 50), zone: cleanText(body.zone) || "Accueil",
      equipment: cleanText(body.equipment, 20000), entered_at: passage.rows[0].entered_at, exited_at: null,
      site_name: site.rows[0]?.site_name,
    } });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("POST /visitors failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible d’enregistrer l’entrée visiteur." });
  } finally { client?.release(); }
}

export async function exitVisitor(request, response, pool, userId, passageId) {
  try {
    const body = await readJson(request);
    const account = await getAccount(pool, userId);
    const extra = cleanText(body.extraEquipment, 500);
    const note = `Matériel déclaré sorti : ${body.equipmentOut === true ? "oui" : "non"}${extra ? ` · Autre matériel : ${extra}` : ""}`;
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
              COALESCE(pv.operation,'') AS operation, COALESCE(pv.plomb,'') AS seal_number,
              COALESCE(pv.reference,'') AS document_reference, COALESCE(pv.etat_chargement,'') AS load_state,
              COALESCE(pv.conducteur,'') AS driver, COALESCE(pv.passagers,'') AS passengers,
              COALESCE(pv.motif,'') AS reason, COALESCE(pv.zone,'') AS zone, pv.controle_conforme AS compliant,
              s.nom AS site_name, pv.entree AS entered_at, pv.sortie AS exited_at
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
    const driver = cleanText(body.driver);
    const reason = cleanText(body.reason, 20000);
    if (!plate || !driver || !reason) return json(response, 400, { error: "L’immatriculation, le conducteur et le motif sont obligatoires." });
    client = await pool.connect();
    await client.query("BEGIN");
    const account = await getAccount(client, userId);
    const siteId = await resolveSite(client, account, body);
    const type = cleanText(body.type, 100) || "Véhicule";
    const vehicle = await client.query(
      `INSERT INTO vehicule (immatriculation, type) VALUES ($1,$2)
       ON CONFLICT (immatriculation) DO UPDATE SET type=EXCLUDED.type RETURNING id`,
      [plate, type],
    );
    const result = await client.query(
      `INSERT INTO passage_vehicule (entree, vehicule_id, vacation_id, transporteur, conducteur, passagers,
         motif, zone, operation, reference, plomb, etat_chargement, controle_conforme, saisi_par_id, site_id)
       VALUES (NOW(),$1::uuid,(SELECT id FROM vacation WHERE utilisateur_id=$2::uuid AND cloture IS NULL ORDER BY ouverture DESC LIMIT 1),
         $3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$2::uuid,$13::uuid)
       RETURNING id, entree AS entered_at`,
      [vehicle.rows[0].id, userId, cleanText(body.company) || null, driver, cleanText(body.passengers, 255) || null,
        reason, cleanText(body.zone) || "Accueil", cleanText(body.operation, 40) || "Autre passage",
        cleanText(body.document_reference, 100) || null, cleanText(body.seal_number, 100) || null,
        cleanText(body.load_state, 40) || null, body.compliant === true, siteId],
    );
    const site = await client.query("SELECT nom AS site_name FROM site WHERE id=$1::uuid", [siteId]);
    await client.query("COMMIT");
    json(response, 201, { vehicle: {
      id: result.rows[0].id, plate, type, company: cleanText(body.company), operation: cleanText(body.operation, 40),
      seal_number: cleanText(body.seal_number, 100), document_reference: cleanText(body.document_reference, 100),
      load_state: cleanText(body.load_state, 40), driver, passengers: cleanText(body.passengers, 255), reason,
      zone: cleanText(body.zone) || "Accueil", site_name: site.rows[0]?.site_name, compliant: body.compliant === true,
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
    const account = await getAccount(pool, userId);
    const result = await pool.query(
      `UPDATE passage_vehicule SET sortie=NOW(), sortie_par_id=$1::uuid
       WHERE id=$2::uuid AND sortie IS NULL AND ($3::uuid IS NULL OR site_id=$3::uuid)
       RETURNING id, sortie AS exited_at`,
      [userId, passageId, account.site_id && account.role !== 1 ? account.site_id : null],
    );
    if (!result.rows[0]) return json(response, 404, { error: "Véhicule présent introuvable ou déjà sorti." });
    json(response, 200, { vehicle: result.rows[0] });
  } catch (error) {
    console.error("PATCH /vehicles/:id/exit failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible d’enregistrer la sortie véhicule." });
  }
}
