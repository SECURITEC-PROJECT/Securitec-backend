import { getRequestUser } from "../utils/auth.js";
import { json, readJson } from "../utils/helpers.js";

const collectionPath = "/api/sites";

export async function handleSiteRoutes(request, response, pool, pathname, jwtSecret) {
  const siteMatch = /^\/api\/sites\/([0-9a-f-]{36})$/i.exec(pathname);
  if (pathname !== collectionPath && !siteMatch) return false;
  const user = getRequestUser(request, jwtSecret);
  if (!user) { json(response, 401, { error: "Connectez-vous pour consulter les sites." }); return true; }

  try {
    const accountResult = await pool.query("SELECT role,site_id FROM utilisateur WHERE id=$1::uuid LIMIT 1", [user.id]);
    const account = accountResult.rows[0];
    if (!account) { json(response, 401, { error: "Utilisateur introuvable." }); return true; }

    if (pathname === collectionPath && request.method === "GET") {
      const result = account.site_id && account.role !== 1
        ? await pool.query("SELECT id,nom AS name,type_site AS type FROM site WHERE id=$1::uuid AND actif=true", [account.site_id])
        : await pool.query("SELECT id,nom AS name,type_site AS type FROM site WHERE actif=true ORDER BY nom");
      json(response, 200, { sites: result.rows, canCreate: account.role === 1, canDelete: account.role === 1 });
      return true;
    }

    if (account.role !== 1) { json(response, 403, { error: "Seul un administrateur peut gérer les sites." }); return true; }

    if (pathname === collectionPath && request.method === "POST") {
      const body = await readJson(request);
      const name = typeof body.name === "string" ? body.name.trim().slice(0, 255) : "";
      const type = body.type === "AGENCE" || body.type === "USINE" ? body.type : null;
      if (!name || !type) { json(response, 400, { error: "Indiquez le nom du site et son type." }); return true; }
      const result = await pool.query(
        "INSERT INTO site (nom,adresse,type_site,actif) VALUES ($1,$2,$3::type_site,true) RETURNING id,nom AS name,type_site AS type",
        [name, typeof body.address === "string" ? body.address.trim().slice(0, 2000) : "", type],
      );
      json(response, 201, { site: result.rows[0] });
      return true;
    }

    if (siteMatch && request.method === "DELETE") {
      const result = await pool.query("UPDATE site SET actif=false WHERE id=$1::uuid AND actif=true RETURNING id", [siteMatch[1]]);
      if (!result.rows[0]) { json(response, 404, { error: "Site introuvable ou déjà archivé." }); return true; }
      json(response, 200, { id: result.rows[0].id, archived: true });
      return true;
    }

    json(response, 405, { error: "Méthode non autorisée." });
  } catch (error) {
    console.error("Site route failed:", error.code || error.name, error.message || "");
    json(response, error.code === "23505" ? 409 : 500, { error: error.code === "23505" ? "Un site porte déjà ce nom." : "Opération sur le site impossible." });
  }
  return true;
}
