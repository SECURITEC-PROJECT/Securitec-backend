import { getEmployeeByMatricule, getFormDataOptions } from "../controllers/employeeController.js";
import { createShift, endShift, getShiftPosts, getShifts } from "../controllers/shiftController.js";
import { getRequestUser } from "../utils/auth.js";
import { json, readJson } from "../utils/helpers.js";

export async function handleShiftRoutes(request, response, pool, pathname, jwtSecret) {
  const method = request.method;

  const requireAccount = async () => {
    const user = getRequestUser(request, jwtSecret);
    if (!user) throw Object.assign(new Error("Connectez-vous pour gérer les prises de poste."), { status: 401 });
    const result = await pool.query("SELECT id,role,site_id AS \"siteId\" FROM utilisateur WHERE id=$1::uuid AND actif=true LIMIT 1", [user.id]);
    if (!result.rows[0]) throw Object.assign(new Error("Utilisateur introuvable."), { status: 401 });
    return { user, account: result.rows[0] };
  };

  if (method === "GET" && pathname === "/api/shifts/posts") {
    try {
      const { account } = await requireAccount();
      const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
      const requestedSiteId = url.searchParams.get("siteId");
      const siteId = account.siteId && account.role !== 1 ? account.siteId : requestedSiteId;
      if (!siteId) throw Object.assign(new Error("Sélectionnez un site."), { status: 400 });
      if (account.siteId && account.role !== 1 && requestedSiteId && requestedSiteId !== account.siteId) {
        throw Object.assign(new Error("Accès refusé à ce site."), { status: 403 });
      }
      const posts = await getShiftPosts(pool, siteId);
      json(response, 200, { posts });
    } catch (error) {
      json(response, error.status || 500, { error: error.message || "Impossible de charger les postes." });
    }
    return true;
  }

  // 1. Récupérer toutes les prises de poste
  if (method === "GET" && pathname === "/api/shifts") {
    try {
      const { account } = await requireAccount();
      const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
      const requestedSiteId = url.searchParams.get("siteId");
      const siteId = account.siteId && account.role !== 1 ? account.siteId : requestedSiteId || null;
      if (account.siteId && account.role !== 1 && requestedSiteId && requestedSiteId !== account.siteId) {
        throw Object.assign(new Error("Accès refusé à ce site."), { status: 403 });
      }
      const shifts = await getShifts(request, response, pool, siteId);
      json(response, 200, shifts);
    } catch (error) {
      json(response, error.status || 500, { error: error.message || "Erreur lors de la récupération des prises de poste." });
    }
    return true;
  }

  // 2. Créer une prise de poste
  if (method === "POST" && pathname === "/api/shifts") {
    try {
      const { user, account } = await requireAccount();
      if (![1, 2].includes(Number(account.role))) throw Object.assign(new Error("Seul un chef de poste ou un administrateur peut ouvrir un service."), { status: 403 });
      const data = await readJson(request);
      if (account.siteId && account.role !== 1 && data.siteId && data.siteId !== account.siteId) {
        throw Object.assign(new Error("Accès refusé à ce site."), { status: 403 });
      }
      if (account.siteId && account.role !== 1) {
        data.siteId = account.siteId;
        const assignedSite = await pool.query("SELECT nom FROM site WHERE id=$1::uuid", [account.siteId]);
        if (assignedSite.rows[0]) data.site_de_travail = assignedSite.rows[0].nom;
      }
      const newShift = await createShift(data, pool, user.id);
      json(response, 201, newShift);
    } catch (error) {
      json(response, error.status || 400, { error: error.message || "Erreur lors de la création de la prise de poste." });
    }
    return true;
  }

  // 3. Clôturer un service
  if (method === "PUT" && pathname.startsWith("/api/shifts/") && pathname.endsWith("/end")) {
    const parts = pathname.split("/");
    const shiftId = parts[3];
    try {
      const { account } = await requireAccount();
      if (![1, 2].includes(Number(account.role))) throw Object.assign(new Error("Seul un chef de poste ou un administrateur peut clôturer un service."), { status: 403 });
      const updated = await endShift(shiftId, pool, account.role === 1 ? null : account.siteId);
      if (!updated) {
        json(response, 404, { error: "Prise de poste non trouvée." });
      } else {
        json(response, 200, updated);
      }
    } catch (error) {
      json(response, error.status || 500, { error: error.message || "Erreur lors de la clôture du service." });
    }
    return true;
  }

  // 4. Récupérer les options pour les sélecteurs (prestataires et sites)
  if (method === "GET" && pathname === "/api/options-prise-de-poste") {
    try {
      const options = await getFormDataOptions(pool);
      json(response, 200, options);
    } catch (error) {
      console.error("Erreur options-prise-de-poste:", error.code, error.message);
      json(response, 500, { error: "Erreur lors du chargement des options." });
    }
    return true;
  }

  // 5. Vérifier un employé par son matricule
  if (method === "GET" && pathname.startsWith("/api/employes/")) {
    const matricule = decodeURIComponent(pathname.replace("/api/employes/", ""));
    try {
      const employee = await getEmployeeByMatricule(matricule, pool);
      if (!employee) {
        json(response, 404, { error: "Matricule non trouvé." });
      } else {
        json(response, 200, employee);
      }
    } catch (error) {
      json(response, 500, { error: "Erreur lors de la recherche du matricule." });
    }
    return true;
  }

  return false;
}
