import { json, readJson } from "../utils/helpers.js";

const shiftSelect = `
  SELECT v.id, COALESCE(NULLIF(v.agent_nom, ''), u.nom) AS agent_nom,
         v.prestataire_nom AS prestataire,
         COALESCE(s.nom, v.poste_nom, '') AS site_de_travail,
         v.ouverture AS started_at, v.cloture AS ended_at,
         v.checklist AS checks, v.observations AS notes
  FROM vacation v
  LEFT JOIN site s ON s.id = v.site_id
  LEFT JOIN utilisateur u ON u.id = v.utilisateur_id
`;

function toLegacyShift(row) {
  const [nom = "", ...prenomParts] = (row.agent_nom || "").trim().split(/\s+/);
  return {
    id: row.id,
    nom,
    prenom: prenomParts.join(" "),
    prestataire: row.prestataire || "",
    site_de_travail: row.site_de_travail || "",
    started_at: row.started_at,
    ended_at: row.ended_at,
    checks: row.checks || {},
    notes: row.notes || "",
  };
}

async function getShiftById(pool, id) {
  const result = await pool.query(`${shiftSelect} WHERE v.id = $1::uuid`, [id]);
  return result.rows[0] ? toLegacyShift(result.rows[0]) : null;
}

export async function getShifts(request, response, pool) {
  try {
    const result = await pool.query(`${shiftSelect} ORDER BY v.ouverture DESC`);
    json(response, 200, result.rows.map(toLegacyShift));
  } catch (error) {
    console.error("GET /shifts failed:", error.code || error.name, error.message || "");
    json(response, 500, { error: "Impossible de charger les prises de poste." });
  }
}

export async function createShift(request, response, pool, userId) {
  try {
    const body = await readJson(request);
    const nom = typeof body.nom === "string" ? body.nom.trim() : "";
    const prenom = typeof body.prenom === "string" ? body.prenom.trim() : "";
    if (!nom || !prenom) return json(response, 400, { error: "Le nom et le prénom sont obligatoires." });

    const userResult = await pool.query("SELECT site_id FROM utilisateur WHERE id = $1::uuid", [userId]);
    if (!userResult.rows[0]) return json(response, 401, { error: "Session utilisateur introuvable." });

    const requestedSite = typeof body.site_de_travail === "string" ? body.site_de_travail.trim() : "";
    let siteId = userResult.rows[0].site_id;
    if (requestedSite) {
      const siteResult = await pool.query("SELECT id FROM site WHERE nom = $1 LIMIT 1", [requestedSite]);
      if (siteResult.rows[0]) siteId = siteResult.rows[0].id;
    }

    const result = await pool.query(
      `INSERT INTO vacation
         (ouverture, utilisateur_id, agent_nom, prestataire_nom, site_id, checklist, observations)
       VALUES (NOW(), $1::uuid, $2, $3, $4::uuid, $5::jsonb, $6)
       RETURNING id`,
      [
        userId,
        `${nom} ${prenom}`,
        typeof body.prestataire === "string" ? body.prestataire.trim() : null,
        siteId,
        JSON.stringify(body.checks && typeof body.checks === "object" ? body.checks : {}),
        typeof body.notes === "string" ? body.notes.trim() : null,
      ],
    );
    const shift = await getShiftById(pool, result.rows[0].id);
    json(response, 201, shift);
  } catch (error) {
    if (error.status) return json(response, error.status, { error: error.message });
    console.error("POST /shifts failed:", error.code || error.name, error.message || "");
    json(response, 500, { error: "Impossible d'enregistrer la prise de poste." });
  }
}

export async function endShift(request, response, pool, shiftId) {
  try {
    const result = await pool.query(
      "UPDATE vacation SET cloture = NOW() WHERE id = $1::uuid AND cloture IS NULL RETURNING id",
      [shiftId],
    );
    if (!result.rows[0]) return json(response, 404, { error: "Service introuvable ou déjà terminé." });
    json(response, 200, await getShiftById(pool, result.rows[0].id));
  } catch (error) {
    console.error("PUT /shifts/:id/end failed:", error.code || error.name, error.message || "");
    json(response, 500, { error: "Impossible de clôturer le service." });
  }
}
