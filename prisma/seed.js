import "dotenv/config";
import { setDefaultResultOrder } from "node:dns";
import bcrypt from "bcryptjs";
import { createNeonPool } from "../src/config/neonPool.js";

setDefaultResultOrder("ipv4first");
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

async function main() {
  const nom = process.env.SEED_USER_NAME?.trim();
  const identifiant = process.env.SEED_USER_IDENTIFIER?.trim();
  const pin = process.env.SEED_USER_PIN;
  const roleRaw = process.env.SEED_USER_ROLE;
  const siteRaw = process.env.SEED_USER_SITE_ID?.trim() || "";

  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL est absent du fichier .env.");
  const missing = [
    ["SEED_USER_NAME", nom],
    ["SEED_USER_IDENTIFIER", identifiant],
    ["SEED_USER_ROLE", roleRaw],
    ["SEED_USER_PIN", pin],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) throw new Error(`Variable(s) absente(s) dans .env : ${missing.join(", ")}.`);

  const role = Number(roleRaw);
  if (!Number.isSafeInteger(role)) throw new Error("SEED_USER_ROLE doit être un entier.");
  if (!/^\d{6}$/.test(pin)) throw new Error("SEED_USER_PIN doit contenir exactement 6 chiffres.");
  if (siteRaw && !uuidPattern.test(siteRaw)) throw new Error("SEED_USER_SITE_ID doit être un UUID valide ou rester vide.");

  const pinHache = await bcrypt.hash(pin, 12);
  const pool = await createNeonPool();
  try {
    const result = await pool.query(
      `INSERT INTO utilisateur (nom, identifiant, role, pin_hache, site_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (identifiant) DO UPDATE
       SET nom = EXCLUDED.nom,
           role = EXCLUDED.role,
           pin_hache = EXCLUDED.pin_hache,
           site_id = EXCLUDED.site_id
       RETURNING id`,
      [nom, identifiant, role, pinHache, siteRaw || null],
    );
    console.log(`Utilisateur seed créé ou mis à jour : ${identifiant} (id ${result.rows[0].id}).`);
  } finally {
    await pool.end();
  }
}

try {
  await main();
} catch (error) {
  console.error(`Échec du seed utilisateur : ${error.message || error.name || "erreur inconnue"}`);
  if (error.code) console.error(`Code PostgreSQL/réseau : ${error.code}`);
  logNetworkCauses(error);
  const causes = error.errors || error.cause?.errors || (error.cause ? [error.cause] : []);
  for (const cause of causes) {
    const destination = cause.address ? ` vers ${cause.address}${cause.port ? `:${cause.port}` : ""}` : "";
    console.error(`Détail connexion : ${cause.code || cause.name || "erreur"}${destination}${cause.message ? ` — ${cause.message}` : ""}`);
  }
  process.exitCode = 1;
}
