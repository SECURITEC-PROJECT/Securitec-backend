import { json, readJson } from "../utils/helpers.js";

// Récupérer tous les badges
export async function getBadges(request, response, pool) {
  try {
    const result = await pool.query(`SELECT id, uid, holder, zone, level, active FROM badges ORDER BY id ASC;`);
    json(response, 200, result.rows);
  } catch (error) {
    console.error("Erreur GET /badges:", error);
    json(response, 500, { error: "Erreur lors de la récupération des badges." });
  }
}

// Scanner / Vérifier un badge par son UID dans la base de données
export async function scanBadge(request, response, pool) {
  try {
    const body = await readJson(request);
    const { uid } = body;

    if (!uid) {
      return json(response, 400, { error: "L'UID du badge est obligatoire." });
    }

    const result = await pool.query(
      `SELECT id, uid, holder, zone, level, active FROM badges WHERE uid = $1 LIMIT 1;`,
      [uid.trim()]
    );

    const badge = result.rows[0];

    if (!badge) {
      return json(response, 404, { allowed: false, title: "Badge inconnu", text: "Ce badge n'existe pas dans le système." });
    }

    const allowed = Boolean(badge.active);
    json(response, 200, {
      allowed,
      title: allowed ? "Accès autorisé" : "Accès refusé",
      text: `${badge.holder} · ${badge.zone} (${badge.level})`,
      badge
    });
  } catch (error) {
    console.error("Erreur POST /badges/scan:", error);
    json(response, 500, { error: "Erreur lors de la lecture du badge." });
  }
}

// Activer / Révoquer un badge
export async function updateBadgeStatus(request, response, pool, badgeId) {
  try {
    const body = await readJson(request);
    const { active } = body;

    const query = `UPDATE badges SET active = $1 WHERE id = $2 RETURNING *;`;
    const result = await pool.query(query, [active, badgeId]);

    if (result.rows.length === 0) {
      return json(response, 404, { error: "Badge non trouvé." });
    }

    json(response, 200, result.rows[0]);
  } catch (error) {
    console.error("Erreur PUT /badges/:id:", error);
    json(response, 500, { error: "Erreur lors de la mise à jour du badge." });
  }
}