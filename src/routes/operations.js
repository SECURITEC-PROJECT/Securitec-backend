import { randomUUID } from "node:crypto";
import { apiPrefix, getPool, json, readJson, requestUser, text, getOrCreateSite } from "../server-support.js";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const isValidDate = (value) => {
  if (!datePattern.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

export async function handleOperations(request, response, pathname) {
  const siteArchive = /^\/api\/sites\/([0-9a-f-]+)$/.exec(pathname);
  if (request.method === "DELETE" && siteArchive) {
    const account = requestUser(request, response);
    if (!account) return;
    if (account.siteId) { json(response, 403, { error: "Ce compte ne peut pas retirer un site des listes." }); return; }
    try {
      const result = await (await getPool()).query(
        "UPDATE site SET actif=false WHERE id=$1 AND actif=true RETURNING id",
        [siteArchive[1]],
      );
      if (!result.rows[0]) { json(response, 404, { error: "Site introuvable ou déjà retiré." }); return; }
      json(response, 200, { id: result.rows[0].id, archived: true });
    } catch (error) { json(response, 500, { error: error.message || "Retrait du site impossible." }); }
    return;
  }

  if (pathname === `${apiPrefix}/sites`) {
    const account = requestUser(request, response);
    if (!account) return;
    try {
      const pool = await getPool();
      if (request.method === "GET") {
        const result = await pool.query(
          `SELECT id, nom AS name, type_site AS type FROM site
           WHERE actif=true AND ($1::uuid IS NULL OR id=$1::uuid) ORDER BY nom`,
          [account.siteId || null],
        );
        json(response, 200, { sites: result.rows, canCreate: !account.siteId, canDelete: !account.siteId });
        return;
      }
      if (request.method === "POST") {
        const body = await readJson(request);
        const siteName = text(body.name, 255);
        const siteType = body.type === "AGENCE" ? "AGENCE" : "USINE";
        if (!siteName) { json(response, 400, { error: "Le nom du site est obligatoire." }); return; }
        if (account.siteId && account.siteNom && siteName.toLocaleLowerCase() !== account.siteNom.toLocaleLowerCase()) {
          json(response, 403, { error: "Ce compte ne peut pas ajouter un site différent de son site associé." });
          return;
        }
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const id = account.siteId || await getOrCreateSite(client, siteName, siteType);
          const result = await client.query(
            "SELECT id, nom AS name, type_site AS type FROM site WHERE id=$1",
            [id],
          );
          await client.query("COMMIT");
          json(response, 201, { site: result.rows[0] });
        } catch (error) {
          await client.query("ROLLBACK").catch(() => {});
          json(response, error.status || 500, { error: error.message || "Ajout du site impossible." });
        } finally { client.release(); }
        return;
      }
      json(response, 405, { error: "Méthode non autorisée." });
    } catch (error) { json(response, 500, { error: error.message || "Chargement des sites impossible." }); }
    return;
  }

  if (pathname === `${apiPrefix}/visitors`) {
    const account = requestUser(request, response);
    if (!account) return;
    try {
      const pool = await getPool();
      if (request.method === "GET") {
        const result = await pool.query(
          `SELECT p.id, v.identite AS full_name, COALESCE(v.societe,'') AS company,
             COALESCE(p.piece_fin,'') AS id_document, COALESCE(p.type_piece,'') AS document_type,
             COALESCE(p.hote,'') AS host, COALESCE(p.motif,'') AS reason,
             COALESCE(p.badge_numero,b.uid_nfc) AS badge, COALESCE(p.immatriculation,'') AS vehicle,
             COALESCE(p.zone,'') AS zone, COALESCE(p.materiel,'') AS equipment, s.nom AS site_name,
             p.entree AS entered_at, p.sortie AS exited_at, p.notes_sortie AS exit_notes
           FROM passage p JOIN visiteur v ON v.id=p.visiteur_id JOIN badge b ON b.id=p.badge_id
           JOIN site s ON s.id=v.site_id
           WHERE p.saisi_par_id=$1 OR ($2::uuid IS NOT NULL AND v.site_id=$2::uuid)
           ORDER BY p.entree DESC LIMIT 500`,
          [account.sub, account.siteId || null],
        );
        json(response, 200, { visitors: result.rows });
        return;
      }
      if (request.method === "POST") {
        const body = await readJson(request);
        const name = text(body.full_name);
        const reason = text(body.reason, 20000);
        const host = text(body.host);
        if (!name || !reason || !host) { json(response, 400, { error: "Nom, hôte et motif sont obligatoires." }); return; }
        const entryDate = text(body.entry_date, 10);
        const entryTime = text(body.entry_time, 5);
        if ((entryDate || entryTime) && (!isValidDate(entryDate) || !timePattern.test(entryTime))) {
          json(response, 400, { error: "Indiquez une date et une heure valides." });
          return;
        }
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const siteId = account.siteId || await getOrCreateSite(client, body.siteName || account.siteNom, body.siteType);
          const badgeNumber = text(body.badge, 80) || `V-${randomUUID().slice(0, 8).toUpperCase()}`;
          const badge = await client.query(
            "INSERT INTO badge (uid_nfc, statut, validite) VALUES ($1,1,NOW() + INTERVAL '1 year') RETURNING id",
            [`VIS-${randomUUID()}`],
          );
          const visitor = await client.query(
            "INSERT INTO visiteur (identite, societe, site_id, badge_id) VALUES ($1,$2,$3,$4) RETURNING id",
            [name, text(body.company) || null, siteId, badge.rows[0].id],
          );
          const passage = await client.query(
            `INSERT INTO passage (entree, motif, badge_id, visiteur_id, type_piece, piece_fin, hote, zone, materiel, immatriculation, badge_numero, saisi_par_id)
             VALUES (CASE WHEN $12::date IS NULL THEN CURRENT_TIMESTAMP::timestamp ELSE $12::date + $13::time END,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             RETURNING id, entree AS entered_at`,
            [reason, badge.rows[0].id, visitor.rows[0].id, text(body.document_type, 80) || null, text(body.id_document, 4) || null, host, text(body.zone) || "Accueil", text(body.equipment, 20000) || null, text(body.vehicle, 50) || null, badgeNumber, account.sub, entryDate || null, entryTime || null],
          );
          await client.query("COMMIT");
          json(response, 201, { visitor: { id: passage.rows[0].id, full_name: name, company: text(body.company), id_document: text(body.id_document, 4), document_type: text(body.document_type, 80), host, reason, badge: badgeNumber, vehicle: text(body.vehicle, 50), zone: text(body.zone) || "Accueil", equipment: text(body.equipment, 20000), entered_at: passage.rows[0].entered_at, exited_at: null } });
        } catch (error) {
          await client.query("ROLLBACK").catch(() => {});
          throw error;
        } finally { client.release(); }
        return;
      }
      json(response, 405, { error: "Méthode non autorisée." });
    } catch (error) { json(response, error.status || 500, { error: error.message || "Opération visiteur impossible." }); }
    return;
  }

  const visitorExit = /^\/api\/visitors\/([0-9a-f-]+)\/exit$/.exec(pathname);
  if (request.method === "PATCH" && visitorExit) {
    const account = requestUser(request, response);
    if (!account) return;
    try {
      const body = await readJson(request);
      const note = `Matériel déclaré sorti : ${body.equipmentOut ? "oui" : "non"}${text(body.extraEquipment, 500) ? ` · Autre matériel : ${text(body.extraEquipment, 500)}` : ""}`;
      const result = await (await getPool()).query(
        `UPDATE passage p SET sortie=NOW(), notes_sortie=$1, sortie_par_id=$2
         FROM visiteur v WHERE p.id=$3 AND p.visiteur_id=v.id AND p.sortie IS NULL
           AND (p.saisi_par_id=$2 OR ($4::uuid IS NOT NULL AND v.site_id=$4::uuid))
         RETURNING p.id, p.sortie AS exited_at`,
        [note, account.sub, visitorExit[1], account.siteId || null],
      );
      if (!result.rows[0]) { json(response, 404, { error: "Visiteur absent du site ou déjà sorti." }); return; }
      json(response, 200, { visitor: result.rows[0] });
    } catch (error) { json(response, error.status || 500, { error: error.message || "Sortie visiteur impossible." }); }
    return;
  }

  if (pathname === `${apiPrefix}/vehicles`) {
    const account = requestUser(request, response);
    if (!account) return;
    try {
      const pool = await getPool();
      if (request.method === "GET") {
        const result = await pool.query(
          `SELECT pv.id, v.immatriculation AS plate, v.type, COALESCE(pv.transporteur,'') AS company,
             COALESCE(pv.operation,'') AS operation, COALESCE(pv.plomb,'') AS seal_number,
             COALESCE(pv.reference,'') AS document_reference, COALESCE(pv.etat_chargement,'') AS load_state,
             COALESCE(pv.conducteur,'') AS driver, COALESCE(pv.passagers,'') AS passengers,
             COALESCE(pv.motif,'') AS reason, COALESCE(pv.zone,'') AS zone, pv.controle_conforme AS compliant,
             s.nom AS site_name, pv.entree AS entered_at, pv.sortie AS exited_at
           FROM passage_vehicule pv JOIN vehicule v ON v.id=pv.vehicule_id
           LEFT JOIN site s ON s.id=pv.site_id
           WHERE pv.saisi_par_id=$1 OR ($2::uuid IS NOT NULL AND pv.site_id=$2::uuid)
           ORDER BY pv.entree DESC LIMIT 500`,
          [account.sub, account.siteId || null],
        );
        json(response, 200, { vehicles: result.rows });
        return;
      }
      if (request.method === "POST") {
        const body = await readJson(request);
        const plate = text(body.plate, 50).toUpperCase();
        const driver = text(body.driver);
        const reason = text(body.reason, 20000);
        const siteName = text(body.siteName || account.siteNom);
        if (!plate || !driver || !reason || !siteName) { json(response, 400, { error: "Site, immatriculation, conducteur et motif sont obligatoires." }); return; }
        if (account.siteId && account.siteNom && siteName.toLocaleLowerCase() !== account.siteNom.toLocaleLowerCase()) { json(response, 403, { error: "Le compte est limité au site associé à sa session." }); return; }
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const siteId = account.siteId || await getOrCreateSite(client, siteName, body.siteType);
          const vehicle = await client.query(
            `INSERT INTO vehicule (immatriculation, type) VALUES ($1,$2)
             ON CONFLICT (immatriculation) DO UPDATE SET type=EXCLUDED.type RETURNING id`,
            [plate, text(body.type, 100) || "Véhicule"],
          );
          const result = await client.query(
            `INSERT INTO passage_vehicule (entree, vehicule_id, vacation_id, transporteur, conducteur, passagers,
              motif, zone, operation, reference, plomb, etat_chargement, controle_conforme, saisi_par_id, site_id)
             VALUES (NOW(),$1,(SELECT id FROM vacation WHERE utilisateur_id=$2 AND cloture IS NULL ORDER BY ouverture DESC LIMIT 1),
              $3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$2,$13) RETURNING id, entree AS entered_at`,
            [vehicle.rows[0].id, account.sub, text(body.company) || null, driver, text(body.passengers, 255) || null, reason, text(body.zone) || "Accueil", text(body.operation, 40) || "Autre passage", text(body.document_reference, 100) || null, text(body.seal_number, 100) || null, text(body.load_state, 40) || null, body.compliant === true, siteId],
          );
          await client.query("COMMIT");
          json(response, 201, { vehicle: { id: result.rows[0].id, plate, type: text(body.type, 100) || "Véhicule", company: text(body.company), operation: text(body.operation, 40), seal_number: text(body.seal_number, 100), document_reference: text(body.document_reference, 100), load_state: text(body.load_state, 40), driver, passengers: text(body.passengers, 255), reason, zone: text(body.zone) || "Accueil", site_name: siteName, compliant: body.compliant === true, entered_at: result.rows[0].entered_at, exited_at: null } });
        } catch (error) {
          await client.query("ROLLBACK").catch(() => {});
          if (error.code === "23505") { json(response, 409, { error: "Ce véhicule est déjà enregistré comme présent." }); return; }
          throw error;
        } finally { client.release(); }
        return;
      }
      json(response, 405, { error: "Méthode non autorisée." });
    } catch (error) { json(response, error.status || 500, { error: error.message || "Opération véhicule impossible." }); }
    return;
  }

  const vehicleExit = /^\/api\/vehicles\/([0-9a-f-]+)\/exit$/.exec(pathname);
  if (request.method === "PATCH" && vehicleExit) {
    const account = requestUser(request, response);
    if (!account) return;
    try {
      const result = await (await getPool()).query(
        `UPDATE passage_vehicule SET sortie=NOW(), sortie_par_id=$1
         WHERE id=$2 AND sortie IS NULL AND (saisi_par_id=$1 OR ($3::uuid IS NOT NULL AND site_id=$3::uuid)) RETURNING id, sortie AS exited_at`,
        [account.sub, vehicleExit[1], account.siteId || null],
      );
      if (!result.rows[0]) { json(response, 404, { error: "Véhicule présent introuvable ou déjà sorti." }); return; }
      json(response, 200, { vehicle: result.rows[0] });
    } catch (error) { json(response, 500, { error: error.message || "Sortie véhicule impossible." }); }
    return;
  }

  if (pathname === `${apiPrefix}/shifts`) {
    const account = requestUser(request, response);
    if (!account) return;
    try {
      const pool = await getPool();
      if (request.method === "GET") {
        const result = await pool.query(
          `SELECT va.id, va.agent_nom AS "agent_name", va.matricule, va.prestataire_nom AS prestataire,
             va.site_id AS "siteId", va.poste_nom AS "post_name", va.shift_type AS shift,
             s.nom AS site, va.ouverture AS started_at, va.cloture AS ended_at, va.checklist, va.observations AS notes
           FROM vacation va LEFT JOIN site s ON s.id=va.site_id WHERE va.utilisateur_id=$1 ORDER BY va.ouverture DESC LIMIT 100`,
          [account.sub],
        );
        json(response, 200, { shifts: result.rows });
        return;
      }
      if (request.method === "POST") {
        const body = await readJson(request);
        const agent = text(body.agentName);
        const matricule = text(body.matricule, 50);
        const provider = text(body.providerName, 160);
        const post = text(body.postName, 160);
        const siteName = text(body.siteName || account.siteNom);
        if (!agent || !matricule || !provider || !post || !siteName) {
          json(response, 400, { error: "Renseignez agent, matricule, prestataire, site et poste." });
          return;
        }
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          if (account.siteId && account.siteNom && siteName.toLocaleLowerCase() !== account.siteNom.toLocaleLowerCase()) throw Object.assign(new Error("Le compte est limité au site associé à sa session."), { status: 403 });
          const siteId = account.siteId || await getOrCreateSite(client, siteName, body.siteType);
          const result = await client.query(
            `INSERT INTO vacation (ouverture, utilisateur_id, agent_nom, matricule, prestataire_nom, site_id, poste_nom, shift_type, checklist, observations)
             VALUES (COALESCE($1::timestamptz,NOW()),$2,$3,$4,$5,$6,$7,$8::shift_agent,$9::jsonb,$10) RETURNING id, ouverture AS started_at`,
             [body.startedAt || null, account.sub, agent, matricule, provider, siteId, post, null, JSON.stringify(body.checklist || {}), text(body.observations, 20000)],
          );
          await client.query("COMMIT");
          json(response, 201, { shift: { ...result.rows[0], agent_name: agent, matricule, prestataire: provider, site: siteName, siteId, post_name: post, shift: null, ended_at: null, checklist: body.checklist || {}, notes: text(body.observations, 20000) } });
        } catch (error) {
          await client.query("ROLLBACK").catch(() => {});
          json(response, error.status || (error.code === "23505" ? 409 : 500), { error: error.message || (error.code === "23505" ? "Une vacation est déjà ouverte pour ce matricule." : "Ouverture de vacation impossible.") });
        } finally { client.release(); }
        return;
      }
      json(response, 405, { error: "Méthode non autorisée." });
    } catch (error) { json(response, error.status || 500, { error: error.message || "Opération sur les vacations impossible." }); }
    return;
  }

  const shiftEnd = /^\/api\/shifts\/([0-9a-f-]+)\/end$/.exec(pathname);
  if (request.method === "POST" && shiftEnd) {
    const account = requestUser(request, response);
    if (!account) return;
    try {
      const result = await (await getPool()).query(
        "UPDATE vacation SET cloture=NOW() WHERE id=$1 AND utilisateur_id=$2 AND cloture IS NULL RETURNING id, cloture AS ended_at",
        [shiftEnd[1], account.sub],
      );
      if (!result.rows[0]) { json(response, 409, { error: "Vacation active introuvable ou déjà terminée." }); return; }
      json(response, 200, { shift: result.rows[0] });
    } catch (error) { json(response, 500, { error: error.message || "Clôture de vacation impossible." }); }
    return;
  }

  if (pathname === `${apiPrefix}/passations`) {
    const account = requestUser(request, response);
    if (!account) return;
    try {
      const pool = await getPool();
      if (request.method === "GET") {
        const result = await pool.query(
          `SELECT id, sortant_nom AS outgoing_agent, sortant_matricule AS outgoing_matricule,
             entrant_nom AS incoming_agent, entrant_matricule AS incoming_matricule, poste_nom AS post_name,
             materiel AS equipment, evenements AS ongoing_events, consignes AS instructions,
             confirmation_sortant AS outgoing_signed, confirmation_entrant AS incoming_signed, cree_le AS created_at
           FROM passation WHERE utilisateur_id=$1 OR ($2::uuid IS NOT NULL AND site_id=$2::uuid)
           ORDER BY cree_le DESC LIMIT 100`,
          [account.sub, account.siteId || null],
        );
        json(response, 200, { passations: result.rows });
        return;
      }
      if (request.method === "POST") {
        const body = await readJson(request);
        const outgoing = text(body.outgoing_agent);
        const outgoingId = text(body.outgoing_matricule, 50);
        const incoming = text(body.incoming_agent);
        const incomingId = text(body.incoming_matricule, 50);
        const post = text(body.post_name, 160);
        if (!outgoing || !outgoingId || !incoming || !incomingId || !post || !body.outgoing_signed || !body.incoming_signed) {
          json(response, 400, { error: "Les deux agents, leurs matricules, le poste et les deux confirmations sont obligatoires." });
          return;
        }
        const client = await pool.connect();
        try {
          const siteId = account.siteId || (body.siteName ? await getOrCreateSite(client, body.siteName, body.siteType) : null);
          const result = await client.query(
            `INSERT INTO passation (sortant_nom, sortant_matricule, entrant_nom, entrant_matricule, poste_nom, materiel, evenements, consignes,
              confirmation_sortant, confirmation_entrant, utilisateur_id, site_id,
              vacation_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,true,$9,$10,
               (SELECT id FROM vacation WHERE utilisateur_id=$9 AND cloture IS NULL ORDER BY ouverture DESC LIMIT 1))
             RETURNING id, cree_le AS created_at`,
            [outgoing, outgoingId, incoming, incomingId, post, text(body.equipment, 20000), text(body.ongoing_events, 20000), text(body.instructions, 20000), account.sub, siteId],
          );
          json(response, 201, { passation: { ...body, id: result.rows[0].id, created_at: result.rows[0].created_at } });
        } catch (error) { json(response, 500, { error: error.message || "Enregistrement de passation impossible." }); }
        return;
      }
      json(response, 405, { error: "Méthode non autorisée." });
    } catch (error) { json(response, 500, { error: error.message || "Opération sur les passations impossible." }); }
    return;
  }
}
