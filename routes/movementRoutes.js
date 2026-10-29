import { getRequestUser } from "../utils/auth.js";
import { json, readJson } from "../utils/helpers.js";

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
  matricule,prenom,section,marque_velo AS "marqueVelo",
  to_char(heure_sortie,'HH24:MI') AS "heureSortie",site_id AS "siteId"`;
const motorcycleColumns = `id,date_operation::text AS date,to_char(heure_entree,'HH24:MI') AS "heureEntree",
  moto,observation,to_char(heure_sortie,'HH24:MI') AS "heureSortie",site_id AS "siteId"`;

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
      const siteId = await resolveSite(pool, account, body.siteId || url.searchParams.get("siteId"));

      if (definition.kind === "vélo") {
        const employee = await resolveEmployee(pool, values.matricule, siteId, request.method === "PUT");
        const params = [
          values.date, values.heureEntree, values.matricule, employee.prenom, employee.section,
          values.marqueVelo, siteId, account.id,
        ];
        if (request.method === "POST") {
          const result = await pool.query(
            `INSERT INTO mouvement_velo
              (date_operation,heure_entree,matricule,prenom,section,marque_velo,site_id,utilisateur_id)
             VALUES ($1::date,$2::time,$3,$4,$5,$6,$7::uuid,$8::uuid)
             RETURNING ${bikeColumns}`,
            params,
          );
          json(response, 201, { entry: result.rows[0] });
          return true;
        }
        const result = await pool.query(
          `UPDATE mouvement_velo SET date_operation=$2::date,heure_entree=$3::time,
             matricule=$4,prenom=$5,section=$6,marque_velo=$7
           WHERE id=$1::uuid AND site_id=$8::uuid
           RETURNING ${bikeColumns}`,
          [entryId, ...params.slice(0, 6), siteId],
        );
        if (!result.rows[0]) throw Object.assign(new Error("Mouvement introuvable sur ce site."), { status: 404 });
        json(response, 200, { entry: result.rows[0] });
        return true;
      }

      if (request.method === "POST") {
        const result = await pool.query(
          `INSERT INTO mouvement_moto
            (date_operation,heure_entree,moto,observation,site_id,utilisateur_id)
           VALUES ($1::date,$2::time,$3,$4,$5::uuid,$6::uuid)
           RETURNING ${motorcycleColumns}`,
          [values.date, values.heureEntree, values.moto, values.observation, siteId, account.id],
        );
        json(response, 201, { entry: result.rows[0] });
        return true;
      }
      const result = await pool.query(
        `UPDATE mouvement_moto SET date_operation=$2::date,heure_entree=$3::time,moto=$4,observation=$5
         WHERE id=$1::uuid AND site_id=$6::uuid
         RETURNING ${motorcycleColumns}`,
        [entryId, values.date, values.heureEntree, values.moto, values.observation, siteId],
      );
      if (!result.rows[0]) throw Object.assign(new Error("Mouvement introuvable sur ce site."), { status: 404 });
      json(response, 200, { entry: result.rows[0] });
      return true;
    }

    if (request.method === "PATCH" && exitMatch) {
      const id = exitMatch[1];
      if (!uuidPattern.test(id)) {
        json(response, 404, { error: "Mouvement introuvable." });
        return true;
      }
      const siteId = await resolveSite(pool, account, url.searchParams.get("siteId"));
      const table = definition.table;
      const result = await pool.query(
        `UPDATE ${table} SET heure_sortie=CURRENT_TIME
         WHERE id=$1::uuid AND site_id=$2::uuid AND heure_sortie IS NULL
         RETURNING ${columns}`,
        [id, siteId],
      );
      if (!result.rows[0]) {
        const existing = await pool.query(
          `SELECT heure_sortie FROM ${table} WHERE id=$1::uuid AND site_id=$2::uuid`,
          [id, siteId],
        );
        if (!existing.rows[0]) throw Object.assign(new Error("Mouvement introuvable sur ce site."), { status: 404 });
        throw Object.assign(new Error("La sortie de ce mouvement est déjà enregistrée."), { status: 409 });
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
      const result = await pool.query(
        `DELETE FROM ${definition.table} WHERE id=$1::uuid AND site_id=$2::uuid RETURNING id`,
        [entryId, siteId],
      );
      if (!result.rows[0]) throw Object.assign(new Error("Mouvement introuvable sur ce site."), { status: 404 });
      json(response, 200, { id: result.rows[0].id, deleted: true });
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
