import "dotenv/config";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import bcrypt from "bcryptjs";
import pg from "pg";

const { Pool } = pg;
const port = Number(process.env.PORT || 5000);
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || Buffer.byteLength(jwtSecret) < 32) {
  throw new Error("JWT_SECRET doit être défini dans le fichier .env avec au moins 32 caractères.");
}

const apiPrefix = "/api";
const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS || "http://localhost:5173,http://localhost:5175")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);
const loginAttempts = new Map();
const maxLoginAttempts = 10;
const loginWindowMs = 15 * 60 * 1000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
});

function json(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 4096) throw Object.assign(new Error("Requête trop volumineuse"), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Corps JSON invalide"), { status: 400 });
  }
}

function isRateLimited(ip) {
  const now = Date.now();
  const attempts = loginAttempts.get(ip);
  if (!attempts || now >= attempts.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + loginWindowMs });
    return false;
  }
  attempts.count += 1;
  return attempts.count > maxLoginAttempts;
}

function createToken(account) {
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

function readToken(request) {
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

function publicUser(account) {
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

pool.on("error", (error) => {
  console.error("Erreur inattendue du pool PostgreSQL:", error.message);
});

const server = createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }

  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }

  const pathname = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`).pathname;
  if (request.method === "POST" && pathname === `${apiPrefix}/auth/login`) {
    const ip = request.socket.remoteAddress || "unknown";
    if (isRateLimited(ip)) {
      json(response, 429, { error: "Trop de tentatives. Réessayez dans 15 minutes." });
      return;
    }

    try {
      const body = await readJson(request);
      const identifier = typeof body.identifier === "string" ? body.identifier.trim() : "";
      const pin = typeof body.pin === "string" ? body.pin : "";
      if (!identifier || !/^\d{6}$/.test(pin)) {
        json(response, 400, { error: "Saisissez un identifiant et un PIN de 6 chiffres." });
        return;
      }

      const result = await pool.query(
        `SELECT u.id, u.nom, u.identifiant, u.role, u.pin_hache, u.site_id, s.nom AS site_nom
         FROM utilisateur u
         LEFT JOIN site s ON s.id = u.site_id
         WHERE LOWER(u.identifiant) = LOWER($1)
         LIMIT 1`,
        [identifier],
      );
      const account = result.rows[0];
      const validPin = account?.pin_hache
        ? await bcrypt.compare(pin, account.pin_hache).catch(() => false)
        : false;

      if (!account || !validPin) {
        json(response, 401, { error: "Identifiant ou PIN incorrect." });
        return;
      }

      loginAttempts.delete(ip);
      json(response, 200, { token: createToken(account), user: publicUser(account) });
    } catch (error) {
      if (error.status) {
        json(response, error.status, { error: error.message });
        return;
      }
      console.error("Échec de la connexion:", error.code || "ERREUR", error.message || "");
      json(response, 503, { error: "Service de connexion indisponible. Vérifiez la connexion à la base de données." });
    }
    return;
  }

  if (request.method === "GET" && pathname === `${apiPrefix}/auth/me`) {
    const account = readToken(request);
    if (!account) {
      json(response, 401, { error: "Session absente ou expirée." });
      return;
    }
    json(response, 200, { user: publicUser(account) });
    return;
  }

  if (request.method === "GET" && pathname === `${apiPrefix}/health`) {
    try {
      await pool.query("SELECT 1");
      json(response, 200, { api: "ok", database: "connected" });
    } catch (error) {
      console.error("Connexion PostgreSQL impossible:", error.code || "ERREUR", error.message || "");
      json(response, 503, { api: "ok", database: "unavailable" });
    }
    return;
  }

  json(response, 404, { error: "Route introuvable" });
});

server.listen(port, () => {
  console.log(`Backend Securitec démarré sur http://localhost:${port}`);
  console.log(`Vérification API/base : http://localhost:${port}/api/health`);
});

async function shutdown() {
  server.close();
  await pool.end();
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
