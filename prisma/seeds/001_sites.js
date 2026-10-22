// Sites de travail (liste issue du fichier Excel).
// La table "site" n'a pas de contrainte unique sur "nom" :
// on insère seulement si aucun site du même nom n'existe (relançable sans doublons).

const sites = [
  { nom: "US02_USINE ANTSIRABE", adresse: "Antsirabe, Madagascar" },
  { nom: "US03_USINE DIEGO", adresse: "Antsiranana (Diego), Madagascar" },
  { nom: "US50_USINE AMBATOLAMPY", adresse: "Ambatolampy, Madagascar" },
  { nom: "US65_USINE ANDRANOVELONA", adresse: "Andranovelona, Madagascar" },
  { nom: "US68_USINE MALTO", adresse: "Malto, Madagascar" },
];

export default async function (db) {
  for (const s of sites) {
    const res = await db.query(
      `INSERT INTO site (nom, adresse, actif, type_site)
       SELECT $1::varchar, $2::text, true, 'USINE'
       WHERE NOT EXISTS (SELECT 1 FROM site WHERE nom = $1::varchar)`,
      [s.nom, s.adresse]
    );
    console.log(res.rowCount ? `  + site créé : ${s.nom}` : `  = déjà présent : ${s.nom}`);
  }
}
