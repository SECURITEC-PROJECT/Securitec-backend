import { json, readJson } from "../utils/helpers.js";
import { resolveServicePosteId } from "../utils/priseDePoste.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const cleanText = (value, max = 255) => typeof value === "string" ? value.trim().slice(0, max) : "";

const validDate = (value) => {
  if (typeof value !== "string" || !datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

async function getAccount(pool, userId) {
  const result = await pool.query(
    "SELECT id, site_id, role FROM utilisateur WHERE id = $1::uuid LIMIT 1",
    [userId],
  );
  if (!result.rows[0]) throw Object.assign(new Error("Utilisateur introuvable."), { status: 401 });
  return result.rows[0];
}

async function resolveSite(pool, account, requestedSiteId) {
  if (account.site_id && account.role !== 1) return account.site_id;
  const siteId = cleanText(requestedSiteId, 36);
  if (!uuidPattern.test(siteId)) throw Object.assign(new Error("Sélectionnez un site de travail."), { status: 400 });
  const result = await pool.query(
    "SELECT id FROM site WHERE id = $1::uuid AND actif = true LIMIT 1",
    [siteId],
  );
  if (!result.rows[0]) throw Object.assign(new Error("Site de travail introuvable ou archivé."), { status: 404 });
  return result.rows[0].id;
}

async function querySiteForRead(pool, account, request) {
  if (account.site_id && account.role !== 1) return account.site_id;
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const siteId = cleanText(url.searchParams.get("siteId"), 36);
  if (!uuidPattern.test(siteId)) return null;
  const result = await pool.query(
    "SELECT id FROM site WHERE id = $1::uuid AND actif = true LIMIT 1",
    [siteId],
  );
  return result.rows[0]?.id || null;
}

export async function listCourrierMovements(request, response, pool, userId) {
  try {
    const account = await getAccount(pool, userId);
    const siteId = await querySiteForRead(pool, account, request);
    if (!siteId) return json(response, 200, { entries: [] });
    const result = await pool.query(
      `SELECT m.id, m.date_operation::text AS date,
              to_char(m.heure_entree, 'HH24:MI') AS "heureEntree",
              m.prenom, m.designation, m.nombre,
              to_char(m.heure_sortie, 'HH24:MI') AS "heureSortie",
              m.annule_le AS "annuleLe",
              m.modifie_le AS "updatedAt",
              m.site_id AS "siteId", s.nom AS "siteName", m.service_poste_id AS "servicePosteId"
       FROM mouvement_courrier m
       JOIN site s ON s.id = m.site_id
       WHERE m.site_id = $1::uuid
       ORDER BY m.date_operation DESC, m.heure_entree DESC
       LIMIT 1000`,
      [siteId],
    );
    json(response, 200, { entries: result.rows });
  } catch (error) {
    console.error("GET /courrier-movements failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible de charger le registre courrier." });
  }
}

export async function createCourrierMovement(request, response, pool, userId) {
  let client;
  try {
    const body = await readJson(request);
    const date = cleanText(body.date, 10);
    const heureEntree = cleanText(body.heureEntree, 5);
    const prenom = cleanText(body.prenom, 255);
    const designation = cleanText(body.designation, 20000);
    const nombre = Number(body.nombre);
    const clientRequestId = cleanText(body.clientRequestId, 36);
    if (!validDate(date) || !timePattern.test(heureEntree) || !prenom || !designation
      || !Number.isSafeInteger(nombre) || nombre < 1 || nombre > 1000000 || (clientRequestId && !uuidPattern.test(clientRequestId))) {
      return json(response, 400, { error: "Vérifiez la date, l’heure d’entrée, le prénom, la désignation et le nombre (entier positif)." });
    }

    client = await pool.connect();
    await client.query("BEGIN");
    const account = await getAccount(client, userId);
    const siteId = await resolveSite(client, account, body.siteId);
    if (clientRequestId) {
      const replay = await client.query(
        `SELECT m.id, date_operation::text AS date, to_char(heure_entree, 'HH24:MI') AS "heureEntree",
                prenom, designation, nombre, to_char(heure_sortie, 'HH24:MI') AS "heureSortie",
                annule_le AS "annuleLe", modifie_le AS "updatedAt", m.site_id AS "siteId",
                service_poste_id AS "servicePosteId", s.nom AS "siteName"
         FROM mouvement_courrier m JOIN site s ON s.id=m.site_id
         WHERE m.client_request_id=$1::uuid AND m.site_id=$2::uuid`,
        [clientRequestId, siteId],
      );
      if (replay.rows[0]) {
        await client.query("COMMIT");
        return json(response, 200, { entry: replay.rows[0] });
      }
    }
    const servicePosteId = await resolveServicePosteId(client, siteId, body.priseDePosteId, body.posteId || null);
    const result = await client.query(
      `INSERT INTO mouvement_courrier
         (date_operation, heure_entree, prenom, designation, nombre, site_id, utilisateur_id, service_poste_id, client_request_id)
       VALUES ($1::date, $2::time, $3, $4, $5, $6::uuid, $7::uuid, $8::uuid, $9::uuid)
       ON CONFLICT (client_request_id) DO NOTHING
       RETURNING id, date_operation::text AS date, to_char(heure_entree, 'HH24:MI') AS "heureEntree",
                 prenom, designation, nombre, to_char(heure_sortie, 'HH24:MI') AS "heureSortie", modifie_le AS "updatedAt",
                 site_id AS "siteId", service_poste_id AS "servicePosteId"`,
      [date, heureEntree, prenom, designation, nombre, siteId, userId, servicePosteId, clientRequestId || null],
    );
    if (!result.rows[0] && clientRequestId) {
      const replay = await client.query(
        `SELECT m.id, date_operation::text AS date, to_char(heure_entree, 'HH24:MI') AS "heureEntree",
                prenom, designation, nombre, to_char(heure_sortie, 'HH24:MI') AS "heureSortie",
                annule_le AS "annuleLe", modifie_le AS "updatedAt", site_id AS "siteId",
                service_poste_id AS "servicePosteId", s.nom AS "siteName"
         FROM mouvement_courrier m JOIN site s ON s.id=m.site_id
         WHERE m.client_request_id=$1::uuid AND m.site_id=$2::uuid`,
        [clientRequestId, siteId],
      );
      if (!replay.rows[0]) {
        await client.query("ROLLBACK");
        return json(response, 409, { error: "Cette demande existe déjà pour un autre site." });
      }
      await client.query("COMMIT");
      return json(response, 200, { entry: replay.rows[0] });
    }
    const site = await client.query("SELECT nom AS \"siteName\" FROM site WHERE id = $1::uuid", [siteId]);
    await client.query("COMMIT");
    json(response, 201, { entry: { ...result.rows[0], siteName: site.rows[0]?.siteName } });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("POST /courrier-movements failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible d’enregistrer le mouvement courrier." });
  } finally {
    client?.release();
  }
}

export async function exitCourrierMovement(request, response, pool, userId, entryId) {
  try {
    if (!uuidPattern.test(entryId)) return json(response, 404, { error: "Mouvement courrier introuvable." });
    const body = await readJson(request);
    const clientRequestId = cleanText(body.clientRequestId, 36);
    const expectedUpdatedAt = body.expectedUpdatedAt;
    if ((clientRequestId && !uuidPattern.test(clientRequestId)) || (expectedUpdatedAt != null && (typeof expectedUpdatedAt !== "string" || !Number.isFinite(Date.parse(expectedUpdatedAt))))) {
      return json(response, 400, { error: "Identifiant ou version de demande invalide." });
    }
    const account = await getAccount(pool, userId);
    const siteId = account.site_id && account.role !== 1
      ? account.site_id
      : await querySiteForRead(pool, account, request);
    if (!siteId) return json(response, 400, { error: "Sélectionnez un site pour enregistrer la sortie." });
    if (clientRequestId) {
      const replay = await pool.query(
        `SELECT id, to_char(heure_sortie, 'HH24:MI') AS "heureSortie", modifie_le AS "updatedAt"
         FROM mouvement_courrier WHERE exit_request_id=$1::uuid AND site_id=$2::uuid`,
        [clientRequestId, siteId],
      );
      if (replay.rows[0]) return json(response, 200, { entry: replay.rows[0] });
    }
    const result = await pool.query(
      `UPDATE mouvement_courrier
       SET heure_sortie = timezone('Indian/Antananarivo', CURRENT_TIMESTAMP)::time(0),modifie_par=$3::uuid,
           modifie_le=CURRENT_TIMESTAMP, exit_request_id=$4::uuid
       WHERE id = $1::uuid AND site_id = $2::uuid AND heure_sortie IS NULL AND annule_le IS NULL
         AND ($5::timestamptz IS NULL OR date_trunc('milliseconds', modifie_le)=date_trunc('milliseconds', $5::timestamptz))
       RETURNING id, to_char(heure_sortie, 'HH24:MI') AS "heureSortie", modifie_le AS "updatedAt"`,
      [entryId, siteId, userId, clientRequestId || null, expectedUpdatedAt || null],
    );
    if (!result.rows[0]) {
      const current = await pool.query(
        "SELECT heure_sortie, annule_le FROM mouvement_courrier WHERE id=$1::uuid AND site_id=$2::uuid",
        [entryId, siteId],
      );
      return json(response, current.rows[0] ? 409 : 404, {
        error: current.rows[0] ? "Ce mouvement a changé ou sa sortie est déjà enregistrée." : "Mouvement introuvable sur ce site.",
      });
    }
    json(response, 200, { entry: result.rows[0] });
  } catch (error) {
    console.error("PATCH /courrier-movements/:id/exit failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible d’enregistrer la sortie." });
  }
}

export async function updateCourrierMovement(request, response, pool, userId, entryId) {
  let client;
  try {
    if (!uuidPattern.test(entryId)) return json(response, 404, { error: "Mouvement courrier introuvable." });
    const body = await readJson(request);
    const clientRequestId = cleanText(body.clientRequestId, 36);
    const expectedUpdatedAt = body.expectedUpdatedAt;
    if ((clientRequestId && !uuidPattern.test(clientRequestId)) || (expectedUpdatedAt != null && (typeof expectedUpdatedAt !== "string" || !Number.isFinite(Date.parse(expectedUpdatedAt))))) {
      return json(response, 400, { error: "Identifiant ou version de demande invalide." });
    }
    const date = cleanText(body.date, 10);
    const heureEntree = cleanText(body.heureEntree, 5);
    const prenom = cleanText(body.prenom, 255);
    const designation = cleanText(body.designation, 20000);
    const nombre = Number(body.nombre);
    if (!validDate(date) || !timePattern.test(heureEntree) || !prenom || !designation
      || !Number.isSafeInteger(nombre) || nombre < 1 || nombre > 1000000) {
      return json(response, 400, { error: "Vérifiez la date, l’heure d’entrée, le prénom, la désignation et le nombre (entier positif)." });
    }

    client = await pool.connect();
    await client.query("BEGIN");
    const account = await getAccount(client, userId);
    const siteId = await resolveSite(client, account, body.siteId);
    if (clientRequestId) {
      const replay = await client.query(
        `SELECT m.id, date_operation::text AS date, to_char(heure_entree, 'HH24:MI') AS "heureEntree",
                prenom, designation, nombre, to_char(heure_sortie, 'HH24:MI') AS "heureSortie",
                annule_le AS "annuleLe", modifie_le AS "updatedAt", site_id AS "siteId",
                s.nom AS "siteName", service_poste_id AS "servicePosteId"
         FROM mouvement_courrier m JOIN site s ON s.id=m.site_id
         WHERE update_request_id=$1::uuid AND m.site_id=$2::uuid`,
        [clientRequestId, siteId],
      );
      if (replay.rows[0]) {
        await client.query("COMMIT");
        return json(response, 200, { entry: replay.rows[0] });
      }
    }
    const result = await client.query(
      `UPDATE mouvement_courrier
       SET date_operation = $2::date, heure_entree = $3::time, prenom = $4, designation = $5, nombre = $6,
           modifie_par=$8::uuid, modifie_le=CURRENT_TIMESTAMP, update_request_id=$9::uuid
       WHERE id = $1::uuid AND site_id = $7::uuid AND annule_le IS NULL
         AND ($10::timestamptz IS NULL OR date_trunc('milliseconds', modifie_le)=date_trunc('milliseconds', $10::timestamptz))
       RETURNING id, date_operation::text AS date, to_char(heure_entree, 'HH24:MI') AS "heureEntree",
                 prenom, designation, nombre, to_char(heure_sortie, 'HH24:MI') AS "heureSortie",
                 annule_le AS "annuleLe", modifie_le AS "updatedAt", site_id AS "siteId", service_poste_id AS "servicePosteId"`,
      [entryId, date, heureEntree, prenom, designation, nombre, siteId, userId, clientRequestId || null, expectedUpdatedAt || null],
    );
    if (!result.rows[0]) {
      const current = await client.query(
        "SELECT id FROM mouvement_courrier WHERE id=$1::uuid AND site_id=$2::uuid AND annule_le IS NULL",
        [entryId, siteId],
      );
      await client.query("ROLLBACK");
      return json(response, current.rows[0] ? 409 : 404, {
        error: current.rows[0] ? "Ce mouvement a changé depuis son chargement. Rechargez-le avant de le modifier." : "Mouvement courrier introuvable sur ce site.",
      });
    }
    const site = await client.query("SELECT nom AS \"siteName\" FROM site WHERE id = $1::uuid", [siteId]);
    await client.query("COMMIT");
    json(response, 200, { entry: { ...result.rows[0], siteName: site.rows[0]?.siteName } });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("PUT /courrier-movements/:id failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible de modifier le mouvement courrier." });
  } finally {
    client?.release();
  }
}

export async function deleteCourrierMovement(request, response, pool, userId, entryId) {
  try {
    if (!uuidPattern.test(entryId)) return json(response, 404, { error: "Mouvement courrier introuvable." });
    const account = await getAccount(pool, userId);
    const siteId = await querySiteForRead(pool, account, request);
    if (!siteId) return json(response, 400, { error: "Sélectionnez un site pour supprimer le mouvement." });
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const clientRequestId = cleanText(url.searchParams.get("clientRequestId"), 36);
    const expectedUpdatedAt = url.searchParams.get("expectedUpdatedAt");
    if ((clientRequestId && !uuidPattern.test(clientRequestId)) || (expectedUpdatedAt && !Number.isFinite(Date.parse(expectedUpdatedAt)))) {
      return json(response, 400, { error: "Identifiant ou version de demande invalide." });
    }
    if (clientRequestId) {
      const replay = await pool.query(
        "SELECT id, annule_le AS \"annuleLe\" FROM mouvement_courrier WHERE delete_request_id=$1::uuid AND site_id=$2::uuid",
        [clientRequestId, siteId],
      );
      if (replay.rows[0]) return json(response, 200, { id: replay.rows[0].id, deleted: false, cancelled: true, annuleLe: replay.rows[0].annuleLe });
    }
    const result = await pool.query(
      `UPDATE mouvement_courrier
       SET annule_le=CURRENT_TIMESTAMP,annule_par=$3::uuid,modifie_par=$3::uuid,
           modifie_le=CURRENT_TIMESTAMP,delete_request_id=$4::uuid
       WHERE id = $1::uuid AND site_id = $2::uuid AND annule_le IS NULL
         AND ($5::timestamptz IS NULL OR date_trunc('milliseconds', modifie_le)=date_trunc('milliseconds', $5::timestamptz))
       RETURNING id,annule_le AS "annuleLe"`,
      [entryId, siteId, userId, clientRequestId || null, expectedUpdatedAt || null],
    );
    if (!result.rows[0]) {
      const current = await pool.query(
        "SELECT annule_le FROM mouvement_courrier WHERE id=$1::uuid AND site_id=$2::uuid",
        [entryId, siteId],
      );
      return json(response, current.rows[0] ? 409 : 404, {
        error: current.rows[0] ? "Ce mouvement a changé ou est déjà annulé." : "Mouvement courrier introuvable sur ce site.",
      });
    }
    json(response, 200, { id: result.rows[0].id, deleted: false, cancelled: true, annuleLe: result.rows[0].annuleLe });
  } catch (error) {
    console.error("DELETE /courrier-movements/:id failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Impossible de supprimer le mouvement courrier." });
  }
}
