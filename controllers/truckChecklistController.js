import { json, readJson } from "../utils/helpers.js";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const checkIds = ["starts", "chocks", "tires", "leaks", "cover", "sideboards"];
const resultValues = new Set(["", "OK", "NOK"]);
const decisionValues = new Set(["", "Autorisé", "Interdit"]);

const validDate = (value) => {
  if (typeof value !== "string" || !datePattern.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

async function getAccount(pool, userId) {
  const result = await pool.query(
    "SELECT id, site_id, role FROM utilisateur WHERE id = $1::uuid LIMIT 1",
    [userId],
  );
  if (!result.rows[0]) throw Object.assign(new Error("Utilisateur introuvable."), { status: 401 });
  return result.rows[0];
}

async function resolveSite(pool, account, requestedSiteId) {
  if (account.site_id && account.role !== 1) return account.site_id;
  if (typeof requestedSiteId !== "string" || !uuidPattern.test(requestedSiteId)) {
    throw Object.assign(new Error("Sélectionnez un site de travail."), { status: 400 });
  }
  const result = await pool.query(
    "SELECT id FROM site WHERE id = $1::uuid AND actif = true LIMIT 1",
    [requestedSiteId],
  );
  if (!result.rows[0]) throw Object.assign(new Error("Site introuvable ou inactif."), { status: 400 });
  return result.rows[0].id;
}

function validateRows(rows) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 100) {
    throw Object.assign(new Error("La fiche doit contenir entre 1 et 100 lignes."), { status: 400 });
  }
  return rows.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw Object.assign(new Error("Une ligne de la fiche est invalide."), { status: 400 });
    }
    const text = (value, maxLength) => {
      if (typeof value !== "string" || value.length > maxLength) {
        throw Object.assign(new Error("Une valeur de la fiche est invalide ou trop longue."), { status: 400 });
      }
      return value.trim();
    };
    const controlTime = text(row.controlTime, 5);
    if (controlTime && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(controlTime)) {
      throw Object.assign(new Error("L’heure de contrôle est invalide."), { status: 400 });
    }
    if (!row.checks || typeof row.checks !== "object" || Array.isArray(row.checks)
      || !checkIds.every((id) => resultValues.has(row.checks[id]))) {
      throw Object.assign(new Error("Les résultats de contrôle sont invalides."), { status: 400 });
    }
    if (!decisionValues.has(row.decision)) {
      throw Object.assign(new Error("La décision d’accès est invalide."), { status: 400 });
    }
    return {
      vehicle: text(row.vehicle, 160),
      carrier: text(row.carrier, 255),
      controlTime,
      checks: Object.fromEntries(checkIds.map((id) => [id, row.checks[id]])),
      signature: text(row.signature, 255),
      observation: text(row.observation, 2000),
      decision: row.decision,
    };
  });
}

export async function getTruckChecklist(request, response, pool, userId) {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const date = url.searchParams.get("date");
    if (!validDate(date)) {
      return json(response, 400, { error: "Indiquez une date de recherche valide." });
    }
    const account = await getAccount(pool, userId);
    const siteId = await resolveSite(pool, account, url.searchParams.get("siteId"));
    const result = await pool.query(
      `SELECT id, date_operation::text AS date, rows
       FROM truck_checklist
       WHERE site_id = $1::uuid AND date_operation = $2::date
       LIMIT 1`,
      [siteId, date],
    );
    json(response, 200, { entry: result.rows[0] || null });
  } catch (error) {
    console.error("GET /truck-checklists failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, {
      error: error.status ? error.message : "Impossible de rechercher la check-list camion.",
    });
  }
}

export async function saveTruckChecklist(request, response, pool, userId) {
  try {
    const body = await readJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return json(response, 400, { error: "Les données de la check-list sont invalides." });
    }
    if (!validDate(body.date)) {
      return json(response, 400, { error: "Indiquez une date de contrôle valide." });
    }
    const rows = validateRows(body.rows);
    const account = await getAccount(pool, userId);
    const siteId = await resolveSite(pool, account, body.siteId);
    const result = await pool.query(
      `INSERT INTO truck_checklist (date_operation, rows, site_id, utilisateur_id)
       VALUES ($1::date, $2::jsonb, $3::uuid, $4::uuid)
       ON CONFLICT (site_id, date_operation)
       DO UPDATE SET rows = EXCLUDED.rows, utilisateur_id = EXCLUDED.utilisateur_id,
                     modifie_le = CURRENT_TIMESTAMP
       RETURNING id, date_operation::text AS date, rows`,
      [body.date, JSON.stringify(rows), siteId, userId],
    );
    json(response, 200, { entry: result.rows[0] });
  } catch (error) {
    console.error("PUT /truck-checklists failed:", error.code || error.name, error.message || "");
    json(response, error.status || 500, {
      error: error.status ? error.message : "Impossible d’enregistrer la check-list camion.",
    });
  }
}
