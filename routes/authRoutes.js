import bcrypt from "bcryptjs";
import { json, readJson } from "../utils/helpers.js";
import { signAccessToken, verifyAccessToken } from "../utils/auth.js";

const apiPrefix = "/api";

async function findUser(pool, id) {
  const result = await pool.query(
    `SELECT u.id, u.nom, u.identifiant, u.role, u.site_id AS "siteId", s.nom AS "siteNom"
     FROM utilisateur u
     LEFT JOIN site s ON s.id = u.site_id
     WHERE u.id = $1::uuid`,
    [id],
  );
  return result.rows[0] || null;
}

export async function handleAuthRoutes(request, response, pool, pathname, jwtSecret) {
  if (request.method === "POST" && pathname === `${apiPrefix}/auth/login`) {
    try {
      const body = await readJson(request);
      const identifier = typeof body.identifier === "string" ? body.identifier.trim() : "";
      const pin = typeof body.pin === "string" ? body.pin : "";
      if (!identifier || !pin) return json(response, 400, { error: "Identifiant et PIN requis." });

      const result = await pool.query(
        `SELECT u.id, u.nom, u.identifiant, u.role, u.pin_hache,
                u.site_id AS "siteId", s.nom AS "siteNom"
         FROM utilisateur u
         LEFT JOIN site s ON s.id = u.site_id
         WHERE u.identifiant = $1 LIMIT 1`,
        [identifier],
      );
      const record = result.rows[0];
      if (!record || !(await bcrypt.compare(pin, record.pin_hache))) {
        return json(response, 401, { error: "Identifiant ou PIN incorrect." });
      }
      const { pin_hache: _pinHash, ...user } = record;
      const token = signAccessToken(user, jwtSecret);
      const roleLabel = user.role === 1 ? "Administrateur" : "Agent";
      return json(response, 200, {
        token,
        user: { ...user, name: user.nom, roleLabel },
      });
    } catch (error) {
      if (error.status) return json(response, error.status, { error: error.message });
      console.error("POST /auth/login failed:", error.code || error.name, error.message || "");
      return json(response, 500, { error: "Connexion impossible." });
    }
  }

  if (request.method === "GET" && pathname === `${apiPrefix}/auth/me`) {
    const authorization = request.headers.authorization || "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    const tokenUser = match ? verifyAccessToken(match[1], jwtSecret) : null;
    if (!tokenUser) return json(response, 401, { error: "Session invalide ou expirée." });
    try {
      const user = await findUser(pool, tokenUser.id);
      if (!user) return json(response, 401, { error: "Utilisateur introuvable." });
      const roleLabel = user.role === 1 ? "Administrateur" : "Agent";
      return json(response, 200, { user: { ...user, name: user.nom, roleLabel } });
    } catch (error) {
      console.error("GET /auth/me failed:", error.code || error.name, error.message || "");
      return json(response, 500, { error: "Session indisponible." });
    }
  }

  return false;
}
