import { getRequestUser } from "../utils/auth.js";
import { json, readJson } from "../utils/helpers.js";

const path = "/api/employees";
const clean = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";

async function authorize(request, pool, secret) {
  const tokenUser = getRequestUser(request, secret);
  if (!tokenUser) throw Object.assign(new Error("Connectez-vous pour gérer les employés."), { status: 401 });
  const result = await pool.query("SELECT role FROM utilisateur WHERE id=$1::uuid", [tokenUser.id]);
  if (!result.rows[0]) throw Object.assign(new Error("Utilisateur introuvable."), { status: 401 });
  if (result.rows[0].role !== 1) throw Object.assign(new Error("Seul un administrateur peut gérer les employés."), { status: 403 });
}

function employeeValues(body) {
  const firstName = clean(body.firstName, 100);
  const lastName = clean(body.lastName, 100);
  const matricule = clean(body.matricule, 50);
  const provider = clean(body.provider, 160);
  const siteId = clean(body.siteId, 36);
  if (!firstName || !lastName || !matricule || !provider || !/^[0-9a-f-]{36}$/i.test(siteId)) {
    throw Object.assign(new Error("Prénom, nom, matricule, prestataire et site sont obligatoires."), { status: 400 });
  }
  return { firstName, lastName, matricule, provider, siteId };
}

export async function handleEmployeeRoutes(request, response, pool, pathname, jwtSecret) {
  const idMatch = /^\/api\/employees\/([0-9a-f-]{36})$/i.exec(pathname);
  const lookupMatch = /^\/api\/employees\/by-matricule\/([^/]+)$/i.exec(pathname);
  if (pathname !== path && !idMatch && !lookupMatch) return false;
  try {
    if (lookupMatch && request.method === "GET") {
      const user = getRequestUser(request, jwtSecret);
      if (!user) throw Object.assign(new Error("Connectez-vous pour rechercher un employé."), { status: 401 });
      const matricule = decodeURIComponent(lookupMatch[1]).trim();
      const result = await pool.query(`SELECT a.id,a.prenom AS "firstName",a.nom AS "lastName",a.matricule,
        p.nom AS provider,s.id AS "siteId",s.nom AS "siteName",COALESCE(s.actif,false) AS "siteActive",a.actif AS active
        FROM agent a JOIN prestataire p ON p.id=a.prestataire_id
        LEFT JOIN site s ON s.id=a.site_id WHERE UPPER(a.matricule)=UPPER($1) LIMIT 1`, [matricule]);
      const employee = result.rows[0];
      if (!employee) throw Object.assign(new Error("Aucun employé trouvé pour ce matricule."), { status: 404 });
      json(response, 200, { employee }); return true;
    }
    await authorize(request, pool, jwtSecret);
    if (pathname === path && request.method === "GET") {
      const result = await pool.query(`SELECT a.id,a.prenom AS "firstName",a.nom AS "lastName",a.matricule,a.actif AS active,
        p.id AS "providerId",p.nom AS provider,a.site_id AS "siteId",s.nom AS "siteName"
        FROM agent a JOIN prestataire p ON p.id=a.prestataire_id LEFT JOIN site s ON s.id=a.site_id
        ORDER BY a.actif DESC,a.nom,a.prenom`);
      json(response, 200, { employees: result.rows }); return true;
    }
    if (pathname === path && request.method === "POST") {
      const values = employeeValues(await readJson(request));
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const site = await client.query("SELECT id FROM site WHERE id=$1::uuid AND actif=true", [values.siteId]);
        if (!site.rows[0]) throw Object.assign(new Error("Site introuvable ou archivé."), { status: 404 });
        const provider = await client.query("INSERT INTO prestataire (nom) VALUES ($1) ON CONFLICT (nom) DO UPDATE SET actif=true RETURNING id", [values.provider]);
        const employee = await client.query(`INSERT INTO agent (prenom,nom,matricule,prestataire_id,site_id) VALUES ($1,$2,$3,$4::uuid,$5::uuid)
          RETURNING id,prenom AS "firstName",nom AS "lastName",matricule,actif AS active,site_id AS "siteId"`, [values.firstName, values.lastName, values.matricule, provider.rows[0].id, values.siteId]);
        const siteName = await client.query("SELECT nom FROM site WHERE id=$1::uuid", [values.siteId]);
        await client.query("COMMIT");
        json(response, 201, { employee: { ...employee.rows[0], providerId: provider.rows[0].id, provider: values.provider, siteName: siteName.rows[0].nom } });
      } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
      finally { client.release(); }
      return true;
    }
    if (idMatch && request.method === "PUT") {
      const values = employeeValues(await readJson(request));
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const site = await client.query("SELECT id FROM site WHERE id=$1::uuid AND actif=true", [values.siteId]);
        if (!site.rows[0]) throw Object.assign(new Error("Site introuvable ou archivé."), { status: 404 });
        const provider = await client.query("INSERT INTO prestataire (nom) VALUES ($1) ON CONFLICT (nom) DO UPDATE SET actif=true RETURNING id", [values.provider]);
        const employee = await client.query(`UPDATE agent SET prenom=$1,nom=$2,matricule=$3,prestataire_id=$4::uuid,site_id=$5::uuid WHERE id=$6::uuid
          RETURNING id,prenom AS "firstName",nom AS "lastName",matricule,actif AS active,site_id AS "siteId"`, [values.firstName, values.lastName, values.matricule, provider.rows[0].id, values.siteId, idMatch[1]]);
        if (!employee.rows[0]) throw Object.assign(new Error("Employé introuvable."), { status: 404 });
        const siteName = await client.query("SELECT nom FROM site WHERE id=$1::uuid", [values.siteId]);
        await client.query("COMMIT");
        json(response, 200, { employee: { ...employee.rows[0], providerId: provider.rows[0].id, provider: values.provider, siteName: siteName.rows[0].nom } });
      } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
      finally { client.release(); }
      return true;
    }
    if (idMatch && request.method === "PATCH") {
      const body = await readJson(request);
      if (typeof body.active !== "boolean") throw Object.assign(new Error("État d’employé invalide."), { status: 400 });
      const result = await pool.query("UPDATE agent SET actif=$1 WHERE id=$2::uuid RETURNING id,actif AS active", [body.active, idMatch[1]]);
      if (!result.rows[0]) throw Object.assign(new Error("Employé introuvable."), { status: 404 });
      json(response, 200, { employee: result.rows[0] }); return true;
    }
    json(response, 405, { error: "Méthode non autorisée." }); return true;
  } catch (error) {
    const status = error.status || (error.code === "23505" ? 409 : 500);
    const message = error.status ? error.message : error.code === "23505" ? "Ce matricule est déjà utilisé." : "Opération sur les employés impossible.";
    console.error("Employee route failed:", error.code || error.name, error.message || "");
    json(response, status, { error: message }); return true;
  }
}
