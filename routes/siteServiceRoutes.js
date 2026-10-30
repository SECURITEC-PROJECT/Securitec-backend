import { getRequestUser } from "../utils/auth.js";
import { json, readJson } from "../utils/helpers.js";

const collectionPath = "/api/site-services";
const entryPath = /^\/api\/site-services\/([0-9a-f-]{36})$/i;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clean = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";

export async function handleSiteServiceRoutes(request, response, pool, pathname, jwtSecret) {
  const match = entryPath.exec(pathname);
  if (pathname !== collectionPath && !match) return false;
  try {
    const tokenUser = getRequestUser(request, jwtSecret);
    if (!tokenUser) throw Object.assign(new Error("Connectez-vous pour gérer les services du site."), { status: 401 });
    const accountResult = await pool.query("SELECT id,role FROM utilisateur WHERE id=$1::uuid AND actif=true LIMIT 1", [tokenUser.id]);
    const account = accountResult.rows[0];
    if (!account) throw Object.assign(new Error("Utilisateur introuvable ou désactivé."), { status: 401 });
    if (Number(account.role) !== 1) throw Object.assign(new Error("Seul un administrateur peut gérer les services du site."), { status: 403 });

    if (request.method === "GET" && pathname === collectionPath) {
      const result = await pool.query(
        `SELECT ss.id,ss.site_id AS "siteId",s.nom AS "siteName",ss.nom,ss.departement,ss.responsable,ss.actif
         FROM service_site ss JOIN site s ON s.id=ss.site_id ORDER BY s.nom,ss.nom`,
      );
      json(response, 200, { services: result.rows });
      return true;
    }
    if (request.method === "POST" && pathname === collectionPath) {
      const body = await readJson(request);
      const siteId = body.siteId;
      const name = clean(body.nom, 160);
      if (!uuidPattern.test(siteId || "") || !name) throw Object.assign(new Error("Choisissez un site et indiquez le nom du service."), { status: 400 });
      const site = await pool.query("SELECT id FROM site WHERE id=$1::uuid AND actif=true", [siteId]);
      if (!site.rows[0]) throw Object.assign(new Error("Site introuvable ou inactif."), { status: 404 });
      const result = await pool.query(
        `INSERT INTO service_site(site_id,nom,departement,responsable)
         VALUES($1::uuid,$2,$3,$4)
         RETURNING id,site_id AS "siteId",nom,departement,responsable,actif`,
        [siteId, name, clean(body.departement, 160), clean(body.responsable, 160)],
      );
      json(response, 201, { service: { ...result.rows[0], siteName: (await pool.query("SELECT nom FROM site WHERE id=$1::uuid", [siteId])).rows[0]?.nom || "" } });
      return true;
    }
    if (!match || !uuidPattern.test(match[1])) throw Object.assign(new Error("Service introuvable."), { status: 404 });
    if (request.method === "PUT") {
      const body = await readJson(request);
      const siteId = body.siteId;
      const name = clean(body.nom, 160);
      if (!uuidPattern.test(siteId || "") || !name || typeof body.actif !== "boolean") throw Object.assign(new Error("Indiquez un site, un nom valide et un état actif."), { status: 400 });
      const site = await pool.query("SELECT nom FROM site WHERE id=$1::uuid AND actif=true", [siteId]);
      if (!site.rows[0]) throw Object.assign(new Error("Site introuvable ou inactif."), { status: 404 });
      const result = await pool.query(
        `UPDATE service_site SET site_id=$2::uuid,nom=$3,departement=$4,responsable=$5,actif=$6,modifie_le=NOW()
         WHERE id=$1::uuid RETURNING id,site_id AS "siteId",nom,departement,responsable,actif`,
        [match[1], siteId, name, clean(body.departement, 160), clean(body.responsable, 160), body.actif],
      );
      if (!result.rows[0]) throw Object.assign(new Error("Service introuvable."), { status: 404 });
      json(response, 200, { service: { ...result.rows[0], siteName: site.rows[0].nom } });
      return true;
    }
    if (request.method === "DELETE") {
      const result = await pool.query("UPDATE service_site SET actif=false,modifie_le=NOW() WHERE id=$1::uuid AND actif=true RETURNING id", [match[1]]);
      if (!result.rows[0]) throw Object.assign(new Error("Service introuvable ou déjà désactivé."), { status: 404 });
      json(response, 200, { id: result.rows[0].id, deactivated: true });
      return true;
    }
    json(response, 405, { error: "Méthode non autorisée." });
  } catch (error) {
    const duplicate = error.code === "23505";
    console.error("Site service route failed:", error.code || error.name, error.message || "");
    json(response, error.status || (duplicate ? 409 : 500), {
      error: error.status ? error.message : duplicate ? "Un service porte déjà ce nom sur ce site." : "Opération sur les services du site impossible.",
    });
  }
  return true;
}
