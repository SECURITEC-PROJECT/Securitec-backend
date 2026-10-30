import { getRequestUser } from "../utils/auth.js";
import { json, readJson } from "../utils/helpers.js";

const tableByEntity = {
  mouvement_velo: "mouvement_velo",
  mouvement_moto: "mouvement_moto",
  mouvement_courrier: "mouvement_courrier",
  passage_vehicule: "passage_vehicule",
  controle_alcoolemie: "controle_alcoolemie",
  passation: "passation",
  materiel_sous_traitant: "materiel_sous_traitant",
  materiel_star: "materiel_star",
};
const linkPath = /^\/api\/register-attachments\/([0-9a-f-]{36})$/i;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function accountFor(pool, userId) {
  const result = await pool.query("SELECT id,role,site_id FROM utilisateur WHERE id=$1::uuid AND actif=true LIMIT 1", [userId]);
  if (!result.rows[0]) throw Object.assign(new Error("Utilisateur introuvable."), { status: 401 });
  return result.rows[0];
}

async function recordSite(pool, entity, recordId) {
  const table = tableByEntity[entity];
  if (!table || !uuidPattern.test(recordId)) throw Object.assign(new Error("Registre ou enregistrement invalide."), { status: 400 });
  const result = await pool.query(`SELECT site_id FROM ${table} WHERE id=$1::uuid LIMIT 1`, [recordId]);
  if (!result.rows[0]?.site_id) throw Object.assign(new Error("Enregistrement introuvable."), { status: 404 });
  return result.rows[0].site_id;
}

export async function handleRegisterAttachmentRoutes(request, response, pool, pathname, jwtSecret) {
  if (pathname !== "/api/register-attachments" && !linkPath.test(pathname)) return false;
  const user = getRequestUser(request, jwtSecret);
  if (!user) { json(response, 401, { error: "Connectez-vous pour gérer les pièces jointes." }); return true; }
  try {
    const account = await accountFor(pool, user.id);
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const match = linkPath.exec(pathname);
    if (request.method === "GET" && pathname === "/api/register-attachments") {
      const entity = url.searchParams.get("entity") || "";
      const recordId = url.searchParams.get("recordId") || "";
      const siteId = await recordSite(pool, entity, recordId);
      if (account.role !== 1 && account.site_id !== siteId) throw Object.assign(new Error("Accès refusé."), { status: 403 });
      const result = await pool.query(
        `SELECT l.id,d.id AS "documentId",d.nom AS name,d.extension,d.mime_type AS "mimeType",
                d.taille AS size,d.cree_le AS "uploadedAt",l.cree_le AS "linkedAt"
         FROM document_registre l JOIN document_site d ON d.id=l.document_id
         WHERE l.entite=$1 AND l.entite_id=$2::uuid AND l.site_id=$3::uuid
         ORDER BY l.cree_le DESC LIMIT 50`, [entity, recordId, siteId]);
      json(response, 200, { attachments: result.rows });
      return true;
    }
    if (request.method === "POST" && pathname === "/api/register-attachments") {
      const body = await readJson(request);
      const entity = typeof body.entity === "string" ? body.entity : "";
      const recordId = typeof body.recordId === "string" ? body.recordId : "";
      const documentId = typeof body.documentId === "string" ? body.documentId : "";
      const siteId = await recordSite(pool, entity, recordId);
      if (!uuidPattern.test(documentId)) throw Object.assign(new Error("Sélectionnez un document valide."), { status: 400 });
      if (account.role !== 1 && account.site_id !== siteId) throw Object.assign(new Error("Accès refusé."), { status: 403 });
      const document = await pool.query("SELECT id FROM document_site WHERE id=$1::uuid AND site_id=$2::uuid", [documentId, siteId]);
      if (!document.rows[0]) throw Object.assign(new Error("Le document n’appartient pas à ce site."), { status: 400 });
      const result = await pool.query(
        `INSERT INTO document_registre (entite,entite_id,site_id,document_id,utilisateur_id)
         VALUES ($1,$2::uuid,$3::uuid,$4::uuid,$5::uuid)
         ON CONFLICT (entite,entite_id,document_id) DO NOTHING
         RETURNING id`, [entity, recordId, siteId, documentId, user.id]);
      json(response, 201, { linked: true, id: result.rows[0]?.id || null });
      return true;
    }
    if (match && request.method === "DELETE") {
      const result = await pool.query(
        `DELETE FROM document_registre l USING utilisateur u
         WHERE l.id=$1::uuid AND u.id=$2::uuid
           AND (u.role=1 OR l.site_id=u.site_id) RETURNING l.id`, [match[1], user.id]);
      if (!result.rows[0]) throw Object.assign(new Error("Pièce jointe introuvable ou accès refusé."), { status: 404 });
      json(response, 200, { id: result.rows[0].id, unlinked: true });
      return true;
    }
    json(response, 405, { error: "Méthode non autorisée." });
  } catch (error) {
    json(response, error.status || 500, { error: error.status ? error.message : "Opération sur les pièces jointes impossible." });
  }
  return true;
}
