import "dotenv/config";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pkg from "pg";

const pool = new pkg.Pool({
  connectionString: process.env.DATABASE_URL,
  // ssl: { rejectUnauthorized: false }, // à décommenter si la base distante exige SSL
});

if (process.env.NODE_ENV === "production") {
  console.error("Seed de test interdit en production");
  process.exit(1);
}

const dir = path.dirname(fileURLToPath(import.meta.url));
const target = process.argv[2]; // ex: "sites"

const all = (await readdir(dir))
  .filter((f) => /^\d+_.+\.js$/.test(f))
  .sort();

const selected = target ? all.filter((f) => f.includes(target)) : all;

if (selected.length === 0) {
  console.error(`Aucun fichier de seed trouvé pour "${target}"`);
  await pool.end();
  process.exit(1);
}

try {
  for (const file of selected) {
    console.log(`▶ ${file}`);
    const mod = await import(pathToFileURL(path.join(dir, file)).href);
    await mod.default(pool);
  }
  console.log("✔ Seed terminé");
} catch (e) {
  console.error("✖ Erreur pendant le seed :", e);
  process.exitCode = 1;
} finally {
  await pool.end();
}
