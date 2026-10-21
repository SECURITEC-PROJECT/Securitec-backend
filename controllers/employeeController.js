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
  const prestatairesRes = await pool.query("SELECT id, prestataire FROM prestataire ORDER BY prestataire ASC;");
  const sitesRes = await pool.query("SELECT id, site FROM site_de_travail ORDER BY site ASC;");

  return {
    prestataires: prestatairesRes.rows,
    sites: sitesRes.rows,
  };
}