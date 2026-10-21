import "dotenv/config";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createNeonPool } from "./config/neonPool.js";

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || Buffer.byteLength(jwtSecret) < 32) {
  throw new Error("JWT_SECRET doit être défini dans le fichier .env avec au moins 32 caractères.");
}

export const apiPrefix = "/api";
export const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS || "http://localhost:5173,http://localhost:5175")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);
const loginAttempts = new Map();
const maxLoginAttempts = 10;
const loginWindowMs = 15 * 60 * 1000;

export function clearLoginAttempts(ip) {
  loginAttempts.delete(ip);
}

let poolPromise;
export function getPool() {
  if (!poolPromise) {
    poolPromise = createNeonPool().catch((error) => {
      poolPromise = undefined;
      throw error;
    });
  }
  return poolPromise;
}

export function json(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

export async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 2_000_000) throw Object.assign(new Error("Requête trop volumineuse"), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Corps JSON invalide"), { status: 400 });
  }
}

const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
export const reportDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export function requestUser(request, response) {
  const user = readToken(request);
  if (!user) json(response, 401, { error: "Session absente ou expirée." });
  return user;
}

export function text(value, max = 255) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function getOrCreateSite(client, name, typeSite = "USINE") {
  const siteName = text(name, 255);
  if (!siteName) throw Object.assign(new Error("Le site de travail est obligatoire."), { status: 400 });
  const found = await client.query("SELECT id FROM site WHERE LOWER(nom)=LOWER($1) LIMIT 1", [siteName]);
  if (found.rows[0]) {
    await client.query("UPDATE site SET type_site=$2::type_site, actif=true WHERE id=$1", [found.rows[0].id, typeSite === "AGENCE" ? "AGENCE" : "USINE"]);
    return found.rows[0].id;
  }
  const inserted = await client.query(
    "INSERT INTO site (nom, adresse, type_site) VALUES ($1, '', $2::type_site) RETURNING id",
    [siteName, typeSite === "AGENCE" ? "AGENCE" : "USINE"],
  );
  return inserted.rows[0].id;
}

export async function getOrCreateProvider(client, name) {
  const provider = text(name, 160);
  if (!provider) throw Object.assign(new Error("Le prestataire est obligatoire."), { status: 400 });
  const result = await client.query(
    "INSERT INTO prestataire (nom) VALUES ($1) ON CONFLICT (nom) DO UPDATE SET actif=true RETURNING id",
    [provider],
  );
  return result.rows[0].id;
}

export async function getOrCreatePost(client, siteId, name) {
  const post = text(name, 160) || "Poste principal";
  const result = await client.query(
    "INSERT INTO poste (nom, site_id) VALUES ($1, $2) ON CONFLICT (site_id, nom) DO UPDATE SET actif=true RETURNING id",
    [post, siteId],
  );
  return result.rows[0].id;
}

export async function saveServiceReport(pool, user, body, reportId = null) {
  const siteType = body.siteType === "AGENCE" ? "AGENCE" : "USINE";
  const siteName = text(body.siteName);
  const providerName = text(body.providerName, 160);
  const postName = text(body.postName, 160) || "Poste principal";
  const reportDate = text(body.reportDate, 10);
  const startTime = text(body.startTime, 5);
  const endTime = text(body.endTime, 5);
  if (!siteName || !providerName || !reportDatePattern.test(reportDate) || !timePattern.test(startTime) || !timePattern.test(endTime)) {
    throw Object.assign(new Error("Complétez le site, le prestataire, la date et les heures de début/fin (HH:MM)."), { status: 400 });
  }
  if (user.siteId && user.siteNom && siteName.toLocaleLowerCase() !== user.siteNom.toLocaleLowerCase()) {
    throw Object.assign(new Error("Le compte est limité au site associé à sa session."), { status: 403 });
  }
  const agents = Array.isArray(body.agents) ? body.agents.slice(0, 100) : [];
  if (!agents.some((agent) => text(agent?.name) && text(agent?.matricule, 50))) {
    throw Object.assign(new Error("Ajoutez au moins un agent avec son matricule."), { status: 400 });
  }
  const details = body.details && typeof body.details === "object" && !Array.isArray(body.details) ? body.details : {};
  const client = await pool.connect();
  let before = null;
  try {
    await client.query("BEGIN");
    const siteId = user.siteId || await getOrCreateSite(client, siteName, siteType);
    const prestataireId = await getOrCreateProvider(client, providerName);
    const posteId = await getOrCreatePost(client, siteId, postName);
    let vacationId;
    let previousId = null;

    if (reportId) {
      const previous = await client.query(
        `SELECT cr.id, cr.statut_validation, cr.details, cr.observations, cr.vacation_id,
           cr.date_rapport AS "reportDate", cr.debut_service AS "startTime", cr.fin_service AS "endTime",
           s.nom AS "siteName", pr.nom AS "providerName", po.nom AS "postName",
           (SELECT COALESCE(json_agg(json_build_object('name', concat_ws(' ', a.prenom, a.nom), 'matricule', a.matricule, 'shift', ca.shift, 'post', ap.nom)), '[]'::json)
              FROM compte_rendu_agent ca JOIN agent a ON a.id=ca.agent_id JOIN poste ap ON ap.id=ca.poste_id
             WHERE ca.compte_rendu_id=cr.id) AS agents
         FROM compte_rendu cr JOIN vacation v ON v.id=cr.vacation_id
         JOIN site s ON s.id=cr.site_id JOIN prestataire pr ON pr.id=cr.prestataire_id JOIN poste po ON po.id=cr.poste_id
         WHERE cr.id=$1 AND v.utilisateur_id=$2 FOR UPDATE`,
        [reportId, user.sub],
      );
      if (!previous.rows[0]) throw Object.assign(new Error("Compte rendu introuvable."), { status: 404 });
      if (previous.rows[0].statut_validation === "ENVOYE") throw Object.assign(new Error("Ce compte rendu est envoyé et verrouillé."), { status: 409 });
      previousId = previous.rows[0].id;
      vacationId = previous.rows[0].vacation_id;
      before = {
        siteName: previous.rows[0].siteName, providerName: previous.rows[0].providerName,
        postName: previous.rows[0].postName, reportDate: previous.rows[0].reportDate,
        startTime: previous.rows[0].startTime, endTime: previous.rows[0].endTime,
        agents: previous.rows[0].agents, observations: previous.rows[0].observations,
        details: previous.rows[0].details,
      };
      await client.query(
        `UPDATE vacation SET ouverture=($2::date + $3::time), agent_nom=NULL, matricule=NULL, shift_type=NULL,
          cloture=CASE WHEN $4::time < $3::time THEN ($2::date + 1 + $4::time) ELSE ($2::date + $4::time) END,
          site_id=$5, poste_nom=$6, prestataire_nom=$7 WHERE id=$1`,
        [vacationId, reportDate, startTime, endTime, siteId, postName, providerName],
      );
      await client.query(
        `UPDATE compte_rendu SET observations=$2, statut_validation='BROUILLON', site_id=$3,
          prestataire_id=$4, poste_id=$5, date_rapport=$6::date, debut_service=$7::time,
          fin_service=$8::time, details=$9::jsonb WHERE id=$1`,
        [reportId, text(body.observations, 20000), siteId, prestataireId, posteId, reportDate, startTime, endTime, JSON.stringify(details)],
      );
      await client.query("DELETE FROM compte_rendu_agent WHERE compte_rendu_id=$1", [reportId]);
    } else {
      const vacation = await client.query(
        `INSERT INTO vacation (ouverture, cloture, utilisateur_id, site_id, poste_nom, prestataire_nom)
         VALUES (($1::date + $2::time), CASE WHEN $3::time < $2::time THEN ($1::date + 1 + $3::time) ELSE ($1::date + $3::time) END, $4, $5, $6, $7)
         RETURNING id`,
        [reportDate, startTime, endTime, user.sub, siteId, postName, providerName],
      );
      vacationId = vacation.rows[0].id;
    }

    for (const entry of agents) {
      const fullName = text(entry?.name);
      const matricule = text(entry?.matricule, 50);
      const shift = entry?.shift === "NUIT" ? "NUIT" : "JOUR";
      if (!fullName && !matricule) continue;
      if (!fullName || !matricule) throw Object.assign(new Error("Chaque agent doit avoir un nom et un matricule."), { status: 400 });
      const names = fullName.split(/\s+/);
      const firstName = names.length > 1 ? names.slice(0, -1).join(" ") : names[0];
      const lastName = names.length > 1 ? names[names.length - 1] : names[0];
      const agent = await client.query(
        `INSERT INTO agent (prenom, nom, matricule, prestataire_id) VALUES ($1,$2,$3,$4)
         ON CONFLICT (matricule) DO UPDATE SET prenom=EXCLUDED.prenom, nom=EXCLUDED.nom, prestataire_id=EXCLUDED.prestataire_id
         RETURNING id`,
        [firstName, lastName, matricule, prestataireId],
      );
      const agentPostId = await getOrCreatePost(client, siteId, text(entry?.post, 160) || postName);
      if (reportId) {
        await client.query(
          "INSERT INTO compte_rendu_agent (compte_rendu_id, agent_id, poste_id, shift) VALUES ($1,$2,$3,$4::shift_agent)",
          [reportId, agent.rows[0].id, agentPostId, shift],
        );
      }
      await client.query(
        `UPDATE vacation SET agent_nom=COALESCE(agent_nom || ', ', '') || $2,
          matricule=COALESCE(matricule || ', ', '') || $3, shift_type=$4::shift_agent,
          checklist=$5::jsonb, observations=$6 WHERE id=$1`,
        [vacationId, fullName, matricule, shift, JSON.stringify(details.vigilance || {}), text(body.observations, 20000)],
      );
    }

    let savedId = reportId;
    if (!reportId) {
      const inserted = await client.query(
        `INSERT INTO compte_rendu (observations, statut_validation, vacation_id, site_id, prestataire_id, poste_id, date_rapport, debut_service, fin_service, details)
         VALUES ($1,'BROUILLON',$2,$3,$4,$5,$6::date,$7::time,$8::time,$9::jsonb)
         ON CONFLICT (site_id, date_rapport) DO NOTHING RETURNING id`,
        [text(body.observations, 20000), vacationId, siteId, prestataireId, posteId, reportDate, startTime, endTime, JSON.stringify(details)],
      );
      if (!inserted.rows[0]) throw Object.assign(new Error("Un compte rendu existe déjà pour ce site et cette date."), { status: 409 });
      savedId = inserted.rows[0].id;
      for (const entry of agents) {
        const matricule = text(entry?.matricule, 50);
        if (!matricule) continue;
        const agent = await client.query("SELECT id FROM agent WHERE matricule=$1", [matricule]);
        const agentPostId = await getOrCreatePost(client, siteId, text(entry?.post, 160) || postName);
        await client.query(
          "INSERT INTO compte_rendu_agent (compte_rendu_id, agent_id, poste_id, shift) VALUES ($1,$2,$3,$4::shift_agent)",
          [savedId, agent.rows[0].id, agentPostId, entry?.shift === "NUIT" ? "NUIT" : "JOUR"],
        );
      }
    }

    const snapshot = { siteName, providerName, postName, reportDate, startTime, endTime, agents, details, observations: text(body.observations, 20000) };
    await client.query(
      "INSERT INTO audit_compte_rendu (compte_rendu_id, utilisateur_id, action, avant, apres) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb)",
      [savedId, user.sub, previousId ? "MODIFICATION" : "CREATION", before ? JSON.stringify(before) : null, JSON.stringify(snapshot)],
    );
    await client.query("COMMIT");
    return { id: savedId, statut: "BROUILLON", ...snapshot };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export function isRateLimited(ip) {
  const now = Date.now();
  const attempts = loginAttempts.get(ip);
  if (!attempts || now >= attempts.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + loginWindowMs });
    return false;
  }
  attempts.count += 1;
  return attempts.count > maxLoginAttempts;
}

export function createToken(account) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    sub: account.id,
    nom: account.nom,
    identifiant: account.identifiant,
    role: account.role,
    siteId: account.site_id,
    siteNom: account.site_nom,
    iat: now,
    exp: now + 8 * 60 * 60,
  })).toString("base64url");
  const unsigned = `${header}.${payload}`;
  const signature = createHmac("sha256", jwtSecret).update(unsigned).digest("base64url");
  return `${unsigned}.${signature}`;
}

export function readToken(request) {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.authorization || "");
  if (!match) return null;
  const parts = match[1].split(".");
  if (parts.length !== 3) return null;
  const unsigned = `${parts[0]}.${parts[1]}`;
  const expected = createHmac("sha256", jwtSecret).update(unsigned).digest();
  let provided;
  try {
    provided = Buffer.from(parts[2], "base64url");
  } catch {
    return null;
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return Number(payload.exp) > Math.floor(Date.now() / 1000) ? payload : null;
  } catch {
    return null;
  }
}

export function publicUser(account) {
  return {
    id: account.sub || account.id,
    nom: account.nom,
    name: account.nom,
    identifiant: account.identifiant,
    role: account.role,
    roleLabel: "Utilisateur",
    siteId: account.siteId ?? account.site_id ?? null,
    siteNom: account.siteNom ?? account.site_nom ?? null,
  };
}

export function logNetworkCauses(error) {
  const pending = [error.sourceError || error.cause].filter(Boolean);
  const seen = new Set();
  while (pending.length) {
    const current = pending.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    console.error("Cause réseau:", current.code || current.name || "erreur", current.message || "");
    if (current.cause) pending.push(current.cause);
    if (Array.isArray(current.errors)) pending.push(...current.errors);
  }
}


export async function closePool() {
  if (poolPromise) await poolPromise.then((pool) => pool.end()).catch(() => {});
}
