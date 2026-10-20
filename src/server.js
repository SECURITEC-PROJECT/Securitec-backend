import "dotenv/config";
import { setDefaultResultOrder } from "node:dns";
import { createServer } from "node:http";
import pool from "../config/db.js";
import { handleApiRoutes } from "../routes/apiRoutes.js";
import { json } from "../utils/helpers.js"; 

setDefaultResultOrder("ipv4first");
const port = Number(process.env.PORT || 5000);
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || Buffer.byteLength(jwtSecret) < 32) {
  throw new Error("JWT_SECRET doit être défini dans le fichier .env avec au moins 32 caractères.");
}

const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS || "http://localhost:5173,http://localhost:5175")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

function getPool() {
  if (!pool) {
    throw new Error("Le pool de base de données n'est pas initialisé dans config/db.js");
  }
  return pool;
}

const server = createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }

  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }

  const poolInstance = getPool();
  const handled = await handleApiRoutes(request, response, poolInstance, jwtSecret);

  if (!handled) {
    json(response, 404, { error: "Route introuvable" });
  }
});

server.listen(port, () => {
  console.log(`Backend Securitec démarré sur http://localhost:${port}`);
  console.log(`Vérification API/base : http://localhost:${port}/api/health`);
});

async function shutdown() {
  server.close();
  try {
    const poolInstance = getPool();
    if (poolInstance && typeof poolInstance.end === "function") {
      await poolInstance.end();
    }
  } catch {}
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());