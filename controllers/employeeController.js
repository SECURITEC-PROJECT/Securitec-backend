import pool from "../config/db.js";

// Vérifier un employé par matricule
export async function getEmployeeByMatricule(matricule) {
  const query = `
    SELECT id, matricule, nom, prenom 
    FROM employe 
    WHERE UPPER(matricule) = UPPER($1);
  `;
  const result = await pool.query(query, [matricule]);
  return result.rows[0] || null;
}

// Récupérer les options pour prestataires et sites de travail
export async function getFormDataOptions() {
  const prestatairesRes = await pool.query(
    "SELECT id, nom AS prestataire FROM prestataire WHERE actif = true ORDER BY nom ASC;"
  );
  const sitesRes = await pool.query(
    "SELECT id, nom AS site FROM site WHERE actif = true ORDER BY nom ASC;"
  );
  return { prestataires: prestatairesRes.rows, sites: sitesRes.rows };
}