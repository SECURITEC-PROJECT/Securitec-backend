import { json, readJson } from "../utils/helpers.js";
import { createShift } from "./shiftController.js";

const handoverSelect = `
  SELECT id,
         sortant_nom AS agent_sortant_nom,
         sortant_matricule AS agent_sortant_matricule,
         entrant_nom AS incoming_nom,
         entrant_matricule AS incoming_matricule,
         materiel AS equipment,
         evenements AS ongoing_events,
         consignes AS instructions,
         inventaire,
         documents_retenus,
         confirmation_sortant,
         confirmation_entrant,
         confirmation_sortant_le,
         confirmation_entrant_le,
         poste_nom,
         site_id AS site_id,
         prise_de_poste_service_id AS "servicePosteId",
         cree_le AS created_at
  FROM passation
`;

function cleanRows(value, name, validate) {
  if (!Array.isArray(value) || value.length > 100) {
    throw Object.assign(new Error(`${name} doit être une liste valide (100 lignes maximum).`), { status: 400 });
  }
  return value.map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw Object.assign(new Error(`Ligne ${index + 1} invalide dans ${name}.`), { status: 400 });
    }
    return validate(row, index);
  });
}

function requiredText(value, label, max = 500) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > max) {
    throw Object.assign(new Error(`${label} est obligatoire (maximum ${max} caractères).`), { status: 400 });
  }
  return text;
}

function requiredQuantity(value, label, allowZero = false) {
  const quantity = Number(value);
  if (!Number.isSafeInteger(quantity) || quantity < (allowZero ? 0 : 1)) {
    throw Object.assign(new Error(`${label} doit être un nombre entier ${allowZero ? "positif ou nul" : "supérieur à zéro"}.`), { status: 400 });
  }
  return quantity;
}

function requiredChoice(value, choices, label) {
  if (!choices.includes(value)) {
    throw Object.assign(new Error(`${label} n'est pas une valeur reconnue.`), { status: 400 });
  }
  return value;
}

export async function getHandovers(request, response, pool) {
  try {
    const result = await pool.query(`${handoverSelect} ORDER BY cree_le DESC LIMIT 100`);
    json(response, 200, result.rows.map((row) => ({
      ...row,
      agent_sortant_prenom: "",
      incoming_prenom: "",
      inventaire: Array.isArray(row.inventaire) ? row.inventaire : [],
      documents_retenus: Array.isArray(row.documents_retenus) ? row.documents_retenus : [],
    })));
  } catch (error) {
    console.error("Erreur GET /handovers:", error.code || error.name, error.message || "");
    json(response, 500, { error: "Erreur lors de la récupération des passations." });
  }
}

export async function createHandover(request, response, pool, userId) {
  try {
    const body = await readJson(request);
    requiredText(body.incoming_nom, "Le nom de l'agent entrant", 255);
    requiredText(body.incoming_prenom, "Le prénom de l'agent entrant", 255);
    const outgoingNom = requiredText(body.agent_sortant_nom, "Le nom du chef sortant", 255);
    const outgoingPrenom = requiredText(body.agent_sortant_prenom, "Le prénom du chef sortant", 255);
    const outgoingMatricule = requiredText(body.agent_sortant_matricule, "Le matricule du chef sortant", 50);
    const incomingMatricule = requiredText(body.incoming_matricule, "Le matricule de l'agent entrant", 50);

    if (body.confirmation_sortant !== true || body.confirmation_entrant !== true) {
      return json(response, 400, { error: "Les chefs sortant et entrant doivent confirmer la passation." });
    }

    const inventaire = cleanRows(body.inventaire, "L'inventaire", (row, index) => ({
      designation: requiredText(row.designation, `Désignation de l'article ${index + 1}`, 160),
      quantiteSortie: requiredQuantity(row.quantiteSortie, `Quantité sortie de l'article ${index + 1}`, true),
      etatSortie: requiredChoice(row.etatSortie, ["BON", "ABIME", "MANQUANT", "HORS_SERVICE"], `État à la sortie de l'article ${index + 1}`),
      quantiteEntree: requiredQuantity(row.quantiteEntree, `Quantité entrée de l'article ${index + 1}`, true),
      etatEntree: requiredChoice(row.etatEntree, ["BON", "ABIME", "MANQUANT", "HORS_SERVICE"], `État à l'entrée de l'article ${index + 1}`),
      observation: typeof row.observation === "string" ? row.observation.trim().slice(0, 500) : "",
    }));
    const documentsRetenus = cleanRows(body.documents_retenus, "Les pièces et courriers retenus", (row, index) => ({
      type: requiredChoice(row.type, ["PIECE", "COURRIER", "AUTRE"], `Type de l'élément retenu ${index + 1}`),
      reference: requiredText(row.reference, `Référence de l'élément retenu ${index + 1}`, 160),
      description: requiredText(row.description, `Description de l'élément retenu ${index + 1}`, 500),
      quantite: requiredQuantity(row.quantite, `Quantité de l'élément retenu ${index + 1}`),
      detenuPar: requiredText(row.detenuPar, `Détenteur de l'élément retenu ${index + 1}`, 255),
      destination: typeof row.destination === "string" ? row.destination.trim().slice(0, 255) : "",
      restitue: row.restitue === true,
    }));

    const shiftId = typeof body.agent_sortant_id === "string" ? body.agent_sortant_id : null;
    const shiftResult = shiftId
      ? await pool.query(
          `SELECT COALESCE(p.service_id,p.id) AS id, s.id AS site_id,
                  COALESCE(po.nom,s.nom,'Non renseigné') AS poste_nom
           FROM prise_de_poste p
           LEFT JOIN site s ON LOWER(BTRIM(s.nom))=LOWER(BTRIM(p.site_de_travail))
           LEFT JOIN poste po ON po.id=p.poste_id
           WHERE p.id=$1::uuid OR p.service_id=$1::uuid
           ORDER BY CASE WHEN p.fonction_service='CHEF' THEN 0 ELSE 1 END
           LIMIT 1`,
          [shiftId],
        )
      : { rows: [] };
    const shift = shiftResult.rows[0] || null;
    if (!shift) return json(response, 400, { error: "La passation doit être liée au service sortant sélectionné." });

    const incomingEmployee = await pool.query(
      `SELECT nom,prenom FROM employe
       WHERE site_id=$1::uuid AND actif=true AND UPPER(BTRIM(matricule))=UPPER(BTRIM($2))
       LIMIT 1`,
      [shift.site_id, incomingMatricule],
    );
    if (!incomingEmployee.rows[0]) {
      return json(response, 400, { error: "Le chef entrant doit être un employé actif du même site que le service sortant." });
    }
    const incomingNom = incomingEmployee.rows[0].nom;
    const incomingPrenom = incomingEmployee.rows[0].prenom;

    const result = await pool.query(
      `INSERT INTO passation
         (sortant_nom, sortant_matricule, entrant_nom, entrant_matricule,
          poste_nom, materiel, evenements, consignes, inventaire, documents_retenus,
          confirmation_sortant, confirmation_entrant, confirmation_sortant_le, confirmation_entrant_le,
          utilisateur_id, site_id, prise_de_poste_service_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb,
               true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $11::uuid, $12::uuid, $13::uuid)
       RETURNING id, sortant_nom AS agent_sortant_nom, sortant_matricule AS agent_sortant_matricule,
                 entrant_nom AS incoming_nom, entrant_matricule AS incoming_matricule,
                 materiel AS equipment, evenements AS ongoing_events, consignes AS instructions,
                 inventaire, documents_retenus, confirmation_sortant, confirmation_entrant,
                 confirmation_sortant_le, confirmation_entrant_le, poste_nom, site_id AS site_id, cree_le AS created_at`,
      [
        `${outgoingNom} ${outgoingPrenom}`,
        outgoingMatricule,
        `${incomingNom} ${incomingPrenom}`,
        incomingMatricule,
        shift.poste_nom || "Non renseigné",
        typeof body.equipment === "string" ? body.equipment.slice(0, 10000) : "",
        typeof body.ongoing_events === "string" ? body.ongoing_events.slice(0, 10000) : "",
        typeof body.instructions === "string" ? body.instructions.slice(0, 10000) : "",
        JSON.stringify(inventaire),
        JSON.stringify(documentsRetenus),
        userId,
        shift.site_id,
        shift.id,
      ],
    );

    json(response, 201, {
      ...result.rows[0],
      agent_sortant_prenom: outgoingPrenom,
      incoming_prenom: incomingPrenom,
    });
  } catch (error) {
    if (error.status) return json(response, error.status, { error: error.message });
    console.error("Erreur POST /handovers:", error.code || error.name, error.message || "");
    json(response, 500, { error: "Erreur lors de l'enregistrement de la passation." });
  }
}

export async function completeHandover(request, response, pool, userId, allowedSiteId = null) {
  const client = await pool.connect();
  try {
    const body = await readJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw Object.assign(new Error("Corps de passation invalide."), { status: 400 });
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.clientRequestId || "")) {
      throw Object.assign(new Error("Identifiant de requête invalide."), { status: 400 });
    }
    if (!body.shiftData || typeof body.shiftData !== "object" || Array.isArray(body.shiftData)) {
      throw Object.assign(new Error("Les données du service entrant sont obligatoires."), { status: 400 });
    }

    await client.query("BEGIN");
    const previous = await client.query(
      `SELECT id FROM passation
       WHERE client_request_id=$1::uuid AND ($2::uuid IS NULL OR site_id=$2::uuid)`,
      [body.clientRequestId, allowedSiteId],
    );
    if (previous.rows[0]) {
      const handoverResult = await client.query(`${handoverSelect} WHERE id=$1::uuid`, [previous.rows[0].id]);
      const shiftResult = await client.query(
        `SELECT sp.id AS "serviceId",sp.poste_id AS "posteId",po.nom AS "posteNom",
                sp.shift_type AS "shiftType",sp.site_id AS "siteId",
                p.id,p.matricule,p.nom,p.prenom,p.prestataire,p.site_de_travail,p.notes,
                p.started_at AT TIME ZONE 'UTC' AS started_at,p.ended_at AT TIME ZONE 'UTC' AS ended_at,
                p.fonction_service AS "fonctionService"
         FROM service_poste sp JOIN poste po ON po.id=sp.poste_id
         JOIN prise_de_poste p ON p.service_id=sp.id AND p.fonction_service='CHEF'
         WHERE sp.client_request_id=$1::uuid AND ($2::uuid IS NULL OR sp.site_id=$2::uuid)`,
        [body.clientRequestId, allowedSiteId],
      );
      await client.query("COMMIT");
      json(response, 200, {
        handover: { ...handoverResult.rows[0], agent_sortant_prenom: "", incoming_prenom: "" },
        shift: shiftResult.rows[0] ? { ...shiftResult.rows[0], shifts: [shiftResult.rows[0]] } : null,
      });
      return;
    }

    const shiftId = typeof body.agent_sortant_id === "string" ? body.agent_sortant_id : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(shiftId)) {
      throw Object.assign(new Error("Service sortant invalide."), { status: 400 });
    }
    const outgoingResult = await client.query(
      `SELECT sp.id,sp.site_id AS "siteId",sp.poste_id AS "posteId",sp.shift_type AS "shiftType",
              sp.ended_at,po.nom AS "posteNom",p.nom,p.prenom,p.matricule
       FROM service_poste sp
       JOIN poste po ON po.id=sp.poste_id
       JOIN prise_de_poste p ON p.service_id=sp.id AND p.fonction_service='CHEF'
       WHERE sp.id=$1::uuid
       FOR UPDATE OF sp`,
      [shiftId],
    );
    const outgoing = outgoingResult.rows[0];
    if (!outgoing || outgoing.ended_at || (allowedSiteId && outgoing.siteId !== allowedSiteId)) {
      throw Object.assign(new Error("Le service sortant n’est plus ouvert ou n’existe pas."), { status: 409 });
    }

    const outgoingMatricule = requiredText(body.agent_sortant_matricule, "Le matricule du chef sortant", 50);
    if (outgoingMatricule.toLocaleUpperCase("fr") !== outgoing.matricule.toLocaleUpperCase("fr")) {
      throw Object.assign(new Error("Le chef sortant ne correspond pas au service sélectionné."), { status: 409 });
    }
    const incomingMatricule = requiredText(body.incoming_matricule, "Le matricule de l'agent entrant", 50);
    requiredText(body.incoming_nom, "Le nom de l'agent entrant", 255);
    requiredText(body.incoming_prenom, "Le prénom de l'agent entrant", 255);
    if (body.confirmation_sortant !== true || body.confirmation_entrant !== true) {
      throw Object.assign(new Error("Les chefs sortant et entrant doivent confirmer la passation."), { status: 400 });
    }
    const inventaire = cleanRows(body.inventaire, "L'inventaire", (row, index) => ({
      designation: requiredText(row.designation, `Désignation de l'article ${index + 1}`, 160),
      quantiteSortie: requiredQuantity(row.quantiteSortie, `Quantité sortie de l'article ${index + 1}`, true),
      etatSortie: requiredChoice(row.etatSortie, ["BON", "ABIME", "MANQUANT", "HORS_SERVICE"], `État à la sortie de l'article ${index + 1}`),
      quantiteEntree: requiredQuantity(row.quantiteEntree, `Quantité entrée de l'article ${index + 1}`, true),
      etatEntree: requiredChoice(row.etatEntree, ["BON", "ABIME", "MANQUANT", "HORS_SERVICE"], `État à l'entrée de l'article ${index + 1}`),
      observation: typeof row.observation === "string" ? row.observation.trim().slice(0, 500) : "",
    }));
    const documentsRetenus = cleanRows(body.documents_retenus, "Les pièces et courriers retenus", (row, index) => ({
      type: requiredChoice(row.type, ["PIECE", "COURRIER", "AUTRE"], `Type de l'élément retenu ${index + 1}`),
      reference: requiredText(row.reference, `Référence de l'élément retenu ${index + 1}`, 160),
      description: requiredText(row.description, `Description de l'élément retenu ${index + 1}`, 500),
      quantite: requiredQuantity(row.quantite, `Quantité de l'élément retenu ${index + 1}`),
      detenuPar: requiredText(row.detenuPar, `Détenteur de l'élément retenu ${index + 1}`, 255),
      destination: typeof row.destination === "string" ? row.destination.trim().slice(0, 255) : "",
      restitue: row.restitue === true,
    }));

    const shiftData = {
      ...body.shiftData,
      siteId: outgoing.siteId,
      posteId: outgoing.posteId,
      shiftType: outgoing.shiftType,
      chefMatricule: incomingMatricule,
      agentMatricules: [],
      replacesServiceId: outgoing.id,
      clientRequestId: body.clientRequestId,
    };
    const shift = await createShift(shiftData, pool, userId, client);
    const incomingEmployee = await client.query(
      `SELECT nom,prenom FROM employe
       WHERE site_id=$1::uuid AND actif=true AND UPPER(BTRIM(matricule))=UPPER(BTRIM($2))
       LIMIT 1`,
      [outgoing.siteId, incomingMatricule],
    );
    if (!incomingEmployee.rows[0]) {
      throw Object.assign(new Error("Le chef entrant doit être un employé actif du même site que le service sortant."), { status: 400 });
    }

    const inserted = await client.query(
      `INSERT INTO passation
         (client_request_id,sortant_nom,sortant_matricule,entrant_nom,entrant_matricule,
          poste_nom,materiel,evenements,consignes,inventaire,documents_retenus,
          confirmation_sortant,confirmation_entrant,confirmation_sortant_le,confirmation_entrant_le,
          utilisateur_id,site_id,prise_de_poste_service_id)
       VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,
               true,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,$11::uuid,$12::uuid,$13::uuid)
       RETURNING id`,
      [
        body.clientRequestId,
        `${outgoing.nom} ${outgoing.prenom}`,
        outgoing.matricule,
        `${incomingEmployee.rows[0].nom} ${incomingEmployee.rows[0].prenom}`,
        incomingMatricule,
        outgoing.posteNom,
        typeof body.equipment === "string" ? body.equipment.slice(0, 10000) : "",
        typeof body.ongoing_events === "string" ? body.ongoing_events.slice(0, 10000) : "",
        typeof body.instructions === "string" ? body.instructions.slice(0, 10000) : "",
        JSON.stringify(inventaire),
        JSON.stringify(documentsRetenus),
        userId,
        outgoing.siteId,
        outgoing.id,
      ],
    );
    const handover = await client.query(`${handoverSelect} WHERE id=$1::uuid`, [inserted.rows[0].id]);
    await client.query("COMMIT");
    json(response, 201, {
      handover: { ...handover.rows[0], agent_sortant_prenom: outgoing.prenom, incoming_prenom: incomingEmployee.rows[0].prenom },
      shift,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error.status) return json(response, error.status, { error: error.message });
    console.error("Erreur POST /handovers/complete:", error.code || error.name, error.message || "");
    json(response, error.code === "23505" ? 409 : 500, {
      error: error.code === "23505" ? "Cette passation a déjà été enregistrée." : "Erreur lors de l'enregistrement de la passation.",
    });
  } finally {
    client.release();
  }
}
