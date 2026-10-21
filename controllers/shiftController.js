import { json, readJson } from "../utils/helpers.js";

const shiftSelect = `
  SELECT v.id, COALESCE(NULLIF(v.agent_nom, ''), u.nom) AS agent_nom,
         v.prestataire_nom AS prestataire,
         v.matricule AS matricule,
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
    matricule: row.matricule || "",
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
    const matricule = typeof body.matricule === "string" ? body.matricule.trim() : "";
    if (!matricule) return json(response, 400, { error: "Le matricule de l’employé est obligatoire." });

    const userResult = await pool.query("SELECT id FROM utilisateur WHERE id = $1::uuid", [userId]);
    if (!userResult.rows[0]) return json(response, 401, { error: "Session utilisateur introuvable." });

    const employeeResult = await pool.query(
      `SELECT a.id,a.nom,a.prenom,a.matricule,p.nom AS prestataire,s.id AS site_id,s.nom AS site_name
       FROM agent a JOIN prestataire p ON p.id=a.prestataire_id LEFT JOIN site s ON s.id=a.site_id
       WHERE UPPER(a.matricule)=UPPER($1) AND a.actif=true LIMIT 1`, [matricule],
    );
    const employee = employeeResult.rows[0];
    if (!employee) return json(response, 404, { error: "Aucun employé trouvé pour ce matricule." });
    if (!employee.site_id) return json(response, 409, { error: "Aucun site de travail n’est affecté à cet employé. Complétez sa fiche employé." });

    const result = await pool.query(
      `INSERT INTO vacation
         (ouverture, utilisateur_id, agent_nom, matricule, prestataire_nom, site_id, checklist, observations)
       VALUES (NOW(), $1::uuid, $2, $3, $4, $5::uuid, $6::jsonb, $7)
       RETURNING id`,
      [
        userId,
        `${employee.nom} ${employee.prenom}`,
        employee.matricule,
        employee.prestataire,
        employee.site_id,
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
