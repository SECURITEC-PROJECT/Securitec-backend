import { randomUUID } from "node:crypto";
import { getRequestUser } from "../utils/auth.js";
import { json, readJson } from "../utils/helpers.js";

const prefix = "/api/chauffeurs";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const clean = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";

function validDate(value) {
  if (!datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

async function siteForUser(pool, userId, requestedSiteId) {
  const account = await pool.query(
    "SELECT role, site_id FROM utilisateur WHERE id=$1::uuid LIMIT 1",
    [userId],
  );
  if (!account.rows[0]) throw Object.assign(new Error("Utilisateur introuvable."), { status: 401 });
  if (account.rows[0].role !== 1 && !account.rows[0].site_id) {
    throw Object.assign(new Error("Aucun site n’est associé à votre compte."), { status: 403 });
  }
  const siteId = account.rows[0].role === 1 ? requestedSiteId : account.rows[0].site_id;
  if (!siteId || !uuidPattern.test(siteId)) {
    throw Object.assign(new Error("Sélectionnez un site."), { status: 400 });
  }
  const site = await pool.query(
    "SELECT id FROM site WHERE id=$1::uuid AND actif=true LIMIT 1",
    [siteId],
  );
  if (!site.rows[0]) throw Object.assign(new Error("Site introuvable ou archivé."), { status: 404 });
  return site.rows[0].id;
}

function parseDriver(body) {
  const nomPrenom = clean(body.nomPrenom, 255);
  const telephone = clean(body.telephone, 40);
  const cin = clean(body.cin, 80);
  const numeroPermis = clean(body.numeroPermis, 100);
  const expirationPermis = clean(body.expirationPermis, 10);
  const vehicule = clean(body.vehicule, 160);
  const matricule = clean(body.matricule, 40);
  if (!nomPrenom) throw Object.assign(new Error("Le nom et prénom du chauffeur sont obligatoires."), { status: 400 });
  if (expirationPermis && !validDate(expirationPermis)) {
    throw Object.assign(new Error("La date d’expiration du permis est invalide."), { status: 400 });
  }
  return { nomPrenom, telephone, cin, numeroPermis, expirationPermis, vehicule, matricule };
}

function sendError(response, error) {
  console.error("Chauffeur route failed:", error.code || error.name, error.message || "");
  json(response, error.status || 500, {
    error: error.status ? error.message : "Impossible de traiter les informations du chauffeur.",
  });
}

export async function handleChauffeurRoutes(request, response, pool, pathname, jwtSecret) {
  const idMatch = pathname.match(/^\/api\/chauffeurs\/([0-9a-f-]+)$/i);
  if (pathname !== prefix && !idMatch) return false;
  const user = getRequestUser(request, jwtSecret);
  if (!user) {
    json(response, 401, { error: "Connectez-vous pour gérer les chauffeurs." });
    return true;
  }

  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  try {
    if (request.method === "GET" && pathname === prefix) {
      const siteId = await siteForUser(pool, user.id, url.searchParams.get("siteId"));
      const result = await pool.query(
        `SELECT id, nom_prenom AS "nomPrenom", telephone, cin,
                numero_permis AS "numeroPermis",
                to_char(expiration_permis, 'YYYY-MM-DD') AS "expirationPermis",
                vehicule, matricule, site_id AS "siteId", cree_le AS "createdAt"
         FROM chauffeur WHERE site_id=$1::uuid
         ORDER BY nom_prenom, cree_le DESC LIMIT 1000`,
        [siteId],
      );
      json(response, 200, { chauffeurs: result.rows });
      return true;
    }

    if (request.method === "POST" && pathname === prefix) {
      const body = await readJson(request);
      const siteId = await siteForUser(pool, user.id, clean(body.siteId, 36));
      const driver = parseDriver(body);
      const id = randomUUID();
      const result = await pool.query(
        `INSERT INTO chauffeur
           (id, nom_prenom, telephone, cin, numero_permis, expiration_permis,
            vehicule, matricule, site_id, utilisateur_id)
         VALUES ($1::uuid, $2, NULLIF($3, ''), NULLIF($4, ''), NULLIF($5, ''),
                 NULLIF($6, '')::date, NULLIF($7, ''), NULLIF($8, ''),
                 $9::uuid, $10::uuid)
         RETURNING id, nom_prenom AS "nomPrenom", telephone, cin,
                   numero_permis AS "numeroPermis",
                   to_char(expiration_permis, 'YYYY-MM-DD') AS "expirationPermis",
                   vehicule, matricule, site_id AS "siteId", cree_le AS "createdAt"`,
        [id, driver.nomPrenom, driver.telephone, driver.cin, driver.numeroPermis,
          driver.expirationPermis, driver.vehicule, driver.matricule, siteId, user.id],
      );
      json(response, 201, { chauffeur: result.rows[0] });
      return true;
    }

    if (idMatch && !uuidPattern.test(idMatch[1])) {
      json(response, 404, { error: "Chauffeur introuvable." });
      return true;
    }

    if (idMatch && request.method === "PUT") {
      const body = await readJson(request);
      const siteId = await siteForUser(pool, user.id, clean(body.siteId, 36));
      const driver = parseDriver(body);
      const result = await pool.query(
        `UPDATE chauffeur
         SET nom_prenom=$1, telephone=NULLIF($2, ''), cin=NULLIF($3, ''),
             numero_permis=NULLIF($4, ''), expiration_permis=NULLIF($5, '')::date,
             vehicule=NULLIF($6, ''), matricule=NULLIF($7, ''),
             modifie_le=CURRENT_TIMESTAMP
         WHERE id=$8::uuid AND site_id=$9::uuid
         RETURNING id, nom_prenom AS "nomPrenom", telephone, cin,
                   numero_permis AS "numeroPermis",
                   to_char(expiration_permis, 'YYYY-MM-DD') AS "expirationPermis",
                   vehicule, matricule, site_id AS "siteId", cree_le AS "createdAt"`,
        [driver.nomPrenom, driver.telephone, driver.cin, driver.numeroPermis,
          driver.expirationPermis, driver.vehicule, driver.matricule, idMatch[1], siteId],
      );
      if (!result.rows[0]) throw Object.assign(new Error("Chauffeur introuvable pour ce site."), { status: 404 });
      json(response, 200, { chauffeur: result.rows[0] });
      return true;
    }

    if (idMatch && request.method === "DELETE") {
      const siteId = await siteForUser(pool, user.id, url.searchParams.get("siteId"));
      const result = await pool.query(
        "DELETE FROM chauffeur WHERE id=$1::uuid AND site_id=$2::uuid RETURNING id",
        [idMatch[1], siteId],
      );
      if (!result.rows[0]) throw Object.assign(new Error("Chauffeur introuvable pour ce site."), { status: 404 });
      json(response, 200, { id: result.rows[0].id, deleted: true });
      return true;
    }

    json(response, 405, { error: "Méthode non autorisée." });
    return true;
  } catch (error) {
    sendError(response, error);
    return true;
  }
}
