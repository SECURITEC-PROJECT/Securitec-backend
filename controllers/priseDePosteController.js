const pool = require('../config/db');

// Récupérer toutes les prises de poste
exports.getAllShifts = async (req, res) => {
  try {
    const query = `
      SELECT id, nom, prenom, prestataire, site_de_travail, checks, notes, started_at, ended_at 
      FROM prises_de_poste 
      ORDER BY started_at DESC;
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur lors de la récupération des prises de poste.' });
  }
};

// Créer une nouvelle prise de poste
exports.createShift = async (req, res) => {
  const { nom, prenom, prestataire, site_de_travail, checks, notes } = req.body;

  if (!nom || !prenom) {
    return res.status(400).json({ error: 'Le nom et le prénom sont obligatoires.' });
  }

  try {
    const query = `
      INSERT INTO prises_de_poste (nom, prenom, prestataire, site_de_travail, checks, notes, started_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      RETURNING *;
    `;
    const values = [
      nom,
      prenom,
      prestataire || 'securitec',
      site_de_travail || 'Usine Antsirabe',
      JSON.stringify(checks || {}),
      notes || ''
    ];

    const result = await pool.query(query, values);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur lors de la création de la prise de poste.' });
  }
};

// Terminer le service
exports.endShift = async (req, res) => {
  const { id } = req.params;

  try {
    const query = `
      UPDATE prises_de_poste 
      SET ended_at = NOW() 
      WHERE id = $1 
      RETURNING *;
    `;
    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Prise de poste non trouvée.' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur lors de la clôture du service.' });
  }
};