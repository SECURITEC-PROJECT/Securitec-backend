// Habilitations de clés : quels rôles ont le droit de percevoir quelle clé (données d'EXEMPLE).
// Dépend de la migration qui crée la table cle_habilitation.
// (trousse_cle, role_autorise) est unique : ON CONFLICT évite les doublons.

const habilitations = [
  { cle: "CLE-STANDARD", roles: ["Agent", "Superviseur", "Chef de site"] },
  { cle: "CLE-MAGASIN", roles: ["Superviseur", "Chef de site"] },
  { cle: "CLE-SALLE-SERVEUR", roles: ["Chef de site"] },
];

export default async function (db) {
  for (const h of habilitations) {
    for (const role of h.roles) {
      const res = await db.query(
        `INSERT INTO cle_habilitation (trousse_cle, role_autorise)
         VALUES ($1, $2)
         ON CONFLICT (trousse_cle, role_autorise) DO NOTHING`,
        [h.cle, role]
      );
      console.log(res.rowCount ? `  + ${h.cle} → ${role}` : `  = déjà présent : ${h.cle} → ${role}`);
    }
  }
}
