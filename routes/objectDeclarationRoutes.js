import { getRequestUser } from "../utils/auth.js";
import { json, readJson } from "../utils/helpers.js";
import { resolveServicePosteId } from "../utils/priseDePoste.js";

const collectionPath = "/api/object-declarations";
const entryPath = /^\/api\/object-declarations\/([0-9a-f-]+)$/i;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const text = (value, max = 500) => typeof value === "string" ? value.trim().slice(0, max) : "";

function validateData(value) {
  const data = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const normalized = {
    date: text(data.date, 10),
    entryTime: text(data.entryTime, 5),
    exitTime: text(data.exitTime, 5),
    firstName: text(data.firstName, 255),
    company: text(data.company, 255),
    vehicleNumber: text(data.vehicleNumber, 100),
    objects: text(data.objects, 4000),
    entryAgent: text(data.entryAgent, 255),
    exitAgent: text(data.exitAgent, 255),
    referenceNumber: text(data.referenceNumber, 40),
  };
  const parsedDate = datePattern.test(normalized.date) ? new Date(`${normalized.date}T00:00:00.000Z`) : null;
  if (!parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== normalized.date
    || !normalized.firstName || !normalized.company || !normalized.vehicleNumber || !normalized.objects
    || !normalized.entryTime || !normalized.exitTime || !normalized.referenceNumber
    || !timePattern.test(normalized.entryTime) || !timePattern.test(normalized.exitTime)) {
    throw Object.assign(new Error("Renseignez tous les champs de la déclaration, sauf les signatures, et vérifiez la date ainsi que les heures."), { status: 400 });
  }
  return normalized;
}

async function getAccount(pool, userId) {
  const result = await pool.query("SELECT id, site_id, role FROM utilisateur WHERE id=$1::uuid AND actif=true LIMIT 1", [userId]);
  if (!result.rows[0]) throw Object.assign(new Error("Utilisateur introuvable."), { status: 401 });
  return result.rows[0];
}

async function resolveSite(pool, account, requestedSiteId) {
  if (account.site_id && account.role !== 1) return account.site_id;
  const siteId = text(requestedSiteId, 36);
  if (!uuidPattern.test(siteId)) throw Object.assign(new Error("Sélectionnez un site."), { status: 400 });
  const result = await pool.query("SELECT id FROM site WHERE id=$1::uuid AND actif=true LIMIT 1", [siteId]);
  if (!result.rows[0]) throw Object.assign(new Error("Site introuvable ou inactif."), { status: 404 });
  return result.rows[0].id;
}

const selection = `SELECT d.id, d.donnees AS data, d.site_id AS "siteId", s.nom AS "siteName",
  d.cree_le AS "createdAt", d.modifie_le AS "updatedAt", d.service_poste_id AS "servicePosteId",
  d.deleted_at AS "deletedAt", sp.poste_id AS "posteId", po.nom AS "posteNom", sp.shift_type AS "shiftType"
  FROM declaration_objet d JOIN site s ON s.id=d.site_id
  LEFT JOIN service_poste sp ON sp.id=d.service_poste_id
  LEFT JOIN poste po ON po.id=sp.poste_id`;

export async function handleObjectDeclarationRoutes(request, response, pool, pathname, jwtSecret) {
  const entryMatch = entryPath.exec(pathname);
  if (pathname !== collectionPath && !entryMatch) return false;
  const user = getRequestUser(request, jwtSecret);
  if (!user) {
    json(response, 401, { error: "Connectez-vous pour gérer les déclarations d’objets." });
    return true;
  }

  try {
    const account = await getAccount(pool, user.id);
    if (request.method === "GET" && pathname === collectionPath) {
      const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
      let siteId = account.site_id && account.role !== 1 ? account.site_id : text(url.searchParams.get("siteId"), 36);
      if (!siteId) { json(response, 200, { entries: [] }); return true; }
      siteId = await resolveSite(pool, account, siteId);
      const result = await pool.query(
        `${selection} WHERE d.site_id=$1::uuid AND d.deleted_at IS NULL ORDER BY d.date_operation DESC, d.cree_le DESC LIMIT 1000`,
        [siteId],
      );
      json(response, 200, { entries: result.rows });
      return true;
    }

    if (request.method === "POST" && pathname === collectionPath) {
      const body = await readJson(request);
      const data = validateData(body.data);
      const clientRequestId = text(body.clientRequestId, 36);
      if (clientRequestId && !uuidPattern.test(clientRequestId)) { json(response, 400, { error: "Identifiant de demande invalide." }); return true; }
      const siteId = await resolveSite(pool, account, body.siteId);
      if (clientRequestId) {
        const replay = await pool.query(`${selection} WHERE d.client_request_id=$1::uuid AND d.site_id=$2::uuid`, [clientRequestId, siteId]);
        if (replay.rows[0]) { json(response, 200, { entry: replay.rows[0] }); return true; }
      }
      const servicePosteId = await resolveServicePosteId(pool, siteId, body.priseDePosteId, body.posteId || null);
      const duplicate = await pool.query(
        `SELECT id FROM declaration_objet
         WHERE site_id=$1::uuid AND deleted_at IS NULL AND lower(donnees->>'referenceNumber')=lower($2)
         LIMIT 1`,
        [siteId, data.referenceNumber],
      );
      if (duplicate.rows[0]) { json(response, 409, { error: "Ce numéro de fiche est déjà utilisé sur ce site." }); return true; }
      const result = await pool.query(
        `INSERT INTO declaration_objet (date_operation, donnees, site_id, utilisateur_id, service_poste_id, client_request_id)
         VALUES ($1::date, $2::jsonb, $3::uuid, $4::uuid, $5::uuid, $6::uuid)
         ON CONFLICT (client_request_id) DO NOTHING
         RETURNING id`,
        [data.date, JSON.stringify(data), siteId, account.id, servicePosteId, clientRequestId || null],
      );
      const created = result.rows[0]
        ? await pool.query(`${selection} WHERE d.id=$1::uuid`, [result.rows[0].id])
        : await pool.query(`${selection} WHERE d.client_request_id=$1::uuid AND d.site_id=$2::uuid`, [clientRequestId, siteId]);
      if (!created.rows[0]) { json(response, 409, { error: "Cette demande existe déjà pour un autre site." }); return true; }
      json(response, result.rows[0] ? 201 : 200, { entry: created.rows[0] });
      return true;
    }

    if (request.method === "PUT" && entryMatch) {
      if (!uuidPattern.test(entryMatch[1])) { json(response, 404, { error: "Déclaration introuvable." }); return true; }
      const body = await readJson(request);
      const data = validateData(body.data);
      const updateRequestId = text(body.clientRequestId, 36);
      const expectedUpdatedAt = body.expectedUpdatedAt;
      if ((updateRequestId && !uuidPattern.test(updateRequestId)) || (expectedUpdatedAt != null && (typeof expectedUpdatedAt !== "string" || !Number.isFinite(Date.parse(expectedUpdatedAt))))) {
        json(response, 400, { error: "Identifiant ou version de demande invalide." }); return true;
      }
      const siteId = await resolveSite(pool, account, body.siteId);
      if (updateRequestId) {
        const replay = await pool.query(`${selection} WHERE d.update_request_id=$1::uuid AND d.site_id=$2::uuid`, [updateRequestId, siteId]);
        if (replay.rows[0]) { json(response, 200, { entry: replay.rows[0] }); return true; }
      }
      const duplicate = await pool.query(
        `SELECT id FROM declaration_objet
         WHERE site_id=$1::uuid AND deleted_at IS NULL AND lower(donnees->>'referenceNumber')=lower($2) AND id<>$3::uuid
         LIMIT 1`,
        [siteId, data.referenceNumber, entryMatch[1]],
      );
      if (duplicate.rows[0]) { json(response, 409, { error: "Ce numéro de fiche est déjà utilisé sur ce site." }); return true; }
      const result = await pool.query(
        `UPDATE declaration_objet
         SET date_operation=$2::date, donnees=$3::jsonb, modifie_le=CURRENT_TIMESTAMP, update_request_id=$5::uuid
         WHERE id=$1::uuid AND site_id=$4::uuid AND deleted_at IS NULL
           AND ($6::timestamptz IS NULL OR date_trunc('milliseconds', modifie_le)=date_trunc('milliseconds', $6::timestamptz))
         RETURNING id`,
        [entryMatch[1], data.date, JSON.stringify(data), siteId, updateRequestId || null, expectedUpdatedAt || null],
      );
      if (!result.rows[0]) {
        const current = await pool.query("SELECT deleted_at FROM declaration_objet WHERE id=$1::uuid AND site_id=$2::uuid", [entryMatch[1], siteId]);
        json(response, current.rows[0] && !current.rows[0].deleted_at ? 409 : 404, {
          error: current.rows[0] && !current.rows[0].deleted_at ? "Cette déclaration a changé depuis son chargement." : "Déclaration introuvable sur ce site.",
        });
        return true;
      }
      const updated = await pool.query(`${selection} WHERE d.id=$1::uuid`, [entryMatch[1]]);
      json(response, 200, { entry: updated.rows[0] });
      return true;
    }

    if (request.method === "DELETE" && entryMatch) {
      if (!uuidPattern.test(entryMatch[1])) { json(response, 404, { error: "Déclaration introuvable." }); return true; }
      const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
      const siteId = await resolveSite(pool, account, url.searchParams.get("siteId"));
      const deleteRequestId = text(url.searchParams.get("clientRequestId"), 36);
      const expectedUpdatedAt = url.searchParams.get("expectedUpdatedAt");
      if ((deleteRequestId && !uuidPattern.test(deleteRequestId)) || (expectedUpdatedAt && !Number.isFinite(Date.parse(expectedUpdatedAt)))) {
        json(response, 400, { error: "Identifiant ou version de demande invalide." }); return true;
      }
      if (deleteRequestId) {
        const replay = await pool.query(
          "SELECT id FROM declaration_objet WHERE delete_request_id=$1::uuid AND site_id=$2::uuid",
          [deleteRequestId, siteId],
        );
        if (replay.rows[0]) { json(response, 200, { id: replay.rows[0].id, deleted: true }); return true; }
      }
      const result = await pool.query(
        `UPDATE declaration_objet SET deleted_at=CURRENT_TIMESTAMP, modifie_le=CURRENT_TIMESTAMP, delete_request_id=$3::uuid
         WHERE id=$1::uuid AND site_id=$2::uuid AND deleted_at IS NULL
           AND ($4::timestamptz IS NULL OR date_trunc('milliseconds', modifie_le)=date_trunc('milliseconds', $4::timestamptz))
         RETURNING id`,
        [entryMatch[1], siteId, deleteRequestId || null, expectedUpdatedAt || null],
      );
      if (!result.rows[0]) {
        const current = await pool.query("SELECT deleted_at FROM declaration_objet WHERE id=$1::uuid AND site_id=$2::uuid", [entryMatch[1], siteId]);
        json(response, current.rows[0] && !current.rows[0].deleted_at ? 409 : 404, {
          error: current.rows[0] && !current.rows[0].deleted_at ? "Cette déclaration a changé depuis son chargement." : "Déclaration introuvable sur ce site.",
        });
        return true;
      }
      json(response, 200, { id: result.rows[0].id, deleted: true });
      return true;
    }

    json(response, 405, { error: "Méthode non autorisée." });
  } catch (error) {
    console.error("Route déclarations objets:", error.code || error.name, error.message || "");
    const status = error.status || (error.code === "23505" ? 409 : 500);
    json(response, status, { error: error.status
      ? error.message
      : status === 409
        ? "Ce numéro de fiche est déjà utilisé sur ce site."
        : "Opération sur les déclarations d’objets impossible." });
  }
  return true;
}
