import "dotenv/config";
import { setDefaultResultOrder } from "node:dns";
import { createNeonPool } from "../src/config/neonPool.js";

setDefaultResultOrder("ipv4first");

function logNetworkCauses(error) {
  const pending = [error.sourceError || error.cause, ...(error.errors || [])].filter(Boolean);
  const seen = new Set();
  while (pending.length) {
    const current = pending.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    console.error(`Cause réseau : ${current.code || current.name || "erreur"} — ${current.message || ""}`);
    if (current.cause) pending.push(current.cause);
    if (Array.isArray(current.errors)) pending.push(...current.errors);
  }
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL est absent du fichier .env.");
  process.exit(1);
}

try {
  const pool = await createNeonPool();
  try {
    const result = await pool.query("SELECT current_database() AS database");
    console.log(`Connexion PostgreSQL OK — base : ${result.rows[0].database}`);
  } finally {
    await pool.end();
  }
} catch (error) {
  console.error(`Connexion PostgreSQL échouée : ${error.message || error.name || "erreur inconnue"}`);
  if (error.code) console.error(`Code : ${error.code}`);
  if (error.status) console.error(`HTTP ${error.status}`);
  logNetworkCauses(error);
  process.exitCode = 1;
}
