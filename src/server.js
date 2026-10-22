import "dotenv/config";
import { setDefaultResultOrder } from "node:dns";
import { createServer } from "node:http";
import { getNeonPool } from "./config/neonPool.js";
import databasePool from "../config/db.js";
import { handleApiRoutes } from "../routes/apiRoutes.js";
import { json } from "../utils/helpers.js";

setDefaultResultOrder("ipv4first");
const port = Number(process.env.PORT || 5000);
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || Buffer.byteLength(jwtSecret) < 32) {
  throw new Error("JWT_SECRET must be set to at least 32 characters.");
}

const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS || "http://localhost:5173,http://localhost:5175")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

let databaseReady = false;

const server = createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Site-Id, X-File-Name, X-File-Category");
  }

  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }

  try {
    const pathname = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`).pathname;
    if (!databaseReady) {
      const isHealth = request.method === "GET" && pathname === "/api/health";
      json(response, 503, isHealth
        ? { api: "ok", database: "unavailable" }
        : { error: "Base de données temporairement indisponible. Réessayez dans quelques secondes." });
      return;
    }
    const handled = await handleApiRoutes(request, response, databasePool, jwtSecret);
    if (!handled && !response.headersSent && !response.writableEnded) {
      json(response, 404, { error: "Route not found" });
    }
  } catch (error) {
    console.error("Unhandled API request error:", error.code || error.name, error.message || "");
    if (!response.headersSent && !response.writableEnded) {
      json(response, 500, { error: "Erreur interne du serveur." });
    }
  }
});

let databaseConnecting = false;
let retryTimer;

async function connectDatabase() {
  if (databaseConnecting || databaseReady) return;
  databaseConnecting = true;
  try {
    await getNeonPool();
    databaseReady = true;
    console.log("Base de données prête.");
  } catch (error) {
    console.error("Connexion à la base échouée; nouvelle tentative dans 1 s:", error.message || error);
    retryTimer = setTimeout(() => void connectDatabase(), 1_000);
    retryTimer.unref();
  } finally {
    databaseConnecting = false;
  }
}

server.listen(port, "0.0.0.0", () => {
  console.log(`Securitec backend listening on port ${port}`);
  console.log("Health check: /api/health");
  void connectDatabase();
});

async function shutdown() {
  if (retryTimer) clearTimeout(retryTimer);
  server.close();
  try {
  if (databaseReady) await databasePool.end();
  } catch {}
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
