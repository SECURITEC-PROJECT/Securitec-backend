import pool from "../config/db.js";

// Récupérer toutes les prises de poste (table au singulier 'prise_de_poste')
export async function getShifts(request, response) {
  try {
    const query = `
      SELECT id, matricule, nom, prenom, prestataire, site_de_travail, notes, started_at, ended_at 
      FROM prise_de_poste 
      ORDER BY started_at DESC;
    `;
    const result = await pool.query(query);
    return result.rows;
  } catch (error) {
    console.error("Erreur GET /shifts:", error);
    throw error;
  }
}

// Créer une nouvelle prise de poste
export async function createShift(data) {
  const { matricule, nom, prenom, prestataire, site_de_travail, notes } = data;

  if (!matricule || !nom || !prenom) {
    throw new Error("Le matricule, le nom et le prénom sont obligatoires.");
  }

  const query = `
    INSERT INTO prise_de_poste (matricule, nom, prenom, prestataire, site_de_travail, notes, started_at)
    VALUES ($1, $2, $3, $4, $5, $6, NOW())
    RETURNING *;
  `;
  const values = [
    matricule,
    nom,
    prenom,
    prestataire || "securitec",
    site_de_travail || "Usine Antsirabe",
    notes || ""
  ];

  const result = await pool.query(query, values);
  return result.rows[0];
}

// Clôturer une prise de poste
export async function endShift(shiftId) {
  const query = `
    UPDATE prise_de_poste 
    SET ended_at = NOW() 
    WHERE id = $1 
    RETURNING *;
  `;
  const result = await pool.query(query, [shiftId]);

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0];
}