import { getRequestUser } from "../utils/auth.js";
import { json, readJson } from "../utils/helpers.js";

const collectionPath = "/api/providers";
const entryPath = /^\/api\/providers\/([0-9a-f-]{36})$/i;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clean = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";

async function authorize(request, pool, secret, adminOnly = true) {
  const tokenUser = getRequestUser(request, secret);
  if (!tokenUser) throw Object.assign(new Error("Connectez-vous pour gérer les prestataires."), { status: 401 });
  const result = await pool.query("SELECT role FROM utilisateur WHERE id=$1::uuid AND actif=true", [tokenUser.id]);
  if (!result.rows[0]) throw Object.assign(new Error("Utilisateur introuvable."), { status: 401 });
  if (adminOnly && result.rows[0].role !== 1) throw Object.assign(new Error("Seul un administrateur peut gérer les prestataires."), { status: 403 });
}

function providerName(body) {
  const name = clean(body.name, 160);
  if (!name) throw Object.assign(new Error("Le nom du prestataire est obligatoire."), { status: 400 });
  return name;
}

export async function handleProviderRoutes(request, response, pool, pathname, jwtSecret) {
  const entryMatch = entryPath.exec(pathname);
  if (pathname !== collectionPath && !entryMatch) return false;
  try {
    await authorize(request, pool, jwtSecret, !(request.method === "GET" && pathname === collectionPath));
    if (request.method === "GET" && pathname === collectionPath) {
      const result = await pool.query(
        `SELECT p.id,p.nom AS name,p.actif AS active,
          (SELECT COUNT(*)::int FROM employe e WHERE e.prestataire_id=p.id) AS "employeeCount",
          (SELECT COUNT(*)::int FROM materiel_sous_traitant m WHERE m.prestataire_id=p.id)
            + (SELECT COUNT(*)::int FROM materiel_star sm WHERE sm.prestataire_id=p.id) AS "materialCount"
         FROM prestataire p ORDER BY p.actif DESC,p.nom`,
      );
      json(response, 200, { providers: result.rows });
      return true;
    }

    if (request.method === "POST" && pathname === collectionPath) {
      const name = providerName(await readJson(request));
      const duplicate = await pool.query("SELECT id FROM prestataire WHERE LOWER(nom)=LOWER($1) LIMIT 1", [name]);
      if (duplicate.rows[0]) throw Object.assign(new Error("Un prestataire portant ce nom existe déjà."), { status: 409 });
      const result = await pool.query(
        "INSERT INTO prestataire (nom,actif) VALUES ($1,true) RETURNING id,nom AS name,actif AS active",
        [name],
      );
      json(response, 201, { provider: { ...result.rows[0], employeeCount: 0, materialCount: 0 } });
      return true;
    }

    if (entryMatch && request.method === "PUT") {
      if (!uuidPattern.test(entryMatch[1])) throw Object.assign(new Error("Prestataire introuvable."), { status: 404 });
      const body = await readJson(request);
      const name = providerName(body);
      const duplicate = await pool.query("SELECT id FROM prestataire WHERE LOWER(nom)=LOWER($1) AND id<>$2::uuid LIMIT 1", [name, entryMatch[1]]);
      if (duplicate.rows[0]) throw Object.assign(new Error("Un prestataire portant ce nom existe déjà."), { status: 409 });
      const result = await pool.query(
        "UPDATE prestataire SET nom=$1,actif=COALESCE($2,actif) WHERE id=$3::uuid RETURNING id,nom AS name,actif AS active",
        [name, typeof body.active === "boolean" ? body.active : null, entryMatch[1]],
      );
      if (!result.rows[0]) throw Object.assign(new Error("Prestataire introuvable."), { status: 404 });
      json(response, 200, { provider: result.rows[0] });
      return true;
    }

    if (entryMatch && request.method === "DELETE") {
      if (!uuidPattern.test(entryMatch[1])) throw Object.assign(new Error("Prestataire introuvable."), { status: 404 });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const provider = await client.query("SELECT id FROM prestataire WHERE id=$1::uuid FOR UPDATE", [entryMatch[1]]);
        if (!provider.rows[0]) {
          await client.query("ROLLBACK");
          throw Object.assign(new Error("Prestataire introuvable."), { status: 404 });
        }
        const references = await client.query(
          `SELECT
            EXISTS(SELECT 1 FROM employe WHERE prestataire_id=$1::uuid)
            OR EXISTS(SELECT 1 FROM compte_rendu WHERE prestataire_id=$1::uuid)
            OR EXISTS(SELECT 1 FROM materiel_sous_traitant WHERE prestataire_id=$1::uuid)
            OR EXISTS(SELECT 1 FROM materiel_star WHERE prestataire_id=$1::uuid) AS used`,
          [entryMatch[1]],
        );
        if (references.rows[0].used) {
          await client.query("UPDATE prestataire SET actif=false WHERE id=$1::uuid", [entryMatch[1]]);
          await client.query("COMMIT");
          json(response, 200, { id: entryMatch[1], deleted: false, deactivated: true });
        } else {
          await client.query("DELETE FROM prestataire WHERE id=$1::uuid", [entryMatch[1]]);
          await client.query("COMMIT");
          json(response, 200, { id: entryMatch[1], deleted: true, deactivated: false });
        }
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
      return true;
    }

    json(response, 405, { error: "Méthode non autorisée." });
    return true;
  } catch (error) {
    const status = error.status || (error.code === "23505" ? 409 : 500);
    const message = error.status ? error.message
      : status === 409 ? "Un prestataire portant ce nom existe déjà."
        : "Opération sur les prestataires impossible.";
    console.error("Provider route failed:", error.code || error.name, error.message || "");
    json(response, status, { error: message });
    return true;
  }
}
