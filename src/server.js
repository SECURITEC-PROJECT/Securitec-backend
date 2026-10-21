import "dotenv/config";
import { setDefaultResultOrder } from "node:dns";
import { createServer } from "node:http";
import { createNeonPool } from "./config/neonPool.js";
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

let pool;

const server = createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }

  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }

  try {
    const handled = await handleApiRoutes(request, response, pool, jwtSecret);
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

async function startServer() {
  pool = await createNeonPool();
  server.listen(port, () => {
    console.log(`Securitec backend listening on port ${port}`);
    console.log("Health check: /api/health");
  });
}

startServer().catch((error) => {
  console.error("Backend startup or Neon connection failed:", error.message || error);
  process.exitCode = 1;
});

async function shutdown() {
  server.close();
  try {
    if (pool && typeof pool.end === "function") await pool.end();
  } catch {}
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
