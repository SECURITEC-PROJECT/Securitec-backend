import { getRequestUser } from "../utils/auth.js";
import { json } from "../utils/helpers.js";

const pathPattern = /^\/api\/register-audit\/([a-z_]+)\/([0-9a-f-]{36})$/i;
const siteEntities = new Set([
  "mouvement_velo", "mouvement_moto", "mouvement_courrier", "passage_vehicule",
  "controle_alcoolemie", "passation", "materiel_sous_traitant", "materiel_star",
]);

export async function handleRegisterAuditRoutes(request, response, pool, pathname, jwtSecret) {
  const match = pathPattern.exec(pathname);
  if (!match) return false;
  if (request.method !== "GET") {
    json(response, 405, { error: "Méthode non autorisée." });
    return true;
  }
  const user = getRequestUser(request, jwtSecret);
  if (!user) {
    json(response, 401, { error: "Connectez-vous pour consulter l’historique du registre." });
    return true;
  }
  try {
    const account = await pool.query("SELECT role,site_id FROM utilisateur WHERE id=$1::uuid AND actif=true LIMIT 1", [user.id]);
    if (!account.rows[0]) return json(response, 401, { error: "Utilisateur introuvable." });
    const [entity, id] = [match[1], match[2]];
    if (!siteEntities.has(entity) && entity !== "prestataire") return json(response, 404, { error: "Registre inconnu." });
    if (entity === "prestataire" && account.rows[0].role !== 1) return json(response, 403, { error: "Seul un administrateur peut consulter cet historique." });
    const result = await pool.query(
      `SELECT a.id,a.action,a.avant,a.apres,a.cree_le AS "createdAt",
              u.nom AS "userName"
       FROM audit_registre a LEFT JOIN utilisateur u ON u.id=a.utilisateur_id
       WHERE a.entite=$1 AND a.entite_id=$2
         AND ($3::int=1 OR a.site_id=$4::uuid)
       ORDER BY a.cree_le DESC LIMIT 100`,
      [entity, id, account.rows[0].role, account.rows[0].site_id],
    );
    json(response, 200, { entries: result.rows });
  } catch (error) {
    console.error("GET register audit failed:", error.code || error.name, error.message || "");
    json(response, 500, { error: "Impossible de charger l’historique du registre." });
  }
  return true;
}
