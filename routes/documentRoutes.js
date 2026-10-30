import { randomUUID } from "node:crypto";
import { getRequestUser } from "../utils/auth.js";
import { json } from "../utils/helpers.js";

const prefix = "/api/documents";
const maxBytes = 15 * 1024 * 1024;
const allowed = new Map([
  ["jpg", "image/jpeg"], ["jpeg", "image/jpeg"], ["png", "image/png"], ["webp", "image/webp"],
  ["pdf", "application/pdf"], ["doc", "application/msword"],
  ["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ["xls", "application/vnd.ms-excel"],
  ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ["csv", "text/csv"], ["txt", "text/plain"],
  ["ppt", "application/vnd.ms-powerpoint"],
  ["pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  ["odt", "application/vnd.oasis.opendocument.text"],
  ["ods", "application/vnd.oasis.opendocument.spreadsheet"],
]);

async function readFile(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error("Le fichier dépasse la limite de 15 Mo."), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function resolveSite(pool, userId, requestedSiteId) {
  const account = await pool.query("SELECT id, role, site_id FROM utilisateur WHERE id=$1::uuid LIMIT 1", [userId]);
  if (!account.rows[0]) throw Object.assign(new Error("Utilisateur introuvable."), { status: 401 });
  if (account.rows[0].role !== 1 && !account.rows[0].site_id) throw Object.assign(new Error("Aucun site n’est associé à votre compte."), { status: 403 });
  const siteId = account.rows[0].role !== 1 ? account.rows[0].site_id : requestedSiteId;
  if (!siteId) throw Object.assign(new Error("Sélectionnez un site."), { status: 400 });
  const site = await pool.query("SELECT id FROM site WHERE id=$1::uuid AND actif=true LIMIT 1", [siteId]);
  if (!site.rows[0]) throw Object.assign(new Error("Site introuvable ou archivé."), { status: 404 });
  return site.rows[0].id;
}

function fail(response, error) {
  json(response, error.status || 500, { error: error.status ? error.message : "Opération sur les documents impossible." });
}

export async function handleDocumentRoutes(request, response, pool, pathname, jwtSecret) {
  const idMatch = pathname.match(/^\/api\/documents\/([0-9a-f-]+)$/i);
  if (pathname !== prefix && !idMatch) return false;
  const user = getRequestUser(request, jwtSecret);
  if (!user) { json(response, 401, { error: "Connectez-vous pour gérer les documents." }); return true; }
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  try {
    if (request.method === "GET" && pathname === prefix) {
      const siteId = await resolveSite(pool, user.id, url.searchParams.get("siteId"));
      const result = await pool.query(
        `SELECT id, nom AS name, extension, mime_type AS "mimeType", taille AS size,
                categorie AS category, cree_le AS "createdAt"
         FROM document_site WHERE site_id=$1::uuid ORDER BY cree_le DESC LIMIT 500`, [siteId]);
      json(response, 200, { documents: result.rows }); return true;
    }
    if (request.method === "POST" && pathname === prefix) {
      const siteId = await resolveSite(pool, user.id, request.headers["x-site-id"]);
      const encodedName = request.headers["x-file-name"];
      let name;
      try { name = decodeURIComponent(String(encodedName || "")); } catch { name = ""; }
      name = name.split(/[\\/]/).pop().trim().slice(0, 240);
      const extension = name.split(".").pop()?.toLowerCase() || "";
      const mimeType = allowed.get(extension);
      if (!name || !mimeType) throw Object.assign(new Error("Format de fichier non autorisé."), { status: 400 });
      const category = String(request.headers["x-file-category"] || "Autre").slice(0, 80);
      const content = await readFile(request);
      if (!content.length) throw Object.assign(new Error("Le fichier est vide."), { status: 400 });
      const id = randomUUID();
      await pool.query(
        `INSERT INTO document_site (id, site_id, utilisateur_id, nom, extension, mime_type, taille, categorie, contenu)
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9)`,
        [id, siteId, user.id, name, extension, mimeType, content.length, category, content]);
      json(response, 201, { document: { id, name, extension, mimeType, size: content.length, category, createdAt: new Date().toISOString() } }); return true;
    }
    if (idMatch && request.method === "GET") {
      const result = await pool.query(
        `SELECT d.nom, d.mime_type, d.contenu FROM document_site d
         JOIN utilisateur u ON u.id=$2::uuid
         WHERE d.id=$1::uuid AND (u.role=1 OR d.site_id=u.site_id) LIMIT 1`, [idMatch[1], user.id]);
      const doc = result.rows[0];
      if (!doc) throw Object.assign(new Error("Document introuvable ou accès refusé."), { status: 404 });
      const safeName = encodeURIComponent(doc.nom).replaceAll("'", "%27");
      response.writeHead(200, { "Content-Type": doc.mime_type, "Content-Length": doc.contenu.length,
        "Content-Disposition": `attachment; filename*=UTF-8''${safeName}`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      response.end(doc.contenu); return true;
    }
    if (idMatch && request.method === "DELETE") {
      const result = await pool.query(
        `DELETE FROM document_site d USING utilisateur u
         WHERE d.id=$1::uuid AND u.id=$2::uuid AND (u.role=1 OR d.site_id=u.site_id) RETURNING d.id`, [idMatch[1], user.id]);
      if (!result.rows[0]) throw Object.assign(new Error("Document introuvable ou accès refusé."), { status: 404 });
      json(response, 200, { id: result.rows[0].id, deleted: true }); return true;
    }
    json(response, 405, { error: "Méthode non autorisée." }); return true;
  } catch (error) { fail(response, error); return true; }
}
