import dotenv from "dotenv";
import pg from "pg";
import { fileURLToPath } from "node:url";

dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

const { Client } = pg;

for (const key of ["DATABASE_URL", "DIRECT_URL", "SHADOW_DATABASE_URL"]) {
  const url = process.env[key];
  if (!url) {
    console.log(`${key}: absente`);
    continue;
  }

  const client = new Client({ connectionString: url, connectionTimeoutMillis: 60000 });
  try {
    await client.connect();
    const result = await client.query("SELECT current_database() AS database, version() AS version");
    console.log(`${key}: connexion réussie (${result.rows[0].database}; ${result.rows[0].version.split(" ").slice(0, 2).join(" ")})`);
  } catch (error) {
    console.log(`${key}: échec (${error.code || "sans code"}) ${error.message}`);
  } finally {
    await client.end().catch(() => {});
  }
}
