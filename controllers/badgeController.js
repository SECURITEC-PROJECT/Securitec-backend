import { json, readJson } from "../utils/helpers.js";

const badgeSelect = `
  SELECT b.id, b.uid_nfc AS uid,
         COALESCE(u.nom, v.identite, 'Badge non attribué') AS holder,
         COALESCE(vs.nom, us.nom, 'Site non renseigné') AS zone,
         CASE WHEN v.id IS NOT NULL THEN 'Visiteur'
              WHEN b.utilisateur_id IS NOT NULL THEN 'Personnel'
              ELSE COALESCE(b.couleur, 'Prestataire') END AS level,
         (b.statut = 1 AND b.validite >= NOW() AND NOT COALESCE(v.liste_noire, false)) AS active,
         b.validite
  FROM badge b
  LEFT JOIN utilisateur u ON u.id = b.utilisateur_id
  LEFT JOIN site us ON us.id = u.site_id
  LEFT JOIN visiteur v ON v.badge_id = b.id
  LEFT JOIN site vs ON vs.id = v.site_id
`;

export async function getBadges(request, response, pool) {
  try {
    const result = await pool.query(`${badgeSelect} ORDER BY holder, b.uid_nfc`);
    json(response, 200, result.rows);
  } catch (error) {
    console.error("GET /badges failed:", error.code || error.name, error.message || "");
    json(response, 500, { error: "Impossible de charger les badges." });
  }
}

export async function scanBadge(request, response, pool) {
  try {
    const body = await readJson(request);
    const uid = typeof body.uid === "string" ? body.uid.trim() : "";
    if (!uid) return json(response, 400, { error: "L'UID du badge est obligatoire." });

    const result = await pool.query(`${badgeSelect} WHERE UPPER(b.uid_nfc) = UPPER($1) LIMIT 1`, [uid]);
    const badge = result.rows[0];
    if (!badge) {
      return json(response, 200, {
        allowed: false,
        title: "Badge inconnu",
        text: "Aucun badge avec cet UID n'existe dans la base.",
      });
    }

    json(response, 200, {
      allowed: badge.active,
      title: badge.active ? "Accès autorisé" : "Accès refusé",
      text: `${badge.holder} · ${badge.zone} · validité jusqu'au ${new Date(badge.validite).toLocaleDateString("fr-FR")}`,
      badge,
    });
  } catch (error) {
    console.error("POST /badges/scan failed:", error.code || error.name, error.message || "");
    json(response, 500, { error: "Impossible de vérifier le badge." });
  }
}

export async function updateBadgeStatus(request, response, pool, badgeId) {
  try {
    const body = await readJson(request);
    if (typeof body.active !== "boolean") {
      return json(response, 400, { error: "Le statut actif du badge est obligatoire." });
    }
    const result = await pool.query(
      "UPDATE badge SET statut = $1 WHERE id = $2::uuid RETURNING id",
      [body.active ? 1 : 0, badgeId],
    );
    if (!result.rows[0]) return json(response, 404, { error: "Badge introuvable." });
    const updated = await pool.query(`${badgeSelect} WHERE b.id = $1::uuid`, [badgeId]);
    json(response, 200, updated.rows[0]);
  } catch (error) {
    console.error("PUT /badges/:id failed:", error.code || error.name, error.message || "");
    json(response, 500, { error: "Impossible de modifier le statut du badge." });
  }
}
