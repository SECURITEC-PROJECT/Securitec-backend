import bcrypt from "bcryptjs";
import {
  apiPrefix, getPool, json, readJson, isRateLimited, clearLoginAttempts, createToken, publicUser, logNetworkCauses, readToken,
} from "../server-support.js";

export async function handleAuth(request, response, pathname) {
  if (request.method === "POST" && pathname === `${apiPrefix}/auth/login`) {
    const ip = request.socket.remoteAddress || "unknown";
    if (isRateLimited(ip)) {
      json(response, 429, { error: "Trop de tentatives. Réessayez dans 15 minutes." });
      return;
    }

    try {
      const body = await readJson(request);
      const identifier = typeof body.identifier === "string" ? body.identifier.trim() : "";
      const pin = typeof body.pin === "string" ? body.pin : "";
      if (!identifier || !/^\d{6}$/.test(pin)) {
        json(response, 400, { error: "Saisissez un identifiant et un PIN de 6 chiffres." });
        return;
      }

      const pool = await getPool();
      const result = await pool.query(
        `SELECT u.id, u.nom, u.identifiant, u.role, u.pin_hache, u.site_id, s.nom AS site_nom
         FROM utilisateur u
         LEFT JOIN site s ON s.id = u.site_id
         WHERE LOWER(u.identifiant) = LOWER($1)
         LIMIT 1`,
        [identifier],
      );
      const account = result.rows[0];
      const validPin = account?.pin_hache
        ? await bcrypt.compare(pin, account.pin_hache).catch(() => false)
        : false;

      if (!account || !validPin) {
        json(response, 401, { error: "Identifiant ou PIN incorrect." });
        return;
      }

      clearLoginAttempts(ip);
      json(response, 200, { token: createToken(account), user: publicUser(account) });
    } catch (error) {
      if (error.status) {
        json(response, error.status, { error: error.message });
        return;
      }
      console.error("Échec de la connexion:", error.code || error.name || "ERREUR", error.message || "");
      logNetworkCauses(error);
      json(response, 503, { error: "Service de connexion indisponible. Vérifiez la connexion à la base de données." });
    }
    return;
  }

  if (request.method === "GET" && pathname === `${apiPrefix}/auth/me`) {
    const account = readToken(request);
    if (!account) {
      json(response, 401, { error: "Session absente ou expirée." });
      return;
    }
    json(response, 200, { user: publicUser(account) });
    return;
  }

  if (request.method === "GET" && pathname === `${apiPrefix}/health`) {
    try {
      await getPool();
      json(response, 200, { api: "ok", database: "connected" });
    } catch (error) {
      console.error("Connexion PostgreSQL impossible:", error.code || error.name || "ERREUR", error.message || "");
      logNetworkCauses(error);
      json(response, 503, { api: "ok", database: "unavailable" });
    }
    return;
  }
}
