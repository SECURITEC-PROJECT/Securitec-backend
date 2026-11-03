import { getRequestUser } from "../utils/auth.js";
import { json, readJson } from "../utils/helpers.js";
import { resolveServicePosteId } from "../utils/priseDePoste.js";

const definitions = {
  "/api/bicycle-movements": { table: "mouvement_velo", kind: "vélo" },
  "/api/motorcycle-movements": { table: "mouvement_moto", kind: "moto" },
};
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const text = (value, max = 5000) => typeof value === "string" ? value.trim().slice(0, max) : "";

function validDate(value) {
  if (!datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

async function getAccount(pool, userId) {
  const result = await pool.query(
    `SELECT id,site_id AS "siteId",role
     FROM utilisateur WHERE id=$1::uuid AND actif=true LIMIT 1`,
    [userId],
  );
  if (!result.rows[0]) throw Object.assign(new Error("Utilisateur introuvable."), { status: 401 });
  return result.rows[0];
}

async function resolveSite(pool, account, requestedSiteId) {
  const siteId = account.siteId && account.role !== 1 ? account.siteId : text(requestedSiteId, 36);
  if (!uuidPattern.test(siteId || "")) throw Object.assign(new Error("Sélectionnez un site."), { status: 400 });
  const result = await pool.query("SELECT id FROM site WHERE id=$1::uuid AND actif=true LIMIT 1", [siteId]);
  if (!result.rows[0]) throw Object.assign(new Error("Site introuvable ou archivé."), { status: 404 });
  return result.rows[0].id;
}

function readValues(body, kind) {
  const date = text(body.date, 10);
  const heureEntree = text(body.heureEntree, 5);
  if (!validDate(date) || !timePattern.test(heureEntree)) {
    throw Object.assign(new Error("La date et l’heure d’entrée sont obligatoires."), { status: 400 });
  }
  if (kind === "vélo") {
    const matricule = text(body.matricule, 50);
    const marqueVelo = text(body.marqueVelo, 255);
    if (!matricule || !marqueVelo) {
      throw Object.assign(new Error("Le matricule et la marque du vélo sont obligatoires."), { status: 400 });
    }
    return { date, heureEntree, matricule, marqueVelo };
  }
  const moto = text(body.moto, 255);
  const observation = text(body.observation);
  if (!moto) {
    throw Object.assign(new Error("La moto est obligatoire."), { status: 400 });
  }
  return { date, heureEntree, moto, observation };
}

async function resolveEmployee(pool, matricule, siteId, includeInactive = false) {
  const result = await pool.query(
    `SELECT prenom,role AS section
     FROM employe
     WHERE UPPER(BTRIM(matricule))=UPPER($1) AND site_id=$2::uuid
       AND (actif=true OR $3::boolean=true)
     LIMIT 1`,
    [matricule, siteId, includeInactive],
  );
  if (!result.rows[0]) {
    throw Object.assign(new Error("Sélectionnez un employé actif de ce site."), { status: 400 });
  }
  return result.rows[0];
}

const bikeColumns = `id,date_operation::text AS date,to_char(heure_entree,'HH24:MI') AS "heureEntree",
  matricule,prenom,section,marque_velo AS "marqueVelo",service_poste_id AS "servicePosteId",
  to_char(heure_sortie,'HH24:MI') AS "heureSortie",site_id AS "siteId",annule_le AS "annuleLe",
  modifie_le AS "updatedAt"`;
const motorcycleColumns = `id,date_operation::text AS date,to_char(heure_entree,'HH24:MI') AS "heureEntree",
  moto,observation,to_char(heure_sortie,'HH24:MI') AS "heureSortie",site_id AS "siteId",
  service_poste_id AS "servicePosteId",annule_le AS "annuleLe",modifie_le AS "updatedAt"`;

export async function handleMovementRoutes(request, response, pool, pathname, jwtSecret) {
  const definitionEntry = Object.entries(definitions).find(([base]) =>
    pathname === base || pathname.startsWith(`${base}/`),
  );
  if (!definitionEntry) return false;
  const [basePath, definition] = definitionEntry;
  const subPath = pathname === basePath ? "" : pathname.slice(basePath.length + 1);
  const exitMatch = /^([0-9a-f-]{36})\/sortie$/i.exec(subPath);
  const entryId = subPath && !exitMatch ? subPath : "";
  const isEntryRoute = !subPath || Boolean(exitMatch) || Boolean(entryId);

  if (!isEntryRoute) return false;
  try {
    const user = getRequestUser(request, jwtSecret);
    if (!user) throw Object.assign(new Error("Connectez-vous pour gérer les mouvements."), { status: 401 });
    const account = await getAccount(pool, user.id);
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const columns = definition.kind === "vélo" ? bikeColumns : motorcycleColumns;

    if (request.method === "GET" && pathname === basePath) {
      const siteId = await resolveSite(pool, account, url.searchParams.get("siteId"));
      const result = await pool.query(
        `SELECT ${columns} FROM ${definition.table}
         WHERE site_id=$1::uuid
         ORDER BY date_operation DESC,heure_entree DESC,cree_le DESC LIMIT 1000`,
        [siteId],
      );
      json(response, 200, { entries: result.rows });
      return true;
    }

    if ((request.method === "POST" && pathname === basePath) || (request.method === "PUT" && entryId)) {
      if (entryId && !uuidPattern.test(entryId)) {
        json(response, 404, { error: "Mouvement introuvable." });
        return true;
      }
      const body = await readJson(request);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw Object.assign(new Error("Données du mouvement invalides."), { status: 400 });
      }
      const values = readValues(body, definition.kind);
      const requestId = text(body.clientRequestId, 36);
      const expectedUpdatedAt = body.expectedUpdatedAt;
      if ((requestId && !uuidPattern.test(requestId)) || (expectedUpdatedAt != null && (typeof expectedUpdatedAt !== "string" || !Number.isFinite(Date.parse(expectedUpdatedAt))))) {
        throw Object.assign(new Error("Identifiant ou version de demande invalide."), { status: 400 });
      }
      const siteId = await resolveSite(pool, account, body.siteId || url.searchParams.get("siteId"));
      if (request.method === "POST" && requestId) {
        const replay = await pool.query(`SELECT ${columns} FROM ${definition.table} WHERE client_request_id=$1::uuid AND site_id=$2::uuid`, [requestId, siteId]);
        if (replay.rows[0]) { json(response, 200, { entry: replay.rows[0] }); return true; }
      }
      if (request.method === "PUT" && requestId) {
        const replay = await pool.query(`SELECT ${columns} FROM ${definition.table} WHERE update_request_id=$1::uuid AND site_id=$2::uuid`, [requestId, siteId]);
        if (replay.rows[0]) { json(response, 200, { entry: replay.rows[0] }); return true; }
      }
      const servicePosteId = body.priseDePosteId
        ? await resolveServicePosteId(pool, siteId, body.priseDePosteId)
        : null;

      if (definition.kind === "vélo") {
        const employee = await resolveEmployee(pool, values.matricule, siteId, request.method === "PUT");
        const params = [
          values.date, values.heureEntree, values.matricule, employee.prenom, employee.section,
          values.marqueVelo, siteId, account.id, servicePosteId,
        ];
        if (request.method === "POST") {
          const result = await pool.query(
            `INSERT INTO mouvement_velo
              (date_operation,heure_entree,matricule,prenom,section,marque_velo,site_id,utilisateur_id,service_poste_id,client_request_id)
             VALUES ($1::date,$2::time,$3,$4,$5,$6,$7::uuid,$8::uuid,$9::uuid,$10::uuid)
             ON CONFLICT (client_request_id) DO NOTHING RETURNING id`,
            [...params, requestId || null],
          );
          const created = result.rows[0]
            ? await pool.query(`SELECT ${bikeColumns} FROM mouvement_velo WHERE id=$1::uuid`, [result.rows[0].id])
            : await pool.query(`SELECT ${bikeColumns} FROM mouvement_velo WHERE client_request_id=$1::uuid AND site_id=$2::uuid`, [requestId, siteId]);
          if (!created.rows[0]) { json(response, 409, { error: "Cette demande existe déjà pour un autre site." }); return true; }
          json(response, result.rows[0] ? 201 : 200, { entry: created.rows[0] });
          return true;
        }
        const result = await pool.query(
          `UPDATE mouvement_velo SET date_operation=$2::date,heure_entree=$3::time,
             matricule=$4,prenom=$5,section=$6,marque_velo=$7,modifie_par=$9::uuid,
             service_poste_id=COALESCE($10::uuid,service_poste_id),modifie_le=CURRENT_TIMESTAMP,update_request_id=$11::uuid
           WHERE id=$1::uuid AND site_id=$8::uuid AND annule_le IS NULL
             AND ($12::timestamptz IS NULL OR date_trunc('milliseconds',modifie_le)=date_trunc('milliseconds',$12::timestamptz))
           RETURNING ${bikeColumns}`,
          [entryId, ...params.slice(0, 6), siteId, account.id, servicePosteId, requestId || null, expectedUpdatedAt || null],
        );
        if (!result.rows[0]) {
          const current = await pool.query("SELECT id FROM mouvement_velo WHERE id=$1::uuid AND site_id=$2::uuid AND annule_le IS NULL", [entryId, siteId]);
          throw Object.assign(new Error(current.rows[0] ? "Ce mouvement a changé depuis son chargement." : "Mouvement introuvable sur ce site."), { status: current.rows[0] ? 409 : 404 });
        }
        json(response, 200, { entry: result.rows[0] });
        return true;
      }

      if (request.method === "POST") {
        const result = await pool.query(
          `INSERT INTO mouvement_moto
            (date_operation,heure_entree,moto,observation,site_id,utilisateur_id,service_poste_id,client_request_id)
           VALUES ($1::date,$2::time,$3,$4,$5::uuid,$6::uuid,$7::uuid,$8::uuid)
           ON CONFLICT (client_request_id) DO NOTHING RETURNING id`,
          [values.date, values.heureEntree, values.moto, values.observation, siteId, account.id, servicePosteId, requestId || null],
        );
        const created = result.rows[0]
          ? await pool.query(`SELECT ${motorcycleColumns} FROM mouvement_moto WHERE id=$1::uuid`, [result.rows[0].id])
          : await pool.query(`SELECT ${motorcycleColumns} FROM mouvement_moto WHERE client_request_id=$1::uuid AND site_id=$2::uuid`, [requestId, siteId]);
        if (!created.rows[0]) { json(response, 409, { error: "Cette demande existe déjà pour un autre site." }); return true; }
        json(response, result.rows[0] ? 201 : 200, { entry: created.rows[0] });
        return true;
      }
      const result = await pool.query(
        `UPDATE mouvement_moto SET date_operation=$2::date,heure_entree=$3::time,moto=$4,observation=$5,modifie_par=$7::uuid,
           service_poste_id=COALESCE($8::uuid,service_poste_id),modifie_le=CURRENT_TIMESTAMP,update_request_id=$9::uuid
         WHERE id=$1::uuid AND site_id=$6::uuid AND annule_le IS NULL
           AND ($10::timestamptz IS NULL OR date_trunc('milliseconds',modifie_le)=date_trunc('milliseconds',$10::timestamptz))
         RETURNING ${motorcycleColumns}`,
        [entryId, values.date, values.heureEntree, values.moto, values.observation, siteId, account.id, servicePosteId, requestId || null, expectedUpdatedAt || null],
      );
      if (!result.rows[0]) {
        const current = await pool.query("SELECT id FROM mouvement_moto WHERE id=$1::uuid AND site_id=$2::uuid AND annule_le IS NULL", [entryId, siteId]);
        throw Object.assign(new Error(current.rows[0] ? "Ce mouvement a changé depuis son chargement." : "Mouvement introuvable sur ce site."), { status: current.rows[0] ? 409 : 404 });
      }
      json(response, 200, { entry: result.rows[0] });
      return true;
    }

    if (request.method === "PATCH" && exitMatch) {
      const id = exitMatch[1];
      if (!uuidPattern.test(id)) {
        json(response, 404, { error: "Mouvement introuvable." });
        return true;
      }
      const body = await readJson(request);
      const requestId = text(body.clientRequestId, 36);
      const expectedUpdatedAt = body.expectedUpdatedAt;
      if ((requestId && !uuidPattern.test(requestId)) || (expectedUpdatedAt != null && (typeof expectedUpdatedAt !== "string" || !Number.isFinite(Date.parse(expectedUpdatedAt))))) {
        json(response, 400, { error: "Identifiant ou version de demande invalide." });
        return true;
      }
      const siteId = await resolveSite(pool, account, url.searchParams.get("siteId"));
      const table = definition.table;
      if (requestId) {
        const replay = await pool.query(`SELECT ${columns} FROM ${table} WHERE exit_request_id=$1::uuid AND site_id=$2::uuid`, [requestId, siteId]);
        if (replay.rows[0]) { json(response, 200, { entry: replay.rows[0] }); return true; }
      }
      const result = await pool.query(
        `UPDATE ${table} SET heure_sortie=CURRENT_TIME,modifie_par=$3::uuid,modifie_le=CURRENT_TIMESTAMP,exit_request_id=$4::uuid
         WHERE id=$1::uuid AND site_id=$2::uuid AND heure_sortie IS NULL AND annule_le IS NULL
           AND ($5::timestamptz IS NULL OR date_trunc('milliseconds',modifie_le)=date_trunc('milliseconds',$5::timestamptz))
         RETURNING ${columns}`,
        [id, siteId, account.id, requestId || null, expectedUpdatedAt || null],
      );
      if (!result.rows[0]) {
        const existing = await pool.query(
          `SELECT heure_sortie,annule_le FROM ${table} WHERE id=$1::uuid AND site_id=$2::uuid`,
          [id, siteId],
        );
        if (!existing.rows[0]) throw Object.assign(new Error("Mouvement introuvable sur ce site."), { status: 404 });
        throw Object.assign(new Error(existing.rows[0].annule_le ? "Ce mouvement est annulé." : "Ce mouvement a changé ou sa sortie est déjà enregistrée."), { status: 409 });
      }
      json(response, 200, { entry: result.rows[0] });
      return true;
    }

    if (request.method === "DELETE" && entryId) {
      if (!uuidPattern.test(entryId)) {
        json(response, 404, { error: "Mouvement introuvable." });
        return true;
      }
      const siteId = await resolveSite(pool, account, url.searchParams.get("siteId"));
      const requestId = text(url.searchParams.get("clientRequestId"), 36);
      const expectedUpdatedAt = url.searchParams.get("expectedUpdatedAt");
      if ((requestId && !uuidPattern.test(requestId)) || (expectedUpdatedAt && !Number.isFinite(Date.parse(expectedUpdatedAt)))) {
        json(response, 400, { error: "Identifiant ou version de demande invalide." });
        return true;
      }
      if (requestId) {
        const replay = await pool.query(`SELECT id,annule_le AS "annuleLe" FROM ${definition.table} WHERE delete_request_id=$1::uuid AND site_id=$2::uuid`, [requestId, siteId]);
        if (replay.rows[0]) { json(response, 200, { id: replay.rows[0].id, deleted: false, cancelled: true, annuleLe: replay.rows[0].annuleLe }); return true; }
      }
      const result = await pool.query(
        `UPDATE ${definition.table} SET annule_le=CURRENT_TIMESTAMP,annule_par=$3::uuid,modifie_par=$3::uuid,
           modifie_le=CURRENT_TIMESTAMP,delete_request_id=$4::uuid
         WHERE id=$1::uuid AND site_id=$2::uuid AND annule_le IS NULL
           AND ($5::timestamptz IS NULL OR date_trunc('milliseconds',modifie_le)=date_trunc('milliseconds',$5::timestamptz))
         RETURNING id,annule_le AS "annuleLe"`,
        [entryId, siteId, account.id, requestId || null, expectedUpdatedAt || null],
      );
      if (!result.rows[0]) {
        const current = await pool.query(`SELECT annule_le FROM ${definition.table} WHERE id=$1::uuid AND site_id=$2::uuid`, [entryId, siteId]);
        throw Object.assign(new Error(current.rows[0] ? "Ce mouvement a changé ou est déjà annulé." : "Mouvement introuvable sur ce site."), { status: current.rows[0] ? 409 : 404 });
      }
      json(response, 200, { id: result.rows[0].id, deleted: false, cancelled: true, annuleLe: result.rows[0].annuleLe });
      return true;
    }

    json(response, 405, { error: "Méthode non autorisée." });
    return true;
  } catch (error) {
    console.error(`Movement ${definition.kind} failed:`, error.code || error.name, error.message || "");
    json(response, error.status || 500, {
      error: error.status ? error.message : "Opération sur le registre impossible.",
    });
    return true;
  }
}
