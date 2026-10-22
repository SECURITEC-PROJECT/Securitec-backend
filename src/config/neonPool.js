import "dotenv/config";
import { lookup } from "node:dns/promises";
import pg from "pg";
import { parse } from "pg-connection-string";

const { Pool } = pg;
const DNS_TIMEOUT_MS = 1_000;
// Le délai de checkout couvre aussi l'attente dans la file lorsque plusieurs
// modules chargent en même temps. 3,5 s provoquait des erreurs sous charge.
const CONNECT_TIMEOUT_MS = 10_000;
const QUERY_TIMEOUT_MS = 15_000;
const POOL_MAX = 10;
let sharedPoolPromise;
let poolResetPromise;

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
      idleTimeoutMillis: 30_000,
      max: POOL_MAX,
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
      "Connexion Neon dépassée (10 s).",
    );
  } catch (error) {
    for (const candidate of pools) void candidate.end().catch(() => {});
    throw new AggregateError([error], "Impossible de joindre Neon en moins de 10 secondes.");
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

/** Re-resolve Neon and rebuild the pool after a stale or dropped connection. */
export function resetNeonPool(failedPool) {
  if (poolResetPromise) return poolResetPromise;

  poolResetPromise = (async () => {
    const previousPromise = sharedPoolPromise;
    const currentPool = previousPromise ? await previousPromise.catch(() => null) : null;

    // Another request may already have replaced the failed pool.
    if (failedPool && currentPool && currentPool !== failedPool) return currentPool;
    if (sharedPoolPromise === previousPromise) sharedPoolPromise = undefined;
    return getNeonPool();
  })().finally(() => {
    poolResetPromise = undefined;
  });

  return poolResetPromise;
}
