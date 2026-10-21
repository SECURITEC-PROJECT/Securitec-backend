import pool from "../config/db.js";

export async function getKeysMovements() {
  try {
    const result = await pool.query(
      `SELECT id, trousse_cle, action, personne_habilitee, role_personne, agent_gardien, heure, lieu, observation, created_at 
       FROM gestion_cles 
       ORDER BY created_at DESC;`
    );
    return result.rows;
  } catch (error) {
    console.error("Erreur GET /keys:", error);
    throw error;
  }
}

export async function createKeyMovement(data) {
  const { trousseCle, action, personneHabilitee, rolePersonne, agentGardien, heure, lieu, observation } = data;

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

  const query = `
    INSERT INTO gestion_cles (trousse_cle, action, personne_habilitee, role_personne, agent_gardien, heure, lieu, observation, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    RETURNING *;
  `;
  const values = [
    trousseCle.trim(),
    action || 'Perception',
    personneHabilitee.trim(),
    rolePersonne || 'Agent',
    agentGardien.trim(),
    heure || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    lieu ? lieu.trim() : '',
    observation ? observation.trim() : ''
  ];

  const result = await pool.query(query, values);
  return result.rows[0];
}