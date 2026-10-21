import { json, readJson } from "../utils/helpers.js";

export async function getAlcootests(request, response, pool) {
  try {
    const result = await pool.query(
      `SELECT id, type_controle, nom_prenom, is_star, demandeur, resultat, taux, heure, created_at 
       FROM alcootests 
       ORDER BY created_at DESC;`
    );
    json(response, 200, result.rows);
  } catch (error) {
    console.error("Erreur GET /alcootests:", error);
    json(response, 500, { error: "Erreur lors de la récupération des contrôles d'alcoolémie." });
  }
}

export async function createAlcootest(request, response, pool) {
  try {
    const body = await readJson(request);
    const { typeControle, nomPrenom, isStar, demandeur, resultat, taux, heure } = body;

    if (!nomPrenom || !resultat) {
      return json(response, 400, { error: "Le nom et le résultat du test sont obligatoires." });
    }

    if (typeControle === 'A la demande' && (!demandeur || !demandeur.trim())) {
      return json(response, 400, { error: "La présence d'un supérieur/demandeur est obligatoire pour un test sur demande." });
    }

    const query = `
      INSERT INTO alcootests (type_controle, nom_prenom, is_star, demandeur, resultat, taux, heure, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      RETURNING *;
    `;
    const values = [
      typeControle || 'Ordinaire',
      nomPrenom.trim(),
      isStar ?? true,
      demandeur ? demandeur.trim() : '',
      resultat,
      taux || '0.00',
      heure || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    ];

    const result = await pool.query(query, values);
    json(response, 201, result.rows[0]);
  } catch (error) {
    if (error.status) {
      return json(response, error.status, { error: error.message });
    }
    console.error("Erreur POST /alcootests:", error);
    json(response, 500, { error: "Erreur lors de l'enregistrement du contrôle d'alcoolémie." });
  }
}