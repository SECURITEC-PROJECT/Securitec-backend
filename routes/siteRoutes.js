import { getRequestUser } from "../utils/auth.js";
import { json } from "../utils/helpers.js";

const apiPrefix = "/api";

export async function handleSiteRoutes(request, response, pool, pathname, jwtSecret) {
  if (pathname !== `${apiPrefix}/sites`) return false;
  if (request.method !== "GET") {
    json(response, 405, { error: "Méthode non autorisée." });
    return true;
  }
  const user = getRequestUser(request, jwtSecret);
  if (!user) {
    json(response, 401, { error: "Connectez-vous pour consulter les sites." });
    return true;
  }
  try {
    const accountResult = await pool.query(
      "SELECT role, site_id FROM utilisateur WHERE id = $1::uuid LIMIT 1",
      [user.id],
    );
    const account = accountResult.rows[0];
    if (!account) {
      json(response, 401, { error: "Utilisateur introuvable." });
      return true;
    }
    const result = account.site_id && account.role !== 1
      ? await pool.query("SELECT id, nom AS name, type_site AS type FROM site WHERE id = $1::uuid AND actif = true", [account.site_id])
      : await pool.query("SELECT id, nom AS name, type_site AS type FROM site WHERE actif = true ORDER BY nom");
    json(response, 200, { sites: result.rows, canCreate: false, canDelete: false });
  } catch (error) {
    console.error("GET /sites failed:", error.code || error.name, error.message || "");
    json(response, 500, { error: "Impossible de charger les sites." });
  }
  return true;
}
