import { getRequestUser } from "../utils/auth.js";
import { json, readJson } from "../utils/helpers.js";

const routePath = "/api/aps-movements";
const configurationPath = `${routePath}/posts`;
const eventsPath = `${routePath}/events`;
const eventRecordPattern = /^\/api\/aps-movements\/events\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const handoversPath = `${routePath}/service-handovers`;
const handoverRecordPattern = /^\/api\/aps-movements\/service-handovers\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const services = new Set(["jour", "nuit"]);

function validDate(value) {
  if (!datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

async function getAccount(pool, userId) {
  const result = await pool.query(
    "SELECT id,nom,role,site_id AS \"siteId\" FROM utilisateur WHERE id=$1::uuid AND actif=true LIMIT 1",
    [userId],
  );
  return result.rows[0] || null;
}

async function resolveSite(pool, account, requestedSiteId) {
  const siteId = account.siteId && account.role !== 1 ? account.siteId : requestedSiteId;
  if (typeof siteId !== "string" || !uuidPattern.test(siteId)) {
    throw Object.assign(new Error("Sélectionnez un site."), { status: 400 });
  }
  const result = await pool.query(
    "SELECT id FROM site WHERE id=$1::uuid AND actif=true LIMIT 1",
    [siteId],
  );
  if (!result.rows[0]) throw Object.assign(new Error("Site introuvable ou inactif."), { status: 404 });
  return result.rows[0].id;
}

function readService(value) {
  if (typeof value !== "string" || !services.has(value)) {
    throw Object.assign(new Error("Service invalide."), { status: 400 });
  }
  return value;
}

function validateEvent(body) {
  const date = typeof body?.date === "string" ? body.date : "";
  const heureEntree = typeof body?.heureEntree === "string" ? body.heureEntree : "";
  const mouvement = typeof body?.mouvement === "string" ? body.mouvement.trim() : "";
  const observation = typeof body?.observation === "string" ? body.observation.trim() : "";
  const heureSortie = typeof body?.heureSortie === "string" ? body.heureSortie : "";
  if (!validDate(date) || !timePattern.test(heureEntree)
    || (heureSortie && !timePattern.test(heureSortie))
    || !mouvement || mouvement.length > 500 || observation.length > 1000) {
    throw Object.assign(new Error("La date, l’heure d’entrée et le mouvement sont obligatoires et doivent être valides."), { status: 400 });
  }
  return { date, heureEntree, mouvement, observation, heureSortie };
}

function validateHandover(body) {
  const date = typeof body?.date === "string" ? body.date : "";
  const textFields = [
    ["materiel", 3000],
    ["clesRendus", 5000],
    ["clesNonRendus", 5000],
    ["etatDesLieux", 5000],
    ["consigne", 5000],
    ["evenement", 5000],
    ["remarque", 5000],
  ];
  const entry = { date };
  for (const [field, maxLength] of textFields) {
    const value = body?.[field] ?? "";
    if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
      throw Object.assign(new Error(`Le champ ${field} est obligatoire et ne doit pas dépasser ${maxLength} caractères.`), { status: 400 });
    }
    entry[field] = value.trim();
  }
  for (const field of ["chaineEst", "chaineOuest"]) {
    const value = body?.[field] ?? "";
    if (typeof value !== "string" || !value.trim() || value.length > 100) {
      throw Object.assign(new Error(`Le champ ${field} est obligatoire et ne doit pas dépasser 100 caractères.`), { status: 400 });
    }
    entry[field] = value.trim();
  }
  for (const field of ["cpDescendantMatricule", "cpMontantMatricule"]) {
    const value = body?.[field];
    if (typeof value !== "string" || !value.trim() || value.trim().length > 50) {
      throw Object.assign(new Error("Le matricule des deux CP est obligatoire et ne doit pas dépasser 50 caractères."), { status: 400 });
    }
    entry[field] = value.trim();
  }
  if (!validDate(date)) {
    throw Object.assign(new Error("Date invalide."), { status: 400 });
  }
  return entry;
}

async function validateHandoverSignatories(pool, siteId, entry) {
  const result = await pool.query(
    `SELECT UPPER(BTRIM(matricule)) AS matricule
     FROM employe
     WHERE site_id=$1::uuid AND actif=true
       AND UPPER(BTRIM(matricule)) IN (UPPER($2),UPPER($3))`,
    [siteId, entry.cpDescendantMatricule, entry.cpMontantMatricule],
  );
  const found = new Set(result.rows.map((row) => row.matricule));
  if (!found.has(entry.cpDescendantMatricule.toLocaleUpperCase())
    || !found.has(entry.cpMontantMatricule.toLocaleUpperCase())) {
    throw Object.assign(new Error("Les matricules des deux CP doivent correspondre à des employés actifs du site sélectionné."), { status: 400 });
  }
}

const handoverSelect = `SELECT h.id,TO_CHAR(h.date_operation,'YYYY-MM-DD') AS date,h.materiel,
  h.chaine_est AS "chaineEst",h.chaine_ouest AS "chaineOuest",
  h.cles_rendus AS "clesRendus",h.cles_non_rendus AS "clesNonRendus",
  h.etat_des_lieux AS "etatDesLieux",h.consigne,h.evenement,h.remarque,
  h.cp_descendant_matricule AS "cpDescendantMatricule",
  h.cp_montant_matricule AS "cpMontantMatricule",
  u.nom AS controleur,h.site_id AS "siteId",
  COALESCE((SELECT json_agg(link.service_poste_id ORDER BY link.service_poste_id)
    FROM passation_aps_service_poste link WHERE link.passation_aps_id=h.id),'[]'::json) AS "servicePosteIds"
  FROM mouvement_aps_passation h JOIN utilisateur u ON u.id=h.utilisateur_id`;

function validatePostes(rawPostes) {
  if (!Array.isArray(rawPostes) || rawPostes.length > 100) {
    throw Object.assign(new Error("Un maximum de 100 postes peut être enregistré."), { status: 400 });
  }
  const names = new Set();
  return rawPostes.map((poste) => {
    const name = typeof poste?.name === "string"
      ? poste.name.trim().replace(/\s+/g, " ").toLocaleUpperCase("fr")
      : "";
    const count = Number(poste?.count);
    if (!name || name.length > 80 || names.has(name)
      || !Number.isInteger(count) || count < 1 || count > 30) {
      throw Object.assign(new Error("Chaque poste doit avoir un nom unique et un effectif entre 1 et 30."), { status: 400 });
    }
    names.add(name);
    return { name, count };
  });
}

function validateData(rawData, postes) {
  if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) {
    throw Object.assign(new Error("Les données du module APS sont invalides."), { status: 400 });
  }
  const normalized = {};
  for (const poste of postes) {
    const rows = rawData[poste.name];
    if (!Array.isArray(rows) || rows.length !== poste.count) {
      throw Object.assign(new Error(`Les lignes du poste « ${poste.name} » ne correspondent pas à son effectif.`), { status: 400 });
    }
    normalized[poste.name] = rows.map((row) => {
      if (!row || typeof row !== "object" || Array.isArray(row)
        || (row.nom != null && typeof row.nom !== "string")
        || (row.matricule != null && typeof row.matricule !== "string")) {
        throw Object.assign(new Error("Chaque agent doit contenir un nom et un matricule valides."), { status: 400 });
      }
      return {
        nom: (row.nom || "").trim().slice(0, 100),
        matricule: (row.matricule || "").trim().slice(0, 50),
      };
    });
  }
  return normalized;
}

async function saveConfiguration(client, siteId, postes, userId) {
  await client.query(
    `INSERT INTO configuration_postes_mouvement_aps (site_id,postes,utilisateur_id,updated_at)
     VALUES ($1::uuid,$2::jsonb,$3::uuid,NOW())
     ON CONFLICT (site_id)
     DO UPDATE SET postes=EXCLUDED.postes,utilisateur_id=EXCLUDED.utilisateur_id,updated_at=NOW()`,
    [siteId, JSON.stringify(postes), userId],
  );
}

async function replaceApsServiceLinks(client, table, recordColumn, recordId, siteId, date, shiftType = null) {
  await client.query(`DELETE FROM ${table} WHERE ${recordColumn}=$1::uuid`, [recordId]);
  await client.query(
    `INSERT INTO ${table} (${recordColumn},service_poste_id)
     SELECT $1::uuid,sp.id FROM service_poste sp
     WHERE sp.site_id=$2::uuid
       AND sp.started_at::date<=$3::date
       AND COALESCE(sp.ended_at::date,CURRENT_DATE)>=$3::date
       AND ($4::shift_agent IS NULL OR sp.shift_type=$4::shift_agent)
     ON CONFLICT DO NOTHING`,
    [recordId, siteId, date, shiftType],
  );
}

export async function handleApsMovementRoutes(request, response, pool, pathname, jwtSecret) {
  const eventRecordMatch = pathname.match(eventRecordPattern);
  const handoverRecordMatch = pathname.match(handoverRecordPattern);
  if (pathname !== routePath && pathname !== configurationPath && pathname !== eventsPath
    && !eventRecordMatch && pathname !== handoversPath && !handoverRecordMatch) return false;
  const user = getRequestUser(request, jwtSecret);
  if (!user) {
    json(response, 401, { error: "Connectez-vous pour accéder aux mouvements APS." });
    return true;
  }

  try {
    const account = await getAccount(pool, user.id);
    if (!account) throw Object.assign(new Error("Utilisateur introuvable."), { status: 401 });
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (pathname === handoversPath && request.method === "GET") {
      const date = url.searchParams.get("date") || "";
      if (!validDate(date)) throw Object.assign(new Error("Date invalide."), { status: 400 });
      const siteId = await resolveSite(pool, account, url.searchParams.get("siteId"));
      const result = await pool.query(
        `${handoverSelect}
         WHERE h.site_id=$1::uuid AND h.date_operation=$2::date
         ORDER BY h.cree_le DESC,h.id`,
        [siteId, date],
      );
      json(response, 200, { entries: result.rows });
      return true;
    }

    if (pathname === handoversPath && request.method === "POST") {
      const body = await readJson(request);
      const entry = validateHandover(body);
      const siteId = await resolveSite(pool, account, body?.siteId);
      await validateHandoverSignatories(pool, siteId, entry);
      const result = await pool.query(
        `INSERT INTO mouvement_aps_passation
           (site_id,date_operation,materiel,chaine_est,chaine_ouest,cles_rendus,cles_non_rendus,
            etat_des_lieux,consigne,evenement,remarque,cp_descendant_matricule,
            cp_montant_matricule,utilisateur_id)
         VALUES ($1::uuid,$2::date,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::uuid)
         RETURNING id`,
        [siteId, entry.date, entry.materiel, entry.chaineEst, entry.chaineOuest, entry.clesRendus,
          entry.clesNonRendus, entry.etatDesLieux, entry.consigne, entry.evenement, entry.remarque,
          entry.cpDescendantMatricule, entry.cpMontantMatricule, account.id],
      );
      await replaceApsServiceLinks(pool, "passation_aps_service_poste", "passation_aps_id", result.rows[0].id, siteId, entry.date);
      const saved = await pool.query(`${handoverSelect} WHERE h.id=$1::uuid`, [result.rows[0].id]);
      json(response, 201, { entry: saved.rows[0] });
      return true;
    }

    if (handoverRecordMatch && request.method === "PUT") {
      const body = await readJson(request);
      const entry = validateHandover(body);
      const siteId = await resolveSite(pool, account, body?.siteId);
      await validateHandoverSignatories(pool, siteId, entry);
      const result = await pool.query(
        `UPDATE mouvement_aps_passation
         SET date_operation=$3::date,materiel=$4,chaine_est=$5,chaine_ouest=$6,cles_rendus=$7,
             cles_non_rendus=$8,etat_des_lieux=$9,consigne=$10,evenement=$11,remarque=$12,
             cp_descendant_matricule=$13,cp_montant_matricule=$14,
             utilisateur_id=$15::uuid,updated_at=NOW()
         WHERE id=$1::uuid AND site_id=$2::uuid
         RETURNING id`,
        [handoverRecordMatch[1], siteId, entry.date, entry.materiel, entry.chaineEst, entry.chaineOuest,
          entry.clesRendus, entry.clesNonRendus, entry.etatDesLieux, entry.consigne, entry.evenement,
          entry.remarque, entry.cpDescendantMatricule, entry.cpMontantMatricule, account.id],
      );
      if (!result.rows[0]) throw Object.assign(new Error("Passation introuvable."), { status: 404 });
      await replaceApsServiceLinks(pool, "passation_aps_service_poste", "passation_aps_id", result.rows[0].id, siteId, entry.date);
      const saved = await pool.query(`${handoverSelect} WHERE h.id=$1::uuid`, [result.rows[0].id]);
      json(response, 200, { entry: saved.rows[0] });
      return true;
    }

    if (handoverRecordMatch && request.method === "DELETE") {
      const siteId = await resolveSite(pool, account, url.searchParams.get("siteId"));
      const result = await pool.query(
        "DELETE FROM mouvement_aps_passation WHERE id=$1::uuid AND site_id=$2::uuid RETURNING id",
        [handoverRecordMatch[1], siteId],
      );
      if (!result.rows[0]) throw Object.assign(new Error("Passation introuvable."), { status: 404 });
      json(response, 200, { id: result.rows[0].id, deleted: true });
      return true;
    }

    if (pathname === eventsPath && request.method === "GET") {
      const date = url.searchParams.get("date") || "";
      if (!validDate(date)) throw Object.assign(new Error("Date invalide."), { status: 400 });
      const siteId = await resolveSite(pool, account, url.searchParams.get("siteId"));
      const result = await pool.query(
        `SELECT e.id,TO_CHAR(e.date_operation,'YYYY-MM-DD') AS date,
           TO_CHAR(heure_entree,'HH24:MI') AS "heureEntree",mouvement,
           observation,TO_CHAR(heure_sortie,'HH24:MI') AS "heureSortie",e.site_id AS "siteId",
           COALESCE((SELECT json_agg(link.service_poste_id ORDER BY link.service_poste_id)
             FROM mouvement_aps_evenement_service_poste link WHERE link.mouvement_aps_evenement_id=e.id),'[]'::json) AS "servicePosteIds"
         FROM mouvement_aps_evenement e
         WHERE e.site_id=$1::uuid AND e.date_operation=$2::date
         ORDER BY heure_entree,e.id`,
        [siteId, date],
      );
      json(response, 200, { entries: result.rows });
      return true;
    }

    if (pathname === eventsPath && request.method === "POST") {
      const body = await readJson(request);
      const entry = validateEvent(body);
      const siteId = await resolveSite(pool, account, body?.siteId);
      const result = await pool.query(
        `INSERT INTO mouvement_aps_evenement
           (site_id,date_operation,heure_entree,mouvement,observation,heure_sortie,utilisateur_id)
         VALUES ($1::uuid,$2::date,$3::time,$4,$5,NULLIF($6,'')::time,$7::uuid)
         RETURNING id,TO_CHAR(date_operation,'YYYY-MM-DD') AS date,
           TO_CHAR(heure_entree,'HH24:MI') AS "heureEntree",mouvement,
           observation,TO_CHAR(heure_sortie,'HH24:MI') AS "heureSortie",site_id AS "siteId"`,
        [siteId, entry.date, entry.heureEntree, entry.mouvement, entry.observation, entry.heureSortie, account.id],
      );
      await replaceApsServiceLinks(pool, "mouvement_aps_evenement_service_poste", "mouvement_aps_evenement_id", result.rows[0].id, siteId, entry.date);
      const saved = await pool.query(
        `SELECT e.id,e.date_operation::text AS date,to_char(e.heure_entree,'HH24:MI') AS "heureEntree",
           e.mouvement,e.observation,to_char(e.heure_sortie,'HH24:MI') AS "heureSortie",e.site_id AS "siteId",
           COALESCE((SELECT json_agg(link.service_poste_id ORDER BY link.service_poste_id)
             FROM mouvement_aps_evenement_service_poste link WHERE link.mouvement_aps_evenement_id=e.id),'[]'::json) AS "servicePosteIds"
         FROM mouvement_aps_evenement e WHERE e.id=$1::uuid`, [result.rows[0].id]);
      json(response, 201, { entry: saved.rows[0] });
      return true;
    }

    if (eventRecordMatch && request.method === "PUT") {
      const body = await readJson(request);
      const entry = validateEvent(body);
      const siteId = await resolveSite(pool, account, body?.siteId);
      const result = await pool.query(
        `UPDATE mouvement_aps_evenement
         SET date_operation=$3::date,heure_entree=$4::time,mouvement=$5,observation=$6,
             heure_sortie=NULLIF($7,'')::time,utilisateur_id=$8::uuid,updated_at=NOW()
         WHERE id=$1::uuid AND site_id=$2::uuid
         RETURNING id,TO_CHAR(date_operation,'YYYY-MM-DD') AS date,
           TO_CHAR(heure_entree,'HH24:MI') AS "heureEntree",mouvement,
           observation,TO_CHAR(heure_sortie,'HH24:MI') AS "heureSortie",site_id AS "siteId"`,
        [eventRecordMatch[1], siteId, entry.date, entry.heureEntree, entry.mouvement, entry.observation, entry.heureSortie, account.id],
      );
      if (!result.rows[0]) throw Object.assign(new Error("Mouvement introuvable."), { status: 404 });
      await replaceApsServiceLinks(pool, "mouvement_aps_evenement_service_poste", "mouvement_aps_evenement_id", result.rows[0].id, siteId, entry.date);
      const saved = await pool.query(
        `SELECT e.id,e.date_operation::text AS date,to_char(e.heure_entree,'HH24:MI') AS "heureEntree",
           e.mouvement,e.observation,to_char(e.heure_sortie,'HH24:MI') AS "heureSortie",e.site_id AS "siteId",
           COALESCE((SELECT json_agg(link.service_poste_id ORDER BY link.service_poste_id)
             FROM mouvement_aps_evenement_service_poste link WHERE link.mouvement_aps_evenement_id=e.id),'[]'::json) AS "servicePosteIds"
         FROM mouvement_aps_evenement e WHERE e.id=$1::uuid`, [result.rows[0].id]);
      json(response, 200, { entry: saved.rows[0] });
      return true;
    }

    if (eventRecordMatch && request.method === "DELETE") {
      const siteId = await resolveSite(pool, account, url.searchParams.get("siteId"));
      const result = await pool.query(
        "DELETE FROM mouvement_aps_evenement WHERE id=$1::uuid AND site_id=$2::uuid RETURNING id",
        [eventRecordMatch[1], siteId],
      );
      if (!result.rows[0]) throw Object.assign(new Error("Mouvement introuvable."), { status: 404 });
      json(response, 200, { id: result.rows[0].id, deleted: true });
      return true;
    }

    if (request.method === "GET" && pathname === routePath) {
      const date = url.searchParams.get("date") || "";
      const service = readService(url.searchParams.get("service"));
      if (!validDate(date)) throw Object.assign(new Error("Date invalide."), { status: 400 });
      const siteId = await resolveSite(pool, account, url.searchParams.get("siteId"));
      const [movement, configuration] = await Promise.all([
        pool.query(
          `SELECT m.data,COALESCE((SELECT json_agg(link.service_poste_id ORDER BY link.service_poste_id)
             FROM mouvement_aps_service_poste link WHERE link.mouvement_aps_id=m.id),'[]'::json) AS "servicePosteIds"
           FROM mouvement_aps m WHERE m.site_id=$1::uuid AND m.date_pointage=$2::date AND m.service=$3 LIMIT 1`,
          [siteId, date, service],
        ),
        pool.query(
          "SELECT postes FROM configuration_postes_mouvement_aps WHERE site_id=$1::uuid LIMIT 1",
          [siteId],
        ),
      ]);
      json(response, 200, {
        data: movement.rows[0]?.data ?? null,
        servicePosteIds: movement.rows[0]?.servicePosteIds ?? [],
        postes: configuration.rows[0]?.postes ?? null,
      });
      return true;
    }

    if (request.method === "PUT" && pathname === configurationPath) {
      const body = await readJson(request);
      const postes = validatePostes(body?.postes);
      const siteId = await resolveSite(pool, account, body?.siteId);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await saveConfiguration(client, siteId, postes, account.id);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      json(response, 200, { saved: true, postes });
      return true;
    }

    if (request.method === "PUT" && pathname === routePath) {
      const body = await readJson(request);
      const date = typeof body?.date === "string" ? body.date : "";
      const service = readService(body?.service);
      if (!validDate(date)) throw Object.assign(new Error("Date invalide."), { status: 400 });
      const siteId = await resolveSite(pool, account, body?.siteId);
      const postes = validatePostes(body?.postes);
      const data = validateData(body?.data, postes);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query(
          `INSERT INTO mouvement_aps (site_id,date_pointage,service,data,utilisateur_id,updated_at)
           VALUES ($1::uuid,$2::date,$3,$4::jsonb,$5::uuid,NOW())
           ON CONFLICT (site_id,date_pointage,service)
           DO UPDATE SET data=EXCLUDED.data,utilisateur_id=EXCLUDED.utilisateur_id,updated_at=NOW()
           RETURNING id,updated_at AS "updatedAt"`,
          [siteId, date, service, JSON.stringify(data), account.id],
        );
        await replaceApsServiceLinks(client, "mouvement_aps_service_poste", "mouvement_aps_id", result.rows[0].id, siteId, date, service.toUpperCase());
        await saveConfiguration(client, siteId, postes, account.id);
        await client.query("COMMIT");
        json(response, 200, { saved: true, updatedAt: result.rows[0].updatedAt });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      return true;
    }

    json(response, 405, { error: "Méthode non autorisée." });
    return true;
  } catch (error) {
    console.error("APS movement module failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, {
      error: error.status ? error.message : "Opération sur les mouvements APS impossible.",
    });
    return true;
  }
}
