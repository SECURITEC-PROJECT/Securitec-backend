import { lookup } from "node:dns/promises";
import pg from "pg";
import { parse } from "pg-connection-string";

const { Pool } = pg;

/** Tries Neon IPv4 addresses with TLS verification and Neon hostname SNI. */
export async function createNeonPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL est absent du fichier .env.");

  const normalizedUrl = new URL(connectionString);
  if (normalizedUrl.searchParams.get("sslmode") === "require") {
    normalizedUrl.searchParams.set("sslmode", "verify-full");
  }
  const baseConfig = parse(normalizedUrl.toString());
  const hostname = baseConfig.host;
  const addresses = await lookup(hostname, { all: true, family: 4 });
  if (!addresses.length) throw new Error("Neon ne fournit aucune adresse IPv4 pour DATABASE_URL.");

  const errors = [];
  for (const { address } of addresses) {
    const pool = new Pool({
      ...baseConfig,
      host: address,
      ssl: {
        ...(baseConfig.ssl && typeof baseConfig.ssl === "object" ? baseConfig.ssl : {}),
        servername: hostname,
        rejectUnauthorized: true,
      },
      connectionTimeoutMillis: 5000,
      max: 5,
    });
    try {
      await pool.query("SELECT 1");
      console.log(`Connexion Neon établie via IPv4 ${address}.`);
      return pool;
    } catch (error) {
      errors.push(error);
      await pool.end().catch(() => {});
    }
  }
  throw new AggregateError(errors, "Impossible de joindre Neon sur les adresses IPv4 résolues.");
}
