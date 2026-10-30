import { getRequestUser } from "../utils/auth.js";
import { json, readJson } from "../utils/helpers.js";

const routePath = "/api/consignes-journal";
const entryPath = /^\/api\/consignes-journal\/([0-9a-f-]+)$/i;
const readPath = /^\/api\/consignes-journal\/([0-9a-f-]+)\/read$/i;
const entryColumns = `cj.id, cj.date_consigne AS date, to_char(cj.heure, 'HH24:MI') AS heure,
  cj.consigne, cj.emetteur, cj.destinataire, cj.date_fin AS "dateFin",
  cj.jusquau_nouvel_ordre AS "jusquauNouvelOrdre", cj.prise_de_poste_id AS "priseDePosteId",
  cj.service_poste_id AS "servicePosteId",
  COALESCE(cj.poste_id, p.poste_id, (SELECT MIN(cjp.poste_id::text)::uuid FROM consigne_journal_poste cjp WHERE cjp.consigne_id=cj.id)) AS "posteId",
  (cj.poste_id IS NULL AND p.poste_id IS NULL AND NOT EXISTS (SELECT 1 FROM consigne_journal_poste cjp WHERE cjp.consigne_id=cj.id)) AS "tousPostes",
  COALESCE((SELECT json_agg(cjp.poste_id ORDER BY cjp.poste_id) FROM consigne_journal_poste cjp WHERE cjp.consigne_id=cj.id),
    CASE WHEN COALESCE(cj.poste_id,p.poste_id) IS NULL THEN '[]'::json ELSE json_build_array(COALESCE(cj.poste_id,p.poste_id)) END) AS "posteIds",
  (SELECT po.nom FROM poste po WHERE po.id=COALESCE(cj.poste_id,p.poste_id,
    (SELECT MIN(cjp.poste_id::text)::uuid FROM consigne_journal_poste cjp WHERE cjp.consigne_id=cj.id))) AS "posteNom",
  p.shift_type AS "shiftType", cj.cree_le AS "createdAt",
  COALESCE((SELECT json_agg(json_build_object('posteId', target.id, 'posteNom', target.nom, 'readAt', read_status.read_at, 'reader', read_status.reader, 'readers', read_status.readers) ORDER BY target.nom)
    FROM poste target
    LEFT JOIN LATERAL (
      SELECT MAX(cl.lu_le) AS read_at, (array_agg(u.nom ORDER BY cl.lu_le DESC))[1] AS reader,
        json_agg(json_build_object('name', u.nom, 'readAt', cl.lu_le) ORDER BY cl.lu_le DESC) AS readers
      FROM consigne_lecture cl JOIN utilisateur u ON u.id=cl.utilisateur_id
      WHERE cl.consigne_id=cj.id AND cl.poste_id=target.id
    ) read_status ON true
    WHERE target.site_id=cj.site_id AND target.actif=true
      AND (EXISTS (SELECT 1 FROM consigne_journal_poste cjp WHERE cjp.consigne_id=cj.id AND cjp.poste_id=target.id)
        OR (COALESCE(cj.poste_id,p.poste_id)=target.id AND NOT EXISTS (SELECT 1 FROM consigne_journal_poste cjp WHERE cjp.consigne_id=cj.id))
        OR (cj.poste_id IS NULL AND p.poste_id IS NULL AND NOT EXISTS (SELECT 1 FROM consigne_journal_poste cjp WHERE cjp.consigne_id=cj.id)))), '[]'::json) AS lectures`;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const cleanText = (value, max = 255) => typeof value === "string" ? value.trim().slice(0, max) : "";
const validDate = (value) => {
  if (!datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

async function getAccount(pool, userId) {
  const result = await pool.query("SELECT id, role, site_id FROM utilisateur WHERE id=$1::uuid AND actif=true LIMIT 1", [userId]);
  return result.rows[0] || null;
}

async function resolveSite(pool, account, requestedSiteId) {
  if (account.site_id && account.role !== 1) return account.site_id;
  if (!requestedSiteId) throw Object.assign(new Error("Selectionnez un site."), { status: 400 });
  const result = await pool.query("SELECT id FROM site WHERE id=$1::uuid AND actif=true LIMIT 1", [requestedSiteId]);
  if (!result.rows[0]) throw Object.assign(new Error("Site introuvable ou inactif."), { status: 404 });
  return result.rows[0].id;
}

async function resolvePostIds(client, siteId, value) {
  if (value !== undefined && !Array.isArray(value)) {
    throw Object.assign(new Error("La sélection des postes est invalide."), { status: 400 });
  }
  if (!Array.isArray(value) || value.length === 0) return [];
  const ids = [...new Set(value)];
  if (ids.length > 20 || ids.some((id) => typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id))) {
    throw Object.assign(new Error("La sélection des postes est invalide."), { status: 400 });
  }
  const result = await client.query(
    "SELECT id FROM poste WHERE site_id=$1::uuid AND actif=true AND id=ANY($2::uuid[])",
    [siteId, ids],
  );
  if (result.rows.length !== ids.length) {
    throw Object.assign(new Error("Un ou plusieurs postes sont inactifs ou ne dépendent pas de ce site."), { status: 400 });
  }
  return result.rows.map((row) => row.id);
}

async function getEntry(pool, id, siteId) {
  const result = await pool.query(
    `SELECT ${entryColumns}
     FROM consigne_journal cj
     LEFT JOIN prise_de_poste p ON p.id=cj.prise_de_poste_id
     WHERE cj.id=$1::uuid AND cj.site_id=$2::uuid`,
    [id, siteId],
  );
  return result.rows[0] || null;
}

export async function handleConsigneJournalRoutes(request, response, pool, pathname, jwtSecret) {
  const entryMatch = entryPath.exec(pathname);
  const receiptMatch = readPath.exec(pathname);
  if (pathname !== routePath && !entryMatch && !receiptMatch) return false;
  const user = getRequestUser(request, jwtSecret);
  if (!user) {
    json(response, 401, { error: "Connectez-vous pour acceder aux consignes." });
    return true;
  }

  try {
    const account = await getAccount(pool, user.id);
    if (!account) throw Object.assign(new Error("Utilisateur introuvable."), { status: 401 });

    if (receiptMatch && request.method === "POST") {
      if (![1, 2, 3, 5].includes(Number(account.role))) throw Object.assign(new Error("Ce profil ne peut pas confirmer la lecture d’une consigne."), { status: 403 });
      const body = await readJson(request);
      const siteId = await resolveSite(pool, account, body?.siteId);
      const posteId = cleanText(body?.posteId, 36);
      if (!/^[0-9a-f-]{36}$/i.test(posteId)) throw Object.assign(new Error("Sélectionnez le poste de lecture."), { status: 400 });
      const target = await pool.query(
        `SELECT cj.id
         FROM consigne_journal cj
         LEFT JOIN prise_de_poste shift ON shift.id=cj.prise_de_poste_id
         WHERE cj.id=$1::uuid AND cj.site_id=$2::uuid
           AND cj.date_consigne<=CURRENT_DATE
           AND (cj.jusquau_nouvel_ordre=true OR cj.date_fin>=CURRENT_DATE)
           AND EXISTS (SELECT 1 FROM poste po WHERE po.id=$3::uuid AND po.site_id=cj.site_id AND po.actif=true)
           AND (EXISTS (SELECT 1 FROM consigne_journal_poste cjp WHERE cjp.consigne_id=cj.id AND cjp.poste_id=$3::uuid)
             OR (NOT EXISTS (SELECT 1 FROM consigne_journal_poste cjp WHERE cjp.consigne_id=cj.id)
               AND (COALESCE(cj.poste_id,shift.poste_id)=$3::uuid
                 OR (cj.poste_id IS NULL AND shift.poste_id IS NULL))))
           LIMIT 1`,
        [receiptMatch[1], siteId, posteId],
      );
      if (!target.rows[0]) throw Object.assign(new Error("Cette consigne ne vise pas le poste sélectionné ou n’est plus active."), { status: 404 });
      const result = await pool.query(
        `INSERT INTO consigne_lecture (consigne_id, poste_id, utilisateur_id)
         VALUES ($1::uuid, $2::uuid, $3::uuid)
         ON CONFLICT (consigne_id, poste_id, utilisateur_id) DO UPDATE SET lu_le=NOW()
         RETURNING consigne_id AS "consigneId", poste_id AS "posteId", lu_le AS "readAt"`,
        [receiptMatch[1], posteId, user.id],
      );
      json(response, 200, { receipt: result.rows[0] });
      return true;
    }

    if (request.method === "GET" && pathname === routePath) {
      const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
      const siteId = await resolveSite(pool, account, url.searchParams.get("siteId"));
      const activeOnly = url.searchParams.get("activeOnly") === "true";
      const result = await pool.query(
        `SELECT ${entryColumns}
         FROM consigne_journal cj
         LEFT JOIN prise_de_poste p ON p.id=cj.prise_de_poste_id
         WHERE cj.site_id=$1::uuid
           AND (NOT $2::boolean OR (cj.date_consigne<=CURRENT_DATE AND (cj.jusquau_nouvel_ordre=true OR cj.date_fin >= CURRENT_DATE)))
         ORDER BY cj.date_consigne DESC, cj.heure DESC, cj.cree_le DESC LIMIT 1000`,
        [siteId, activeOnly],
      );
      json(response, 200, { entries: result.rows });
      return true;
    }

    if (request.method === "DELETE" && entryMatch) {
      if (![1, 3].includes(Number(account.role))) throw Object.assign(new Error("Seul le responsable sécurité peut retirer une consigne."), { status: 403 });
      const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
      const siteId = await resolveSite(pool, account, url.searchParams.get("siteId"));
      const result = await pool.query(
        "DELETE FROM consigne_journal WHERE id=$1::uuid AND site_id=$2::uuid RETURNING id",
        [entryMatch[1], siteId],
      );
      if (!result.rows[0]) {
        json(response, 404, { error: "Consigne introuvable pour ce site." });
        return true;
      }
      json(response, 200, { id: result.rows[0].id, deleted: true });
      return true;
    }

    if (request.method !== "POST" && !(request.method === "PUT" && entryMatch)) {
      json(response, 405, { error: "Methode non autorisee." });
      return true;
    }
    if (![1, 3].includes(Number(account.role))) throw Object.assign(new Error("Seul le responsable sécurité peut émettre ou modifier une consigne."), { status: 403 });

    const body = await readJson(request);
    const date = cleanText(body?.date, 10);
    const heure = cleanText(body?.heure, 5);
    const consigne = cleanText(body?.consigne, 20000);
    const emetteur = cleanText(body?.emetteur);
    const destinataire = cleanText(body?.destinataire);
    const jusquauNouvelOrdre = body?.jusquauNouvelOrdre === true;
    const dateFin = jusquauNouvelOrdre ? null : cleanText(body?.dateFin, 10);
    if (!datePattern.test(date) || !timePattern.test(heure) || !consigne || !emetteur || !destinataire) {
      json(response, 400, { error: "Tous les champs sont obligatoires et la date et l'heure doivent etre valides." });
      return true;
    }
    if (!jusquauNouvelOrdre && (!validDate(dateFin) || dateFin < date)) {
      json(response, 400, { error: "Indiquez une date de fin valide ou choisissez « Jusqu’à nouvel ordre »." });
      return true;
    }
    const siteId = await resolveSite(pool, account, body.siteId);
    const client = await pool.connect();
    let entryId;
    try {
      await client.query("BEGIN");
      const postIds = await resolvePostIds(client, siteId, body.posteIds);
      if (request.method === "PUT") {
        const result = await client.query(
          `UPDATE consigne_journal
           SET date_consigne=$2::date, heure=$3::time, consigne=$4, emetteur=$5, destinataire=$6,
               date_fin=$7::date, jusquau_nouvel_ordre=$8, prise_de_poste_id=NULL, poste_id=NULL
           WHERE id=$1::uuid AND site_id=$9::uuid RETURNING id`,
          [entryMatch[1], date, heure, consigne, emetteur, destinataire, dateFin, jusquauNouvelOrdre, siteId],
        );
        if (!result.rows[0]) throw Object.assign(new Error("Consigne introuvable pour ce site."), { status: 404 });
        entryId = result.rows[0].id;
        await client.query("DELETE FROM consigne_journal_poste WHERE consigne_id=$1::uuid", [entryId]);
        await client.query("DELETE FROM consigne_lecture WHERE consigne_id=$1::uuid", [entryId]);
      } else {
        const result = await client.query(
          `INSERT INTO consigne_journal
             (site_id, date_consigne, heure, consigne, emetteur, destinataire, utilisateur_id,
              date_fin, jusquau_nouvel_ordre)
           VALUES ($1::uuid, $2::date, $3::time, $4, $5, $6, $7::uuid, $8::date, $9)
           RETURNING id`,
          [siteId, date, heure, consigne, emetteur, destinataire, account.id, dateFin, jusquauNouvelOrdre],
        );
        entryId = result.rows[0].id;
      }
      if (postIds.length) {
        await client.query(
          `INSERT INTO consigne_journal_poste (consigne_id, poste_id)
           SELECT $1::uuid, target.id FROM poste target
           WHERE target.id=ANY($2::uuid[])`,
          [entryId, postIds],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally { client.release(); }
    const entry = await getEntry(pool, entryId, siteId);
    json(response, request.method === "PUT" ? 200 : 201, { entry });
  } catch (error) {
    json(response, error.status || 500, { error: error.message || "Enregistrement de la consigne impossible." });
  }
  return true;
}
