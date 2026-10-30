import { getRequestUser } from "../utils/auth.js";
import bcrypt from "bcryptjs";
import { json, readJson } from "../utils/helpers.js";

const path = "/api/users";
const idPattern = /^\/api\/users\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

function readUserFields(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 255) : "";
  const identifier = typeof body.identifier === "string" ? body.identifier.trim().toLocaleLowerCase().slice(0, 100) : "";
  const role = Number(body.role);
  const siteId = typeof body.siteId === "string" && body.siteId ? body.siteId : null;
  const pin = typeof body.pin === "string" ? body.pin : "";
  if (!name || !identifier || ![1, 2, 3, 4, 5].includes(role)) return { error: "Indiquez le nom, l’identifiant et un rôle valide." };
  if (pin && !/^\d{6}$/.test(pin)) return { error: "Le PIN doit contenir exactement 6 chiffres." };
  if (!body.allowEmptyPin && !/^\d{6}$/.test(pin)) return { error: "Le PIN doit contenir exactement 6 chiffres." };
  if (role !== 1 && !siteId) return { error: "Un site est obligatoire pour ce profil." };
  if (siteId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(siteId)) {
    return { error: "Le site sélectionné est invalide." };
  }
  return { name, identifier, role, siteId, pin };
}

export async function handleUserRoutes(request, response, pool, pathname, jwtSecret) {
  const idMatch = idPattern.exec(pathname);
  if (pathname !== path && !idMatch) return false;
  if ((pathname === path && !["GET", "POST"].includes(request.method)) || (idMatch && !["PUT", "DELETE"].includes(request.method))) {
    json(response, 405, { error: "Méthode non autorisée." });
    return true;
  }

  const tokenUser = getRequestUser(request, jwtSecret);
  if (!tokenUser) {
    json(response, 401, { error: "Connectez-vous pour consulter les utilisateurs." });
    return true;
  }

  try {
    const account = await pool.query("SELECT role FROM utilisateur WHERE id=$1::uuid AND actif=true LIMIT 1", [tokenUser.id]);
    if (!account.rows[0]) {
      json(response, 401, { error: "Utilisateur introuvable." });
      return true;
    }
    if (account.rows[0].role !== 1) {
      json(response, 403, { error: "Seul un administrateur peut consulter les utilisateurs." });
      return true;
    }

    if (request.method === "POST") {
      const body = await readJson(request);
      const fields = readUserFields(body);
      if (!fields || fields.error) { json(response, 400, { error: fields?.error || "Les informations du compte sont invalides." }); return true; }
      const { name, identifier, role, pin, siteId } = fields;
      if (siteId && !(await pool.query("SELECT id FROM site WHERE id=$1::uuid AND actif=true LIMIT 1", [siteId])).rows[0]) {
        json(response, 400, { error: "Le site sélectionné est introuvable ou inactif." }); return true;
      }
      if ((await pool.query("SELECT 1 FROM utilisateur WHERE LOWER(identifiant)=LOWER($1) LIMIT 1", [identifier])).rows[0]) {
        json(response, 409, { error: "Cet identifiant existe déjà." }); return true;
      }
      const pinHash = await bcrypt.hash(pin, 12);
      try {
        const result = await pool.query(
          `INSERT INTO utilisateur (nom, identifiant, role, pin_hache, site_id)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, nom AS name, identifiant AS identifier, role, site_id AS "siteId"`,
          [name, identifier, role, pinHash, siteId],
        );
        const user = result.rows[0];
        const site = siteId ? await pool.query("SELECT nom AS \"siteName\" FROM site WHERE id=$1::uuid", [siteId]) : null;
        json(response, 201, { user: { ...user, siteName: site?.rows[0]?.siteName || null } });
      } catch (error) {
        if (error.code === "23505") {
          json(response, 409, { error: "Cet identifiant existe déjà." });
          return true;
        }
        throw error;
      }
      return true;
    }

    if (request.method === "PUT" && idMatch) {
      const body = await readJson(request);
      const fields = readUserFields({ ...body, allowEmptyPin: true });
      if (!fields || fields.error) { json(response, 400, { error: fields?.error || "Les informations du compte sont invalides." }); return true; }
      const { name, identifier, role, pin, siteId } = fields;
      const target = await pool.query("SELECT id, role FROM utilisateur WHERE id=$1::uuid AND actif=true LIMIT 1", [idMatch[1]]);
      if (!target.rows[0]) { json(response, 404, { error: "Utilisateur introuvable." }); return true; }
      if (siteId && !(await pool.query("SELECT id FROM site WHERE id=$1::uuid AND actif=true LIMIT 1", [siteId])).rows[0]) {
        json(response, 400, { error: "Le site sélectionné est introuvable ou inactif." }); return true;
      }
      if ((await pool.query("SELECT 1 FROM utilisateur WHERE LOWER(identifiant)=LOWER($1) AND id<>$2::uuid LIMIT 1", [identifier, idMatch[1]])).rows[0]) {
        json(response, 409, { error: "Cet identifiant existe déjà." }); return true;
      }
      if (Number(target.rows[0].role) === 1 && role !== 1) {
        const admins = await pool.query("SELECT COUNT(*)::int AS count FROM utilisateur WHERE role=1 AND actif=true");
        if (admins.rows[0].count <= 1) { json(response, 409, { error: "Le dernier administrateur ne peut pas être rétrogradé." }); return true; }
        if (idMatch[1] === tokenUser.id) { json(response, 400, { error: "Vous ne pouvez pas retirer votre propre rôle administrateur." }); return true; }
      }
      const pinHash = pin ? await bcrypt.hash(pin, 12) : null;
      const result = await pool.query(
        `UPDATE utilisateur SET nom=$1, identifiant=$2, role=$3, site_id=$4,
           pin_hache=COALESCE($5, pin_hache)
         WHERE id=$6::uuid AND actif=true
         RETURNING id, nom AS name, identifiant AS identifier, role, site_id AS "siteId"`,
        [name, identifier, role, siteId, pinHash, idMatch[1]],
      );
      const user = result.rows[0];
      const site = siteId ? await pool.query("SELECT nom AS \"siteName\" FROM site WHERE id=$1::uuid", [siteId]) : null;
      json(response, 200, { user: { ...user, siteName: site?.rows[0]?.siteName || null } });
      return true;
    }

    if (request.method === "DELETE" && idMatch) {
      if (idMatch[1] === tokenUser.id) { json(response, 400, { error: "Vous ne pouvez pas supprimer votre propre compte." }); return true; }
      const target = await pool.query("SELECT id, role FROM utilisateur WHERE id=$1::uuid AND actif=true LIMIT 1", [idMatch[1]]);
      if (!target.rows[0]) { json(response, 404, { error: "Utilisateur introuvable." }); return true; }
      if (Number(target.rows[0].role) === 1) {
        const admins = await pool.query("SELECT COUNT(*)::int AS count FROM utilisateur WHERE role=1 AND actif=true");
        if (admins.rows[0].count <= 1) { json(response, 409, { error: "Le dernier administrateur ne peut pas être supprimé." }); return true; }
      }
      await pool.query("UPDATE utilisateur SET actif=false WHERE id=$1::uuid AND actif=true", [idMatch[1]]);
      json(response, 200, { id: idMatch[1], deleted: true });
      return true;
    }

    const result = await pool.query(
      `SELECT u.id, u.nom AS name, u.identifiant AS identifier, u.role,
              u.site_id AS "siteId", s.nom AS "siteName"
       FROM utilisateur u
       LEFT JOIN site s ON s.id = u.site_id
       WHERE u.actif=true
       ORDER BY u.nom, u.identifiant`,
    );
    json(response, 200, { users: result.rows });
  } catch (error) {
    console.error("/api/users failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, { error: error.status ? error.message : "Opération sur les utilisateurs impossible." });
  }
  return true;
}
