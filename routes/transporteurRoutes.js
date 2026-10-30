import { randomUUID } from "node:crypto";
import { getRequestUser } from "../utils/auth.js";
import { json, readJson } from "../utils/helpers.js";

const prefix = "/api/transporteurs";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clean = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";

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

function parseTransporteur(body) {
  const nomTransporteur = clean(body.nomTransporteur, 255);
  const vehicule = clean(body.vehicule, 160);
  if (!nomTransporteur) {
    throw Object.assign(new Error("Le nom du transporteur est obligatoire."), { status: 400 });
  }
  if (!vehicule) {
    throw Object.assign(new Error("Le nom du véhicule est obligatoire."), { status: 400 });
  }
  return {
    nomTransporteur,
    vehicule,
    matricule: clean(body.matricule, 40),
    telephone: clean(body.telephone, 40),
    chauffeur: clean(body.chauffeur, 255),
    observation: clean(body.observation, 2000),
  };
}

function sendError(response, error) {
  console.error("Transporteur route failed:", error.code || error.name, error.message || "");
  json(response, error.status || 500, {
    error: error.status ? error.message : "Impossible de traiter les informations du transporteur.",
  });
}

export async function handleTransporteurRoutes(request, response, pool, pathname, jwtSecret) {
  const idMatch = pathname.match(/^\/api\/transporteurs\/([0-9a-f-]+)$/i);
  if (pathname !== prefix && !idMatch) return false;
  const user = getRequestUser(request, jwtSecret);
  if (!user) {
    json(response, 401, { error: "Connectez-vous pour gérer les transporteurs." });
    return true;
  }

  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  try {
    if (request.method === "GET" && pathname === prefix) {
      const siteId = await siteForUser(pool, user.id, url.searchParams.get("siteId"));
      const result = await pool.query(
        `SELECT id, nom_transporteur AS "nomTransporteur", vehicule, matricule,
                telephone, chauffeur, observation, site_id AS "siteId", cree_le AS "createdAt"
         FROM transporteur WHERE site_id=$1::uuid
         ORDER BY nom_transporteur, vehicule, matricule NULLS LAST, cree_le DESC LIMIT 1000`,
        [siteId],
      );
      json(response, 200, { transporteurs: result.rows });
      return true;
    }

    if (request.method === "POST" && pathname === prefix) {
      const body = await readJson(request);
      const siteId = await siteForUser(pool, user.id, clean(body.siteId, 36));
      const transporteur = parseTransporteur(body);
      const result = await pool.query(
        `INSERT INTO transporteur
           (id, nom_transporteur, vehicule, matricule, telephone, chauffeur, observation, site_id, utilisateur_id)
         VALUES ($1::uuid, $2, $3, NULLIF($4, ''), NULLIF($5, ''), NULLIF($6, ''), NULLIF($7, ''), $8::uuid, $9::uuid)
         RETURNING id, nom_transporteur AS "nomTransporteur", vehicule, matricule,
                   telephone, chauffeur, observation, site_id AS "siteId", cree_le AS "createdAt"`,
        [randomUUID(), transporteur.nomTransporteur, transporteur.vehicule, transporteur.matricule,
          transporteur.telephone, transporteur.chauffeur, transporteur.observation, siteId, user.id],
      );
      json(response, 201, { transporteur: result.rows[0] });
      return true;
    }

    if (idMatch && !uuidPattern.test(idMatch[1])) {
      json(response, 404, { error: "Transporteur introuvable." });
      return true;
    }

    if (idMatch && request.method === "PUT") {
      const body = await readJson(request);
      const siteId = await siteForUser(pool, user.id, clean(body.siteId, 36));
      const transporteur = parseTransporteur(body);
      const result = await pool.query(
        `UPDATE transporteur
         SET nom_transporteur=$1, vehicule=$2, matricule=NULLIF($3, ''),
             telephone=NULLIF($4, ''), chauffeur=NULLIF($5, ''), observation=NULLIF($6, ''),
             modifie_le=CURRENT_TIMESTAMP
         WHERE id=$7::uuid AND site_id=$8::uuid
         RETURNING id, nom_transporteur AS "nomTransporteur", vehicule, matricule,
                   telephone, chauffeur, observation, site_id AS "siteId", cree_le AS "createdAt"`,
        [transporteur.nomTransporteur, transporteur.vehicule, transporteur.matricule,
          transporteur.telephone, transporteur.chauffeur, transporteur.observation, idMatch[1], siteId],
      );
      if (!result.rows[0]) throw Object.assign(new Error("Transporteur introuvable pour ce site."), { status: 404 });
      json(response, 200, { transporteur: result.rows[0] });
      return true;
    }

    if (idMatch && request.method === "DELETE") {
      const siteId = await siteForUser(pool, user.id, url.searchParams.get("siteId"));
      const result = await pool.query(
        "DELETE FROM transporteur WHERE id=$1::uuid AND site_id=$2::uuid RETURNING id",
        [idMatch[1], siteId],
      );
      if (!result.rows[0]) throw Object.assign(new Error("Transporteur introuvable pour ce site."), { status: 404 });
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
