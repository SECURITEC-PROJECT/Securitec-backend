const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function resolvePriseDePosteId(client, siteId, value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw Object.assign(new Error("La prise de poste sélectionnée est invalide."), { status: 400 });
  }
  const result = await client.query(
    `SELECT p.id
     FROM prise_de_poste p
     JOIN site s ON s.id=$1::uuid
     WHERE p.id=$2::uuid
       AND LOWER(BTRIM(p.site_de_travail))=LOWER(BTRIM(s.nom))
     LIMIT 1`,
    [siteId, value],
  );
  if (!result.rows[0]) {
    throw Object.assign(new Error("La prise de poste sélectionnée n’appartient pas à ce site."), { status: 400 });
  }
  return result.rows[0].id;
}
