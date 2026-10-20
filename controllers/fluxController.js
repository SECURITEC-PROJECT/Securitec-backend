import { json, readJson } from "../utils/helpers.js";

// Récupérer tous les flux et registres logistiques
export async function getFlux(request, response, pool) {
  try {
    const result = await pool.query(
      `SELECT id, type, site_type AS "siteType", camion, remorque, transporteur, 
              transport_type AS "transportType", document_ref AS "documentRef", 
              plomb, variante, anomalie, format_produit AS "formatProduit", 
              quantite_impactee AS "quantiteImpactee", description_fait AS "descriptionFait",
              cv12, cv24, cv20, intercalaires, ev150, ev50, cr200, cr100, observateur, created_at 
       FROM flux_logistiques 
       ORDER BY created_at DESC;`
    );
    json(response, 200, result.rows);
  } catch (error) {
    console.error("Erreur GET /flux:", error);
    json(response, 500, { error: "Erreur lors de la récupération des flux logistiques." });
  }
}

// Enregistrer un nouveau flux (Chargement, Déchargement, Anomalie ou Stock Extérieur)
export async function createFlux(request, response, pool) {
  try {
    const body = await readJson(request);
    const {
      type, siteType, camion, remorque, transporteur, transportType,
      documentRef, plomb, variante, anomalie, formatProduit,
      quantiteImpactee, descriptionFait, cv12, cv24, cv20,
      intercalaires, ev150, ev50, cr200, cr100, observateur
    } = body;

    const query = `
      INSERT INTO flux_logistiques (
        type, site_type, camion, remorque, transporteur, transport_type,
        document_ref, plomb, variante, anomalie, format_produit,
        quantite_impactee, description_fait, cv12, cv24, cv20,
        intercalaires, ev150, ev50, cr200, cr100, observateur, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, NOW())
      RETURNING *;
    `;

    const values = [
      type || 'Chargement',
      siteType || 'Agence',
      camion || '',
      remorque || '',
      transporteur || '',
      transportType || 'VL',
      documentRef || '',
      plomb || '',
      variante || '',
      anomalie || 'Aucune',
      formatProduit || '',
      quantiteImpactee ? Number(quantiteImpactee) : 0,
      descriptionFait || '',
      cv12 ? Number(cv12) : 0,
      cv24 ? Number(cv24) : 0,
      cv20 ? Number(cv20) : 0,
      intercalaires ? Number(intercalaires) : 0,
      ev150 ? Number(ev150) : 0,
      ev50 ? Number(ev50) : 0,
      cr200 ? Number(cr200) : 0,
      cr100 ? Number(cr100) : 0,
      observateur || ''
    ];

    const result = await pool.query(query, values);
    json(response, 201, result.rows[0]);
  } catch (error) {
    if (error.status) {
      return json(response, error.status, { error: error.message });
    }
    console.error("Erreur POST /flux:", error);
    json(response, 500, { error: "Erreur lors de l'enregistrement du flux logistique." });
  }
}