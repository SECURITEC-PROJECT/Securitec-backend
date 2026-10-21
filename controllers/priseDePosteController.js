const pool = require('../config/db');

exports.getAllShifts = async (req, res) => {
  try {
    const query = `
      SELECT id, matricule, nom, prenom, prestataire, site_de_travail, notes, started_at, ended_at 
      FROM prise_de_poste 
      ORDER BY started_at DESC;
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur lors de la récupération des prises de poste.' });
  }
};

exports.createShift = async (req, res) => {
  const { matricule, nom, prenom, prestataire, site_de_travail, notes } = req.body;

  if (!matricule || !nom || !prenom) {
    return res.status(400).json({ error: 'Le matricule, le nom et le prénom sont obligatoires.' });
  }

  try {
    const query = `
      INSERT INTO prise_de_poste (matricule, nom, prenom, prestataire, site_de_travail, notes, started_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      RETURNING *;
    `;
    const values = [
      matricule,
      nom,
      prenom,
      prestataire || 'securitec',
      site_de_travail || 'Usine Antsirabe',
      notes || ''
    ];

    const result = await pool.query(query, values);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur lors de la création de la prise de poste.' });
  }
};

exports.endShift = async (req, res) => {
  const { id } = req.params;

  try {
    const query = `
      UPDATE prise_de_poste 
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