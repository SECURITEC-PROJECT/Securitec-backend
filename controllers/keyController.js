import pool from "../config/db.js";

export async function getKeysMovements() {
  try {
    const result = await pool.query(
      `SELECT id, trousse_cle, lieu, action, personne_habilitee, role_personne, matricule_personne,
              agent_gardien, heure, observation, perception_id, created_at
       FROM suivi_cle
       ORDER BY created_at DESC;`
    );
    return result.rows;
  } catch (error) {
    console.error("Erreur GET /keys:", error);
    throw error;
  }
}

export async function createKeyMovement(data) {
  const {
    trousseCle, action, personneHabilitee, rolePersonne, matriculePersonne,
    agentGardien, heure, lieu, observation, perceptionId,
  } = data;

  if (!trousseCle || !personneHabilitee || !agentGardien) {
    throw new Error("Tous les champs obligatoires doivent être remplis.");
  }

  // Vérification d'habilitation uniquement en cas de Perception
  if (action === "Perception") {
    const habCheck = await pool.query(
      `SELECT 1 FROM employe e
       JOIN cle_habilitation ch ON e.role = ch.role_autorise
       WHERE TRIM(UPPER(ch.trousse_cle)) = TRIM(UPPER($1))
         AND TRIM(UPPER(CONCAT(e.nom, ' ', e.prenom))) = TRIM(UPPER($2));`,
      [trousseCle, personneHabilitee]
    );

    if (habCheck.rows.length === 0) {
      throw new Error(`Accès refusé : ${personneHabilitee} n'est pas habilité(e) à percevoir la clé ${trousseCle}.`);
    }
  }

  // Une réintégration doit clôturer une perception existante, une seule fois
  let origineId = null;
  if (action === "Réintégration") {
    origineId = Number(perceptionId);
    if (!Number.isInteger(origineId)) {
      throw new Error("Perception d'origine manquante.");
    }
    const origine = await pool.query(
      `SELECT 1 FROM suivi_cle WHERE id = $1 AND action = 'Perception';`,
      [origineId]
    );
    if (origine.rows.length === 0) {
      throw new Error("Perception d'origine introuvable.");
    }
    const dejaRendue = await pool.query(
      `SELECT 1 FROM suivi_cle WHERE perception_id = $1 AND action = 'Réintégration';`,
      [origineId]
    );
    if (dejaRendue.rows.length > 0) {
      throw new Error("Cette clé a déjà été réintégrée.");
    }
  }

  const query = `
    INSERT INTO suivi_cle (trousse_cle, lieu, action, personne_habilitee, role_personne, matricule_personne,
                           agent_gardien, heure, observation, perception_id, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
    RETURNING *;
  `;
  const values = [
    trousseCle.trim(),
    lieu ? lieu.trim() : "",
    action || "Perception",
    personneHabilitee.trim(),
    rolePersonne ? String(rolePersonne).trim() : "Agent",
    matriculePersonne ? String(matriculePersonne).trim() : null,
    agentGardien.trim(),
    heure || new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", hour12: false }),
    observation ? observation.trim() : "",
    origineId,
  ];

  const result = await pool.query(query, values);
  return result.rows[0];
}
