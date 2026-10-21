import { getEmployeeByMatricule, getFormDataOptions } from "../controllers/employeeController.js";
import { createShift, endShift, getShifts } from "../controllers/shiftController.js";
import { json } from "../utils/helpers.js";

export async function handleShiftRoutes(request, response, pool, pathname) {
  const method = request.method;

  // 1. Récupérer toutes les prises de poste
  if (method === "GET" && pathname === "/api/shifts") {
    try {
      const shifts = await getShifts(request, response);
      json(response, 200, shifts);
    } catch (error) {
      json(response, 500, { error: "Erreur lors de la récupération des prises de poste." });
    }
    return true;
  }

  // 2. Créer une prise de poste
  if (method === "POST" && pathname === "/api/shifts") {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", async () => {
      try {
        const data = JSON.parse(body || "{}");
        const newShift = await createShift(data);
        json(response, 201, newShift);
      } catch (error) {
        json(response, 400, { error: error.message || "Erreur lors de la création de la prise de poste." });
      }
    });
    return true;
  }

  // 3. Clôturer un service
  if (method === "PUT" && pathname.startsWith("/api/shifts/") && pathname.endsWith("/end")) {
    const parts = pathname.split("/");
    const shiftId = parts[3];
    try {
      const updated = await endShift(shiftId);
      if (!updated) {
        json(response, 404, { error: "Prise de poste non trouvée." });
      } else {
        json(response, 200, updated);
      }
    } catch (error) {
      json(response, 500, { error: "Erreur lors de la clôture du service." });
    }
    return true;
  }

  // 4. Récupérer les options pour les sélecteurs (prestataires et sites)
  if (method === "GET" && pathname === "/api/options-prise-de-poste") {
    try {
      const options = await getFormDataOptions();
      json(response, 200, options);
    } catch (error) {
      json(response, 500, { error: "Erreur lors du chargement des options." });
    }
    return true;
  }

  // 5. Vérifier un employé par son matricule
  if (method === "GET" && pathname.startsWith("/api/employes/")) {
    const matricule = decodeURIComponent(pathname.replace("/api/employes/", ""));
    try {
      const employee = await getEmployeeByMatricule(matricule);
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