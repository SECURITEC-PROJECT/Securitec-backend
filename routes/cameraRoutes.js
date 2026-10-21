import { getRequestUser } from "../utils/auth.js";
import { json, readJson } from "../utils/helpers.js";

const prefix = "/api";
const camerasPath = `${prefix}/cameras`;
const zonesPath = `${prefix}/camera-zones`;
const clean = (value, max = 255) => typeof value === "string" ? value.trim().slice(0, max) : "";

function cameraValues(body) {
  const name = clean(body.name);
  const streamUrl = clean(body.streamUrl, 2000);
  let parsed;
  try { parsed = new URL(streamUrl); } catch { /* validated below */ }
  if (!name || !parsed || !["http:", "https:", "rtsp:", "rtsps:"].includes(parsed.protocol)) {
    throw Object.assign(new Error("Indiquez un nom et une URL de flux HTTP, HTTPS ou RTSP valide."), { status: 400 });
  }
  return { name, streamUrl };
}

async function getAccount(pool, userId) {
  const result = await pool.query("SELECT role, site_id FROM utilisateur WHERE id=$1::uuid LIMIT 1", [userId]);
  if (!result.rows[0]) throw Object.assign(new Error("Utilisateur introuvable."), { status: 401 });
  return result.rows[0];
}

async function resolveSite(pool, account, requestedSiteId, optional = false) {
  if (account.site_id && account.role !== 1) {
    if (requestedSiteId && requestedSiteId !== account.site_id) throw Object.assign(new Error("Vous n’avez pas accès à ce site."), { status: 403 });
    return account.site_id;
  }
  if (!requestedSiteId && optional) return null;
  if (!requestedSiteId) throw Object.assign(new Error("Sélectionnez un site."), { status: 400 });
  const result = await pool.query("SELECT id FROM site WHERE id=$1::uuid AND actif=true LIMIT 1", [requestedSiteId]);
  if (!result.rows[0]) throw Object.assign(new Error("Site introuvable ou archivé."), { status: 404 });
  return result.rows[0].id;
}

async function resolveZone(client, siteId, body) {
  const zoneName = clean(body.zoneName);
  const accessLevel = Number(body.accessLevel ?? 0);
  if (!zoneName || !Number.isInteger(accessLevel) || accessLevel < 0 || accessLevel > 100) {
    throw Object.assign(new Error("Indiquez une zone et un niveau d’accès compris entre 0 et 100."), { status: 400 });
  }
  const found = await client.query("SELECT id FROM zone WHERE site_id=$1::uuid AND LOWER(nom)=LOWER($2) LIMIT 1", [siteId, zoneName]);
  if (found.rows[0]) return found.rows[0].id;
  const created = await client.query("INSERT INTO zone (nom,niveau_acces_requis,site_id) VALUES ($1,$2,$3::uuid) RETURNING id", [zoneName, accessLevel, siteId]);
  return created.rows[0].id;
}

const cameraSelect = `SELECT c.id,c.nom AS name,c.url_flux AS "streamUrl",c.etat AS status,
  z.id AS "zoneId",z.nom AS "zoneName",z.niveau_acces_requis AS "accessLevel",
  s.id AS "siteId",s.nom AS "siteName"
  FROM camera c JOIN zone z ON z.id=c.zone_id JOIN site s ON s.id=z.site_id`;

export async function handleCameraRoutes(request, response, pool, pathname, jwtSecret) {
  const idMatch = new RegExp(`^${prefix}/cameras/([0-9a-f-]{36})$`, "i").exec(pathname);
  if (pathname !== camerasPath && pathname !== zonesPath && !idMatch) return false;

  const user = getRequestUser(request, jwtSecret);
  if (!user) { json(response, 401, { error: "Connectez-vous pour accéder aux caméras." }); return true; }

  try {
    const account = await getAccount(pool, user.id);
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (pathname === camerasPath && request.method === "GET") {
      const siteId = await resolveSite(pool, account, url.searchParams.get("siteId"));
      const result = await pool.query(`${cameraSelect} WHERE s.id=$1::uuid ORDER BY z.nom,c.nom`, [siteId]);
      json(response, 200, { cameras: result.rows }); return true;
    }
    if (pathname === zonesPath && request.method === "GET") {
      const siteId = await resolveSite(pool, account, url.searchParams.get("siteId"));
      const result = await pool.query(`SELECT z.id,z.nom AS name,z.niveau_acces_requis AS "accessLevel",s.id AS "siteId",s.nom AS "siteName" FROM zone z JOIN site s ON s.id=z.site_id WHERE s.id=$1::uuid ORDER BY z.nom`, [siteId]);
      json(response, 200, { zones: result.rows }); return true;
    }
    if (pathname === camerasPath && request.method === "POST") {
      const body = await readJson(request);
      const values = cameraValues(body);
      const targetSite = await resolveSite(pool, account, clean(body.siteId, 36));
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const zoneId = await resolveZone(client, targetSite, body);
        const inserted = await client.query("INSERT INTO camera (nom,url_flux,etat,zone_id) VALUES ($1,$2,'EN_SERVICE',$3::uuid) RETURNING id", [values.name, values.streamUrl, zoneId]);
        const result = await client.query(`${cameraSelect} WHERE c.id=$1::uuid`, [inserted.rows[0].id]);
        await client.query("COMMIT");
        json(response, 201, { camera: result.rows[0] });
      } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
      finally { client.release(); }
      return true;
    }
    if (idMatch && request.method === "PUT") {
      const body = await readJson(request);
      const values = cameraValues(body);
      const siteId = await resolveSite(pool, account, clean(body.siteId, 36));
      const targetSite = await resolveSite(pool, account, clean(body.siteId, 36));
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const existing = await client.query("SELECT c.id FROM camera c JOIN zone z ON z.id=c.zone_id WHERE c.id=$1::uuid AND z.site_id=$2::uuid FOR UPDATE OF c", [idMatch[1], siteId]);
        if (!existing.rows[0]) throw Object.assign(new Error("Caméra introuvable sur ce site."), { status: 404 });
        const zoneId = await resolveZone(client, targetSite, body);
        await client.query("UPDATE camera SET nom=$1,url_flux=$2,zone_id=$3::uuid WHERE id=$4::uuid", [values.name, values.streamUrl, zoneId, idMatch[1]]);
        const result = await client.query(`${cameraSelect} WHERE c.id=$1::uuid`, [idMatch[1]]);
        await client.query("COMMIT");
        json(response, 200, { camera: result.rows[0] });
      } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
      finally { client.release(); }
      return true;
    }
    if (idMatch && request.method === "PATCH") {
      const body = await readJson(request);
      if (!["EN_SERVICE", "MAINTENANCE"].includes(body.status)) throw Object.assign(new Error("État de caméra invalide."), { status: 400 });
      const siteId = await resolveSite(pool, account, url.searchParams.get("siteId"), true);
      const result = await pool.query("UPDATE camera c SET etat=$1 FROM zone z WHERE c.zone_id=z.id AND c.id=$2::uuid AND ($3::uuid IS NULL OR z.site_id=$3::uuid) RETURNING c.id,c.etat AS status", [body.status, idMatch[1], siteId]);
      if (!result.rows[0]) throw Object.assign(new Error("Caméra introuvable sur ce site."), { status: 404 });
      json(response, 200, { camera: result.rows[0] }); return true;
    }
    if (idMatch && request.method === "DELETE") {
      const siteId = await resolveSite(pool, account, url.searchParams.get("siteId"), true);
      const result = await pool.query("DELETE FROM camera c USING zone z WHERE c.zone_id=z.id AND c.id=$1::uuid AND ($2::uuid IS NULL OR z.site_id=$2::uuid) RETURNING c.id", [idMatch[1], siteId]);
      if (!result.rows[0]) throw Object.assign(new Error("Caméra introuvable sur ce site."), { status: 404 });
      json(response, 200, { id: result.rows[0].id, deleted: true }); return true;
    }
    json(response, 405, { error: "Méthode non autorisée." });
    return true;
  } catch (error) {
    console.error("Camera route failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Opération sur les caméras impossible." });
    return true;
  }
}
