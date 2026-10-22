// Employés (agents) : données d'EXEMPLE uniquement.
// Dépend de 001_sites.js et 002_prestataires.js (à exécuter avant).
// "matricule" est unique : ON CONFLICT met à jour le rôle si l'employé existe déjà.

const employes = [
  { prenom: "Rakoto", nom: "Andrianaivo", matricule: "MAT-0001", role: "Chef de site", prestataire: "HAP SERVICES", site: "US68_USINE MALTO" },
  { prenom: "Rabe", nom: "Randrianarisoa", matricule: "MAT-0002", role: "Agent", prestataire: "HAP SERVICES", site: "US68_USINE MALTO" },
  { prenom: "Hery", nom: "Rasolofo", matricule: "MAT-0003", role: "Superviseur", prestataire: "MSP", site: "US02_USINE ANTSIRABE" },
  { prenom: "Miora", nom: "Razafindrakoto", matricule: "MAT-0004", role: "Agent", prestataire: "SECURITEC", site: "US03_USINE DIEGO" },
  { prenom: "Tiana", nom: "Rakotomalala", matricule: "MAT-0005", role: "Agent", prestataire: "GPS", site: "US50_USINE AMBATOLAMPY" },
  { prenom: "Fidy", nom: "Ravelojaona", matricule: "MAT-0006", role: "Superviseur", prestataire: "TSG", site: "US65_USINE ANDRANOVELONA" },
];

export default async function (db) {
  for (const e of employes) {
    const p = await db.query(`SELECT id FROM prestataire WHERE nom = $1`, [e.prestataire]);
    if (p.rowCount === 0) {
      throw new Error(`Prestataire introuvable : ${e.prestataire} (lance 002_prestataires d'abord)`);
    }
    const s = await db.query(`SELECT id FROM site WHERE nom = $1 LIMIT 1`, [e.site]);
    if (s.rowCount === 0) {
      throw new Error(`Site introuvable : ${e.site} (lance 001_sites d'abord)`);
    }

    await db.query(
      `INSERT INTO employe (prenom, nom, matricule, actif, role, prestataire_id, site_id)
       VALUES ($1, $2, $3, true, $4, $5, $6)
       ON CONFLICT (matricule) DO UPDATE SET role = EXCLUDED.role`,
      [e.prenom, e.nom, e.matricule, e.role, p.rows[0].id, s.rows[0].id]
    );
    console.log(`  ✓ employé : ${e.prenom} ${e.nom} (${e.matricule}) — ${e.role}`);
  }
}
