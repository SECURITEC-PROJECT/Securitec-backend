// Prestataires de sécurité (liste issue du fichier Excel).
// "nom" est unique dans la table : ON CONFLICT évite les doublons.

const prestataires = ["HAP SERVICES", "MSP", "SECURITEC", "AMPINGA", "GPS", "TSG"];

export default async function (db) {
  for (const nom of prestataires) {
    const res = await db.query(
      `INSERT INTO prestataire (nom, actif)
       VALUES ($1, true)
       ON CONFLICT (nom) DO NOTHING`,
      [nom]
    );
    console.log(res.rowCount ? `  + prestataire créé : ${nom}` : `  = déjà présent : ${nom}`);
  }
}
