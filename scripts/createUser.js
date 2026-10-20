import "dotenv/config";
import { setDefaultResultOrder } from "node:dns";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import bcrypt from "bcryptjs";
import { createNeonPool } from "../src/config/neonPool.js";

setDefaultResultOrder("ipv4first");
const readline = createInterface({ input: stdin, output: stdout });

async function askHiddenPin() {
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    throw new Error("Exécutez cette commande dans un terminal interactif Git Bash.");
  }

  stdout.write("PIN à 6 chiffres (saisie masquée) : ");
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let pin = "";
    const finish = (error) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
      if (error) reject(error);
      else resolve(pin);
    };
    const onData = (buffer) => {
      for (const key of buffer) {
        if (key === 3) return finish(new Error("Opération annulée."));
        if (key === 13 || key === 10) return finish();
        if (key === 8 || key === 127) pin = pin.slice(0, -1);
        else if (key >= 48 && key <= 57 && pin.length < 6) pin += String.fromCharCode(key);
      }
    };
    stdin.on("data", onData);
  });
}

try {
  const nom = (await readline.question("Nom complet : ")).trim();
  const identifiant = (await readline.question("Identifiant de connexion : ")).trim();
  const role = Number(await readline.question("Code rôle numérique : "));
  const siteIdInput = (await readline.question("UUID du site (laisser vide si aucun) : ")).trim();
  readline.close();

  const pin = await askHiddenPin();
  if (!nom || !identifiant || !Number.isInteger(role) || !/^\d{6}$/.test(pin)) {
    throw new Error("Nom, identifiant, code rôle entier et PIN à 6 chiffres sont requis.");
  }
  const siteId = siteIdInput || null;
  const pinHache = await bcrypt.hash(pin, 12);
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL est absent du fichier .env.");
  const pool = await createNeonPool();
  try {
    await pool.query(
      `INSERT INTO utilisateur (nom, identifiant, role, pin_hache, site_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [nom, identifiant, role, pinHache, siteId],
    );
  } finally {
    await pool.end();
  }
  console.log(`Compte créé pour « ${identifiant} ».`);
} catch (error) {
  if (error?.code === "ETIMEDOUT") {
    console.error("Délai dépassé pendant la connexion à Neon.");
  } else if (["ECONNREFUSED", "ENETUNREACH", "EACCES"].includes(error?.code)) {
    console.error(`Connexion à Neon impossible (${error.code}). Vérifiez le réseau et l'accès HTTPS.`);
  } else if (error?.code === "23505") {
    console.error("Cet identifiant existe déjà dans la table utilisateur.");
  } else {
    console.error(error?.message || "Création du compte impossible.");
  }
  if (error?.code && !["ETIMEDOUT", "ECONNREFUSED", "ENETUNREACH", "EACCES", "23505"].includes(error.code)) {
    console.error(`Code PostgreSQL/réseau : ${error.code}`);
  }
  process.exitCode = 1;
} finally {
  readline.close();
}
