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
      if (Number(account.role) !== 2) throw Object.assign(new Error("Seul le chef de poste peut ouvrir un service."), { status: 403 });
      const data = await readJson(request);
      if (data.clientRequestId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.clientRequestId)) {
        throw Object.assign(new Error("Identifiant de requête invalide."), { status: 400 });
      }
      if (account.siteId && data.siteId && data.siteId !== account.siteId) {
        throw Object.assign(new Error("Accès refusé à ce site."), { status: 403 });
      }
      if (account.siteId) {
        data.siteId = account.siteId;
        const assignedSite = await pool.query("SELECT nom FROM site WHERE id=$1::uuid", [account.siteId]);
        if (assignedSite.rows[0]) data.site_de_travail = assignedSite.rows[0].nom;
      }
      const newShift = await createShift(data, pool, user.id);
      json(response, 201, newShift);
    } catch (error) {
      if (error.code) console.error("Erreur POST /api/shifts:", error.code, error.message || "");
      json(response, error.status || (error.code === "23505" ? 409 : 500), { error: error.message || "Erreur lors de la création de la prise de poste." });
    }
    return true;
  }

  const shiftDelete = method === "DELETE" && /^\/api\/shifts\/([0-9a-f-]{36})$/i.exec(pathname);
  if (shiftDelete) {
    const shiftId = shiftDelete[1];
    let client;
    try {
      const { account } = await requireAccount();
      if (![1, 2].includes(Number(account.role))) throw Object.assign(new Error("Seul un chef de poste ou un administrateur peut supprimer une prise de service."), { status: 403 });
      client = await pool.connect();
      await client.query("BEGIN");
      const directService = await client.query(`SELECT id,site_id AS "siteId" FROM service_poste WHERE id=$1::uuid FOR UPDATE`, [shiftId]);
      const found = directService.rows[0] ? directService : await client.query(
        `SELECT COALESCE(p.service_id,p.id) AS id,sp.site_id AS "siteId"
         FROM prise_de_poste p
         LEFT JOIN service_poste sp ON sp.id=COALESCE(p.service_id,p.id)
         WHERE p.id=$1::uuid OR p.service_id=$1::uuid
         LIMIT 1 FOR UPDATE OF p`,
        [shiftId],
      );
      const service = found.rows[0];
      if (!service) {
        await client.query("COMMIT");
        json(response, 200, { deleted: false, serviceId: shiftId, deletedFluxCount: 0 });
        return true;
      }
      if (Number(account.role) !== 1 && (!account.siteId || account.siteId !== service.siteId)) throw Object.assign(new Error("Vous ne pouvez supprimer que les prises de service de votre site."), { status: 403 });

      const linkedFlux = await client.query(
        `SELECT f.id FROM flux_logistique f
         WHERE f.service_poste_id=$1::uuid
            OR f.prise_de_poste_id IN (SELECT p.id FROM prise_de_poste p WHERE p.service_id=$1::uuid OR p.id=$1::uuid)
         FOR UPDATE OF f`,
        [service.id],
      );
      const fluxIds = linkedFlux.rows.map((row) => row.id);
      if (fluxIds.length) {
        await client.query(`DELETE FROM audit_flux_logistique WHERE flux_id=ANY($1::uuid[])`, [fluxIds]);
        await client.query(`DELETE FROM flux_logistique_document WHERE flux_id=ANY($1::uuid[])`, [fluxIds]);
        await client.query(`DELETE FROM flux_logistique WHERE id=ANY($1::uuid[])`, [fluxIds]);
      }

      await client.query(`DELETE FROM prise_de_poste WHERE service_id=$1::uuid OR id=$1::uuid`, [service.id]);
      await client.query(`DELETE FROM service_poste WHERE id=$1::uuid`, [service.id]);
      await client.query("COMMIT");
      json(response, 200, { deleted: true, serviceId: service.id, deletedFluxCount: fluxIds.length });
    } catch (error) {
      if (client) await client.query("ROLLBACK").catch(() => {});
      if (error.code) console.error("Erreur DELETE /api/shifts:", error.code, error.message || "");
      const status = error.status || (error.code === "23514" ? 409 : 500);
      const message = error.code === "23514"
        ? "Suppression bloquée par une contrainte sur des données associées. Aucune ligne n’a été supprimée."
        : error.message || "Erreur lors de la suppression de la prise de service.";
      json(response, status, { error: message });
    } finally {
      client?.release();
    }
    return true;
  }

  // 3. Clôturer un service
  if (method === "PUT" && pathname.startsWith("/api/shifts/") && pathname.endsWith("/end")) {
    const parts = pathname.split("/");
    const shiftId = parts[3];
    try {
      const { account } = await requireAccount();
      if (![1, 2].includes(Number(account.role))) throw Object.assign(new Error("Seul le chef de poste ou l’administrateur peut clôturer un service."), { status: 403 });
      const hasBody = Number(request.headers["content-length"] || 0) > 0 || Boolean(request.headers["transfer-encoding"]);
      const body = hasBody ? await readJson(request) : {};
      if (body.clientRequestId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.clientRequestId)) {
        throw Object.assign(new Error("Identifiant de requête invalide."), { status: 400 });
      }
      const updated = await endShift(shiftId, pool, account.siteId, body.clientRequestId || null);
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
