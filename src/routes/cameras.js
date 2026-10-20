import { apiPrefix, getPool, json, readJson, requestUser, text } from "../server-support.js";

function cameraValues(body) {
  const name = text(body.name, 255);
  const streamUrl = text(body.streamUrl, 2000);
  let parsed;
  try { parsed = new URL(streamUrl); } catch { /* validated below */ }
  if (!name || !streamUrl || !parsed || !["http:", "https:", "rtsp:", "rtsps:"].includes(parsed.protocol)) {
    throw Object.assign(new Error("Indiquez un nom et une URL de flux HTTP, HTTPS ou RTSP valide."), { status: 400 });
  }
  return { name, streamUrl };
}

async function resolveZone(client, account, body) {
  const siteId = account.siteId || text(body.siteId, 64);
  const zoneName = text(body.zoneName, 255);
  const accessLevel = Number.isInteger(Number(body.accessLevel)) ? Number(body.accessLevel) : 0;
  if (!siteId || !zoneName || accessLevel < 0 || accessLevel > 100) {
    throw Object.assign(new Error("Sélectionnez un site et indiquez la zone de surveillance."), { status: 400 });
  }
  const found = await client.query("SELECT id FROM zone WHERE site_id=$1 AND LOWER(nom)=LOWER($2) LIMIT 1", [siteId, zoneName]);
  if (found.rows[0]) return found.rows[0].id;
  const created = await client.query(
    "INSERT INTO zone (nom, niveau_acces_requis, site_id) VALUES ($1,$2,$3) RETURNING id",
    [zoneName, accessLevel, siteId],
  );
  return created.rows[0].id;
}

export async function handleCameras(request, response, pathname) {
  const account = requestUser(request, response);
  if (!account) return;
  let pool;
  try { pool = await getPool(); }
  catch (error) { json(response, 503, { error: error.message || "Base de données inaccessible." }); return; }

  const query = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`).searchParams;
  const siteId = account.siteId || query.get("siteId") || null;
  const idMatch = new RegExp(`^${apiPrefix}/cameras/([0-9a-f-]+)$`, "i").exec(pathname);

  try {
    if (pathname === `${apiPrefix}/cameras` && request.method === "GET") {
      const result = await pool.query(
        `SELECT c.id, c.nom AS name, c.url_flux AS "streamUrl", c.etat AS status,
                z.id AS "zoneId", z.nom AS "zoneName", z.niveau_acces_requis AS "accessLevel",
                s.id AS "siteId", s.nom AS "siteName"
         FROM camera c JOIN zone z ON z.id=c.zone_id JOIN site s ON s.id=z.site_id
         WHERE ($1::uuid IS NULL OR s.id=$1::uuid)
         ORDER BY s.nom, z.nom, c.nom`,
        [siteId],
      );
      json(response, 200, { cameras: result.rows }); return;
    }

    if (pathname === `${apiPrefix}/camera-zones` && request.method === "GET") {
      const result = await pool.query(
        `SELECT z.id, z.nom AS name, z.niveau_acces_requis AS "accessLevel", s.id AS "siteId", s.nom AS "siteName"
         FROM zone z JOIN site s ON s.id=z.site_id
         WHERE ($1::uuid IS NULL OR s.id=$1::uuid) ORDER BY s.nom,z.nom`, [siteId],
      );
      json(response, 200, { zones: result.rows }); return;
    }

    if (pathname === `${apiPrefix}/cameras` && request.method === "POST") {
      const body = await readJson(request);
      const values = cameraValues(body);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const zoneId = await resolveZone(client, account, body);
        const result = await client.query(
          `INSERT INTO camera (nom,url_flux,etat,zone_id) VALUES ($1,$2,$3,$4)
           RETURNING id,nom AS name,url_flux AS "streamUrl",etat AS status,zone_id AS "zoneId"`,
          [values.name, values.streamUrl, "EN_SERVICE", zoneId],
        );
        const zone = await client.query("SELECT z.nom AS \"zoneName\",s.id AS \"siteId\",s.nom AS \"siteName\" FROM zone z JOIN site s ON s.id=z.site_id WHERE z.id=$1", [zoneId]);
        await client.query("COMMIT");
        json(response, 201, { camera: { ...result.rows[0], ...zone.rows[0] } });
      } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
      finally { client.release(); }
      return;
    }

    if (request.method === "PUT" && idMatch) {
      const body = await readJson(request);
      const values = cameraValues(body);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const existing = await client.query(
          `SELECT c.id FROM camera c JOIN zone z ON z.id=c.zone_id
           WHERE c.id=$1 AND ($2::uuid IS NULL OR z.site_id=$2::uuid) FOR UPDATE OF c`, [idMatch[1], siteId],
        );
        if (!existing.rows[0]) throw Object.assign(new Error("Caméra introuvable sur ce site."), { status: 404 });
        const zoneId = await resolveZone(client, account, body);
        const result = await client.query(
          `UPDATE camera SET nom=$1,url_flux=$2,zone_id=$3 WHERE id=$4
           RETURNING id,nom AS name,url_flux AS "streamUrl",etat AS status,zone_id AS "zoneId"`,
          [values.name, values.streamUrl, zoneId, idMatch[1]],
        );
        const zone = await client.query("SELECT z.nom AS \"zoneName\",s.id AS \"siteId\",s.nom AS \"siteName\" FROM zone z JOIN site s ON s.id=z.site_id WHERE z.id=$1", [zoneId]);
        await client.query("COMMIT");
        json(response, 200, { camera: { ...result.rows[0], ...zone.rows[0] } });
      } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
      finally { client.release(); }
      return;
    }

    if (request.method === "PATCH" && idMatch) {
      const body = await readJson(request);
      const status = body.status === "MAINTENANCE" ? "MAINTENANCE" : body.status === "EN_SERVICE" ? "EN_SERVICE" : null;
      if (!status) { json(response, 400, { error: "État de caméra invalide." }); return; }
      const result = await pool.query(
        `UPDATE camera c SET etat=$1 FROM zone z WHERE c.zone_id=z.id AND c.id=$2
         AND ($3::uuid IS NULL OR z.site_id=$3::uuid) RETURNING c.id,c.etat AS status`, [status,idMatch[1],siteId],
      );
      if (!result.rows[0]) { json(response,404,{error:"Caméra introuvable sur ce site."}); return; }
      json(response,200,{camera:result.rows[0]}); return;
    }

    if (request.method === "DELETE" && idMatch) {
      const result = await pool.query(
        `DELETE FROM camera c USING zone z WHERE c.zone_id=z.id AND c.id=$1
         AND ($2::uuid IS NULL OR z.site_id=$2::uuid) RETURNING c.id`, [idMatch[1],siteId],
      );
      if (!result.rows[0]) { json(response,404,{error:"Caméra introuvable sur ce site."}); return; }
      json(response,200,{id:result.rows[0].id,deleted:true}); return;
    }

    json(response,405,{error:"Méthode non autorisée."});
  } catch (error) {
    json(response,error.status || 500,{error:error.message || "Opération sur les caméras impossible."});
  }
}
