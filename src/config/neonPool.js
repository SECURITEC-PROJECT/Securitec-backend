import "dotenv/config";
import { lookup } from "node:dns/promises";
import pg from "pg";
import { parse } from "pg-connection-string";

const { Pool } = pg;
const DNS_TIMEOUT_MS = 1_000;
const CONNECT_TIMEOUT_MS = 3_500;
const QUERY_TIMEOUT_MS = 15_000;
let sharedPoolPromise;

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

/** Resolves Neon IPv4 addresses and races connections for a quick startup. */
export async function createNeonPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL est absent du fichier .env.");

  const normalizedUrl = new URL(connectionString);
  if (normalizedUrl.searchParams.get("sslmode") === "require") {
    normalizedUrl.searchParams.set("sslmode", "verify-full");
  }
  const baseConfig = parse(normalizedUrl.toString());
  const hostname = baseConfig.host;
  const addresses = await withTimeout(
    lookup(hostname, { all: true, family: 4 }),
    DNS_TIMEOUT_MS,
    "Résolution DNS Neon dépassée (1 s).",
  );
  if (!addresses.length) throw new Error("Neon ne fournit aucune adresse IPv4 pour DATABASE_URL.");

  let winner;
  const pools = [];
  const attempts = addresses.map(({ address }) => (async () => {
    const pool = new Pool({
      ...baseConfig,
      host: address,
      ssl: {
        ...(baseConfig.ssl && typeof baseConfig.ssl === "object" ? baseConfig.ssl : {}),
        servername: hostname,
        rejectUnauthorized: true,
      },
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
      query_timeout: QUERY_TIMEOUT_MS,
      statement_timeout: QUERY_TIMEOUT_MS,
      max: 5,
    });
    pools.push(pool);
    try {
      await pool.query("SELECT 1");
      return pool;
    } catch (error) {
      await pool.end().catch(() => {});
      throw error;
    }
  })());

  try {
    winner = await withTimeout(
      Promise.any(attempts),
      CONNECT_TIMEOUT_MS,
      "Connexion Neon dépassée (3,5 s).",
    );
  } catch (error) {
    for (const candidate of pools) void candidate.end().catch(() => {});
    throw new AggregateError([error], "Impossible de joindre Neon rapidement.");
  }

  for (const attempt of attempts) {
    attempt.then((candidate) => {
      if (candidate !== winner) void candidate.end().catch(() => {});
    }).catch(() => {});
  }
  console.log("Connexion Neon établie.");
  return winner;
}

export function getNeonPool() {
  if (!sharedPoolPromise) {
    sharedPoolPromise = createNeonPool().catch((error) => {
      sharedPoolPromise = undefined;
      throw error;
    });
  }
  return sharedPoolPromise;
}
