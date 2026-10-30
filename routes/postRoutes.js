import { getRequestUser } from "../utils/auth.js";
import { json, readJson } from "../utils/helpers.js";

const collectionPath = "/api/admin/posts";
const entryPath = /^\/api\/admin\/posts\/([0-9a-f-]{36})$/i;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function handlePostRoutes(request, response, pool, pathname, jwtSecret) {
  const match = entryPath.exec(pathname);
  if (pathname !== collectionPath && !match) return false;
  try {
    const tokenUser = getRequestUser(request, jwtSecret);
    if (!tokenUser) throw Object.assign(new Error("Connectez-vous pour gérer les postes."), { status: 401 });
    const accountResult = await pool.query("SELECT id,role FROM utilisateur WHERE id=$1::uuid AND actif=true LIMIT 1", [tokenUser.id]);
    const account = accountResult.rows[0];
    if (!account) throw Object.assign(new Error("Utilisateur introuvable ou désactivé."), { status: 401 });
    if (Number(account.role) !== 1) throw Object.assign(new Error("Seul un administrateur peut gérer les postes."), { status: 403 });

    if (request.method === "GET" && pathname === collectionPath) {
      const result = await pool.query(
        `SELECT p.id,p.site_id AS "siteId",p.nom,p.actif,s.nom AS "siteName",
                (SELECT COUNT(*)::int FROM service_poste sp WHERE sp.poste_id=p.id) AS "serviceCount",
                (SELECT COUNT(*)::int FROM compte_rendu cr WHERE cr.poste_id=p.id) AS "reportCount"
         FROM poste p JOIN site s ON s.id=p.site_id ORDER BY s.nom,p.nom`,
      );
      json(response, 200, { posts: result.rows });
      return true;
    }

    if (request.method === "POST" && pathname === collectionPath) {
      const body = await readJson(request);
      const name = typeof body.nom === "string" ? body.nom.trim().slice(0, 160) : "";
      if (!uuidPattern.test(body.siteId || "") || !name) throw Object.assign(new Error("Choisissez un site et indiquez le nom du poste."), { status: 400 });
      const site = await pool.query("SELECT id FROM site WHERE id=$1::uuid AND actif=true", [body.siteId]);
      if (!site.rows[0]) throw Object.assign(new Error("Site introuvable ou inactif."), { status: 404 });
      const created = await pool.query(
        `INSERT INTO poste(site_id,nom,actif) VALUES($1::uuid,$2,true)
         RETURNING id,site_id AS "siteId",nom,actif`, [body.siteId, name],
      );
      json(response, 201, { post: created.rows[0] });
      return true;
    }

    if (!match || !uuidPattern.test(match[1])) throw Object.assign(new Error("Poste introuvable."), { status: 404 });
    if (request.method === "PUT") {
      const body = await readJson(request);
      const name = typeof body.nom === "string" ? body.nom.trim().slice(0, 160) : "";
      if (!name || typeof body.actif !== "boolean") throw Object.assign(new Error("Indiquez un nom valide et un état actif."), { status: 400 });
      const updated = await pool.query(
        `UPDATE poste SET nom=$2,actif=$3 WHERE id=$1::uuid
         RETURNING id,site_id AS "siteId",nom,actif`, [match[1], name, body.actif],
      );
      if (!updated.rows[0]) throw Object.assign(new Error("Poste introuvable."), { status: 404 });
      json(response, 200, { post: updated.rows[0] });
      return true;
    }
    if (request.method === "DELETE") {
      const archived = await pool.query("UPDATE poste SET actif=false WHERE id=$1::uuid AND actif=true RETURNING id", [match[1]]);
      if (!archived.rows[0]) throw Object.assign(new Error("Poste introuvable ou déjà désactivé."), { status: 404 });
      json(response, 200, { id: archived.rows[0].id, deactivated: true });
      return true;
    }
    json(response, 405, { error: "Méthode non autorisée." });
  } catch (error) {
    const duplicate = error.code === "23505";
    console.error("Admin posts route failed:", error.code || error.name, error.message || "");
    json(response, error.status || (duplicate ? 409 : 500), {
      error: error.status ? error.message : duplicate ? "Un poste porte déjà ce nom sur ce site." : "Opération sur les postes impossible.",
    });
  }
  return true;
}
