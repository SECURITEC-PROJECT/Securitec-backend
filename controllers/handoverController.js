import { json, readJson } from "../utils/helpers.js";

const handoverSelect = `
  SELECT id,
         sortant_nom AS agent_sortant_nom,
         '' AS agent_sortant_prenom,
         entrant_nom AS incoming_nom,
         '' AS incoming_prenom,
         materiel AS equipment,
         evenements AS ongoing_events,
         consignes AS instructions,
         cree_le AS created_at
  FROM passation
`;

export async function getHandovers(request, response, pool) {
  try {
    const result = await pool.query(`${handoverSelect} ORDER BY cree_le DESC`);
    json(response, 200, result.rows);
  } catch (error) {
    console.error("Erreur GET /handovers:", error.code || error.name, error.message || "");
    json(response, 500, { error: "Erreur lors de la récupération des passations." });
  }
}

export async function createHandover(request, response, pool, userId) {
  try {
    const body = await readJson(request);
    const incomingNom = typeof body.incoming_nom === "string" ? body.incoming_nom.trim() : "";
    const incomingPrenom = typeof body.incoming_prenom === "string" ? body.incoming_prenom.trim() : "";
    const outgoingNom = typeof body.agent_sortant_nom === "string" ? body.agent_sortant_nom.trim() : "";
    const outgoingPrenom = typeof body.agent_sortant_prenom === "string" ? body.agent_sortant_prenom.trim() : "";

    if (!incomingNom || !incomingPrenom) {
      return json(response, 400, { error: "Le nom et le prénom de l'agent montant sont obligatoires." });
    }

    const shiftId = typeof body.agent_sortant_id === "string" ? body.agent_sortant_id : null;
    const shiftResult = shiftId
      ? await pool.query(
          `SELECT v.id, v.site_id, COALESCE(NULLIF(v.poste_nom, ''), s.nom, 'Non renseigné') AS poste_nom
           FROM vacation v LEFT JOIN site s ON s.id = v.site_id
           WHERE v.id = $1::uuid LIMIT 1`,
          [shiftId],
        )
      : { rows: [] };
    const shift = shiftResult.rows[0] || null;

    const result = await pool.query(
      `INSERT INTO passation
         (sortant_nom, sortant_matricule, entrant_nom, entrant_matricule,
          poste_nom, materiel, evenements, consignes, utilisateur_id, site_id, vacation_id)
       VALUES ($1, 'Non renseigné', $2, 'Non renseigné', $3, $4, $5, $6, $7::uuid, $8::uuid, $9::uuid)
       RETURNING id, sortant_nom AS agent_sortant_nom, entrant_nom AS incoming_nom,
                 materiel AS equipment, evenements AS ongoing_events,
                 consignes AS instructions, cree_le AS created_at`,
      [
        [outgoingNom, outgoingPrenom].filter(Boolean).join(" ") || "Non renseigné",
        [incomingNom, incomingPrenom].join(" "),
        shift?.poste_nom || "Non renseigné",
        typeof body.equipment === "string" ? body.equipment : "",
        typeof body.ongoing_events === "string" ? body.ongoing_events : "",
        typeof body.instructions === "string" ? body.instructions : "",
        userId,
        shift?.site_id || null,
        shift?.id || null,
      ],
    );

    const saved = result.rows[0];
    json(response, 201, {
      ...saved,
      agent_sortant_prenom: outgoingPrenom,
      incoming_prenom: incomingPrenom,
    });
  } catch (error) {
    if (error.status) return json(response, error.status, { error: error.message });
    console.error("Erreur POST /handovers:", error.code || error.name, error.message || "");
    json(response, 500, { error: "Erreur lors de l'enregistrement de la passation." });
  }
}
