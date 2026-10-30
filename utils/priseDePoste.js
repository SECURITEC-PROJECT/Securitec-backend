const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function resolvePriseDePosteId(client, siteId, value, posteId = null) {
  // A register entry always belongs to the open service at its post. When the
  // client omits the id, resolve the sole active service for this site; an
  // explicitly supplied service must still be open.
  if (value == null || value === "") value = null;
  if (value !== null && (typeof value !== "string" || !uuidPattern.test(value))) {
    throw Object.assign(new Error("La prise de poste sélectionnée est invalide."), { status: 400 });
  }
  if (posteId !== null && (typeof posteId !== "string" || !uuidPattern.test(posteId))) {
    throw Object.assign(new Error("Le poste sélectionné est invalide."), { status: 400 });
  }
  const result = await client.query(
    `SELECT DISTINCT ON (sp.id) p.id
     FROM service_poste sp
     JOIN prise_de_poste p ON p.service_id=sp.id
     WHERE ($2::uuid IS NULL OR sp.id=$2::uuid OR p.id=$2::uuid)
       AND (sp.site_id=$1::uuid OR (sp.site_id IS NULL AND EXISTS (
         SELECT 1 FROM site s WHERE s.id=$1::uuid
           AND LOWER(BTRIM(p.site_de_travail))=LOWER(BTRIM(s.nom))
       )))
       AND ($3::uuid IS NULL OR sp.poste_id=$3::uuid)
       AND sp.ended_at IS NULL AND p.ended_at IS NULL
     ORDER BY sp.id, CASE WHEN p.fonction_service='CHEF' THEN 0 ELSE 1 END, p.started_at
     LIMIT 2`,
    [siteId, value, posteId],
  );
  if (value === null && posteId === null && result.rows.length > 1) {
    throw Object.assign(new Error("Plusieurs services sont ouverts sur ce site. Sélectionnez le poste concerné avant de saisir."), { status: 409 });
  }
  if (!result.rows[0]) {
    throw Object.assign(new Error(value
      ? "La prise de poste sélectionnée n’est pas active sur ce site."
      : "Ouvrez un service de poste avant d’enregistrer dans ce cahier."), { status: value ? 400 : 409 });
  }
  return result.rows[0].id;
}

export async function resolveServicePosteId(client, siteId, value, posteId = null) {
  const memberId = await resolvePriseDePosteId(client, siteId, value, posteId);
  if (!memberId) return null;
  const result = await client.query(
    `SELECT service_id AS id FROM prise_de_poste WHERE id=$1::uuid LIMIT 1`,
    [memberId],
  );
  return result.rows[0]?.id || null;
}
