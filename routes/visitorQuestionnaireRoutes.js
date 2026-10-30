import { getRequestUser } from "../utils/auth.js";
import { json, readJson } from "../utils/helpers.js";
import { resolveServicePosteId } from "../utils/priseDePoste.js";

const collectionPath = "/api/visitor-questionnaires";
const entryPath = /^\/api\/visitor-questionnaires\/([0-9a-f-]+)$/i;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const answers = new Set(["ENY", "TSIA"]);
const text = (value, max = 500) => typeof value === "string" ? value.trim().slice(0, max) : "";

const validDate = (value) => {
  if (!datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

function validateData(value) {
  const data = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const answerValues = data.answers && typeof data.answers === "object" ? data.answers : {};
  const normalized = {
    code: text(data.code, 40),
    version: text(data.version, 40),
    page: text(data.page, 20),
    firstName: text(data.firstName),
    lastName: text(data.lastName),
    factory: text(data.factory),
    date: text(data.date, 10),
    reason: text(data.reason, 1000),
    origin: ["MADAGASCAR", "OTHER"].includes(data.origin) ? data.origin : "",
    originPlace: text(data.originPlace),
    originOther: text(data.originOther),
    visitTime: text(data.visitTime, 80),
    entryTime: text(data.entryTime, 5),
    exitTime: text(data.exitTime, 5),
    answers: {
      "1": text(answerValues["1"], 4),
      "2": text(answerValues["2"], 4),
      "3": text(answerValues["3"], 4),
      "4": text(answerValues["4"], 4),
      "5": text(answerValues["5"], 4),
      "6": text(answerValues["6"], 4),
    },
    agreement: data.agreement === true,
    visitorSignature: text(data.visitorSignature),
    securitySignature: text(data.securitySignature),
    managerSignature: text(data.managerSignature),
  };
  if (!normalized.firstName || !normalized.lastName || !normalized.factory
    || !validDate(normalized.date) || !normalized.reason
    || (normalized.origin === "MADAGASCAR" && !normalized.originPlace)
    || (normalized.origin === "OTHER" && !normalized.originOther)
    || (normalized.entryTime && !timePattern.test(normalized.entryTime))
    || (normalized.exitTime && !timePattern.test(normalized.exitTime))
    || Object.values(normalized.answers).some((answer) => !answers.has(answer))) {
    throw Object.assign(new Error("Complétez l’identité du visiteur, la date, le motif, l’origine et les six réponses « Eny / Tsia »."), { status: 400 });
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

const selection = `SELECT q.id, q.donnees AS data, q.site_id AS "siteId", s.nom AS "siteName",
  q.cree_le AS "createdAt", q.modifie_le AS "updatedAt", q.service_poste_id AS "servicePosteId",
  sp.poste_id AS "posteId", po.nom AS "posteNom", sp.shift_type AS "shiftType"
  FROM questionnaire_visiteur q JOIN site s ON s.id=q.site_id
  LEFT JOIN service_poste sp ON sp.id=q.service_poste_id
  LEFT JOIN poste po ON po.id=sp.poste_id`;

export async function handleVisitorQuestionnaireRoutes(request, response, pool, pathname, jwtSecret) {
  const entryMatch = entryPath.exec(pathname);
  if (pathname !== collectionPath && !entryMatch) return false;
  const user = getRequestUser(request, jwtSecret);
  if (!user) {
    json(response, 401, { error: "Connectez-vous pour gérer les questionnaires visiteurs." });
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
        `${selection} WHERE q.site_id=$1::uuid ORDER BY q.date_operation DESC, q.cree_le DESC LIMIT 1000`,
        [siteId],
      );
      json(response, 200, { entries: result.rows });
      return true;
    }

    if (request.method === "POST" && pathname === collectionPath) {
      const body = await readJson(request);
      const data = validateData(body.data);
      const siteId = await resolveSite(pool, account, body.siteId);
      const servicePosteId = await resolveServicePosteId(pool, siteId, body.priseDePosteId, body.posteId || null);
      const result = await pool.query(
        `INSERT INTO questionnaire_visiteur (date_operation, donnees, site_id, utilisateur_id, service_poste_id)
         VALUES ($1::date, $2::jsonb, $3::uuid, $4::uuid, $5::uuid)
         RETURNING id, donnees AS data, site_id AS "siteId", cree_le AS "createdAt", modifie_le AS "updatedAt", service_poste_id AS "servicePosteId"`,
        [data.date, JSON.stringify(data), siteId, account.id, servicePosteId],
      );
      const site = await pool.query("SELECT nom AS \"siteName\" FROM site WHERE id=$1::uuid", [siteId]);
      json(response, 201, { entry: { ...result.rows[0], siteName: site.rows[0].siteName } });
      return true;
    }

    if (request.method === "PUT" && entryMatch) {
      if (!uuidPattern.test(entryMatch[1])) { json(response, 404, { error: "Questionnaire introuvable." }); return true; }
      const body = await readJson(request);
      const data = validateData(body.data);
      const siteId = await resolveSite(pool, account, body.siteId);
      const result = await pool.query(
        `UPDATE questionnaire_visiteur
         SET date_operation=$2::date, donnees=$3::jsonb, modifie_le=CURRENT_TIMESTAMP
         WHERE id=$1::uuid AND site_id=$4::uuid
         RETURNING id, donnees AS data, site_id AS "siteId", cree_le AS "createdAt", modifie_le AS "updatedAt", service_poste_id AS "servicePosteId"`,
        [entryMatch[1], data.date, JSON.stringify(data), siteId],
      );
      if (!result.rows[0]) { json(response, 404, { error: "Questionnaire introuvable sur ce site." }); return true; }
      const site = await pool.query("SELECT nom AS \"siteName\" FROM site WHERE id=$1::uuid", [siteId]);
      json(response, 200, { entry: { ...result.rows[0], siteName: site.rows[0].siteName } });
      return true;
    }

    if (request.method === "DELETE" && entryMatch) {
      if (!uuidPattern.test(entryMatch[1])) { json(response, 404, { error: "Questionnaire introuvable." }); return true; }
      const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
      const siteId = await resolveSite(pool, account, url.searchParams.get("siteId"));
      const result = await pool.query(
        "DELETE FROM questionnaire_visiteur WHERE id=$1::uuid AND site_id=$2::uuid RETURNING id",
        [entryMatch[1], siteId],
      );
      if (!result.rows[0]) { json(response, 404, { error: "Questionnaire introuvable sur ce site." }); return true; }
      json(response, 200, { id: result.rows[0].id, deleted: true });
      return true;
    }

    json(response, 405, { error: "Méthode non autorisée." });
  } catch (error) {
    console.error("Route questionnaires visiteurs:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Opération sur les questionnaires impossible." });
  }
  return true;
}
