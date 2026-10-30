import { getRequestUser } from "../utils/auth.js";
import { json, readJson } from "../utils/helpers.js";

const collectionPath = "/api/emergency-contacts";
const entryPath = /^\/api\/emergency-contacts\/([0-9a-f-]{36})$/i;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clean = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";

async function accountFor(request, pool, secret) {
  const tokenUser = getRequestUser(request, secret);
  if (!tokenUser) throw Object.assign(new Error("Connectez-vous pour consulter les contacts d’urgence."), { status: 401 });
  const result = await pool.query("SELECT id, role, site_id AS \"siteId\" FROM utilisateur WHERE id=$1::uuid AND actif=true", [tokenUser.id]);
  if (!result.rows[0]) throw Object.assign(new Error("Utilisateur introuvable."), { status: 401 });
  return result.rows[0];
}

async function validateSite(pool, account, siteId) {
  if (!uuidPattern.test(siteId || "")) throw Object.assign(new Error("Sélectionnez un site valide."), { status: 400 });
  if (account.siteId && account.role !== 1 && account.siteId !== siteId) throw Object.assign(new Error("Accès refusé à ce site."), { status: 403 });
  const result = await pool.query("SELECT id FROM site WHERE id=$1::uuid AND actif=true", [siteId]);
  if (!result.rows[0]) throw Object.assign(new Error("Site introuvable ou inactif."), { status: 404 });
  return result.rows[0].id;
}

function readContact(body) {
  const name = clean(body.nom, 160);
  const role = clean(body.fonction, 120);
  const phone = clean(body.telephone, 40);
  const email = clean(body.email, 255);
  const instructions = clean(body.instructions, 2000);
  if (!name || !phone) throw Object.assign(new Error("Le nom et le numéro de téléphone sont obligatoires."), { status: 400 });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Object.assign(new Error("L’adresse e-mail est invalide."), { status: 400 });
  return { name, role, phone, email: email || null, instructions: instructions || null };
}

export async function handleEmergencyContactRoutes(request, response, pool, pathname, jwtSecret) {
  const entryMatch = entryPath.exec(pathname);
  if (pathname !== collectionPath && !entryMatch) return false;
  try {
    const account = await accountFor(request, pool, jwtSecret);
    if (request.method === "GET" && pathname === collectionPath) {
      const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
      const siteId = await validateSite(pool, account, url.searchParams.get("siteId"));
      const result = await pool.query(
        `SELECT id, site_id AS "siteId", nom, fonction, telephone, email, instructions, ordre
         FROM contact_urgence WHERE site_id=$1::uuid AND actif=true ORDER BY ordre, nom`, [siteId],
      );
      json(response, 200, { contacts: result.rows });
      return true;
    }
    if (account.role !== 1) throw Object.assign(new Error("Seul un administrateur peut modifier les contacts d’urgence."), { status: 403 });

    if (request.method === "POST" && pathname === collectionPath) {
      const body = await readJson(request);
      const siteId = await validateSite(pool, account, body.siteId);
      const contact = readContact(body);
      const result = await pool.query(
        `INSERT INTO contact_urgence (site_id,nom,fonction,telephone,email,instructions,ordre,modifie_par)
         VALUES ($1::uuid,$2,$3,$4,$5,$6,COALESCE((SELECT MAX(ordre)+1 FROM contact_urgence WHERE site_id=$1::uuid),0),$7::uuid)
         RETURNING id,site_id AS "siteId",nom,fonction,telephone,email,instructions,ordre`,
        [siteId, contact.name, contact.role, contact.phone, contact.email, contact.instructions, account.id],
      );
      json(response, 201, { contact: result.rows[0] });
      return true;
    }
    if (entryMatch && (request.method === "PUT" || request.method === "DELETE")) {
      if (!uuidPattern.test(entryMatch[1])) throw Object.assign(new Error("Contact introuvable."), { status: 404 });
      if (request.method === "DELETE") {
        const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
        const siteId = await validateSite(pool, account, url.searchParams.get("siteId"));
        const result = await pool.query("UPDATE contact_urgence SET actif=false,modifie_le=NOW(),modifie_par=$3::uuid WHERE id=$1::uuid AND site_id=$2::uuid RETURNING id", [entryMatch[1], siteId, account.id]);
        if (!result.rows[0]) throw Object.assign(new Error("Contact introuvable pour ce site."), { status: 404 });
        json(response, 200, { id: result.rows[0].id, deactivated: true });
        return true;
      }
      const body = await readJson(request);
      const siteId = await validateSite(pool, account, body.siteId);
      const contact = readContact(body);
      const result = await pool.query(
        `UPDATE contact_urgence SET nom=$3,fonction=$4,telephone=$5,email=$6,instructions=$7,modifie_le=NOW(),modifie_par=$8::uuid
         WHERE id=$1::uuid AND site_id=$2::uuid
         RETURNING id,site_id AS "siteId",nom,fonction,telephone,email,instructions,ordre`,
        [entryMatch[1], siteId, contact.name, contact.role, contact.phone, contact.email, contact.instructions, account.id],
      );
      if (!result.rows[0]) throw Object.assign(new Error("Contact introuvable pour ce site."), { status: 404 });
      json(response, 200, { contact: result.rows[0] });
      return true;
    }
    json(response, 405, { error: "Méthode non autorisée." });
    return true;
  } catch (error) {
    console.error("Emergency contact route failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Opération sur les contacts d’urgence impossible." });
    return true;
  }
}
