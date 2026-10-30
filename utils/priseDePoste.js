const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function resolvePriseDePosteId(client, siteId, value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw Object.assign(new Error("La prise de poste sélectionnée est invalide."), { status: 400 });
  }
  const result = await client.query(
    `SELECT p.id
     FROM service_poste sp
     JOIN prise_de_poste p ON p.service_id=sp.id
     WHERE (sp.id=$2::uuid OR p.id=$2::uuid)
       AND (sp.site_id=$1::uuid OR (sp.site_id IS NULL AND EXISTS (
         SELECT 1 FROM site s WHERE s.id=$1::uuid
           AND LOWER(BTRIM(p.site_de_travail))=LOWER(BTRIM(s.nom))
       )))
     ORDER BY CASE WHEN p.fonction_service='CHEF' THEN 0 ELSE 1 END, p.started_at
     LIMIT 1`,
    [siteId, value],
  );
  if (!result.rows[0]) {
    throw Object.assign(new Error("La prise de poste sélectionnée n’appartient pas à ce site."), { status: 400 });
  }
  return result.rows[0].id;
}

export async function resolveServicePosteId(client, siteId, value) {
  const memberId = await resolvePriseDePosteId(client, siteId, value);
  if (!memberId) return null;
  const result = await client.query(
    `SELECT service_id AS id FROM prise_de_poste WHERE id=$1::uuid LIMIT 1`,
    [memberId],
  );
  return result.rows[0]?.id || null;
}
