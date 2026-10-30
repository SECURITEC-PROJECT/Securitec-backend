import { getRequestUser } from "../utils/auth.js";
import { json } from "../utils/helpers.js";

const collectionPath = "/api/notifications";
const readPath = /^\/api\/notifications\/([0-9a-f-]{36})\/read$/i;

export async function handleNotificationRoutes(request, response, pool, pathname, jwtSecret) {
  const match = readPath.exec(pathname);
  if (pathname !== collectionPath && !match) return false;
  const user = getRequestUser(request, jwtSecret);
  if (!user) {
    json(response, 401, { error: "Connectez-vous pour consulter les notifications." });
    return true;
  }

  try {
    if (request.method === "GET" && pathname === collectionPath) {
      const result = await pool.query(
        `SELECT id, site_id AS "siteId", titre AS title, message, type,
                entite_id AS "entityId", lue_le AS "readAt", cree_le AS "createdAt"
         FROM notification_interne
         WHERE utilisateur_id=$1::uuid
         ORDER BY cree_le DESC LIMIT 100`,
        [user.id],
      );
      json(response, 200, { notifications: result.rows });
      return true;
    }
    if (request.method === "PATCH" && match) {
      const result = await pool.query(
        `UPDATE notification_interne SET lue_le=COALESCE(lue_le,NOW())
         WHERE id=$1::uuid AND utilisateur_id=$2::uuid
         RETURNING id, lue_le AS "readAt"`,
        [match[1], user.id],
      );
      if (!result.rows[0]) {
        json(response, 404, { error: "Notification introuvable." });
        return true;
      }
      json(response, 200, { notification: result.rows[0] });
      return true;
    }
    json(response, 405, { error: "Méthode non autorisée." });
  } catch (error) {
    console.error("/api/notifications failed:", error.code || error.name, error.message || "");
    json(response, 500, { error: "Chargement ou mise à jour des notifications impossible." });
  }
  return true;
}
