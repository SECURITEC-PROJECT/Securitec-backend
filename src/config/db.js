const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const dbConfig = {
  host: process.env.DB_HOST || process.env.MYSQL_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || process.env.MYSQL_PORT || '3306', 10),
  user: process.env.DB_USER || process.env.MYSQL_USER || 'root',
  password: process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD || '',
  database: process.env.DB_NAME || process.env.MYSQL_DATABASE || 'securitec',
  waitForConnections: true,
  connectionLimit: 10,
  multipleStatements: true,
  dateStrings: true,
};

const pool = mysql.createPool(dbConfig);

const normalizeSql = (text) =>
  text
    .replace(/\$(\d+)/g, '?')
    .replace(/\bas\s+"([^"]+)"/gi, 'AS `$1`')
    .replace(/\bAS\s+"([^"]+)"/gi, 'AS `$1`');

const wrapResult = (result) => {
  if (Array.isArray(result)) {
    return {
      rows: result,
      rowCount: result.length,
    };
  }

  return {
    rows: [],
    rowCount: result?.affectedRows ?? 0,
    insertId: result?.insertId,
  };
};

const runQuery = async (executor, text, params = []) => {
  const [result] = await executor.query(normalizeSql(text), params);
  return wrapResult(result);
};

const initDB = async () => {
  let client;
  try {
    const adminPool = mysql.createPool({
      host: dbConfig.host,
      port: dbConfig.port,
      user: dbConfig.user,
      password: dbConfig.password,
      waitForConnections: true,
      connectionLimit: 1,
    });

    await adminPool.query(`CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await adminPool.end();

    const schemaPath = path.join(__dirname, 'schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    client = await pool.getConnection();

    await client.query(schemaSql);
    console.log('MySQL tables verified/created successfully.');

    const userCount = await runQuery(client, 'SELECT COUNT(*) AS count FROM users');
    if (parseInt(userCount.rows[0].count, 10) === 0) {
      console.log('Seeding default database records...');

      // 1. Seed Users
      const salt = bcrypt.genSaltSync(10);
      const hashedPasswordDefault = bcrypt.hashSync('1234', salt);
      const hashedPasswordAdmin = bcrypt.hashSync('admin', salt);

      const users = [
        ['U01', 'agent1', hashedPasswordDefault, 'KOUASSI Anicet', 'agent1', 'Accueil & Administration', '06h–18h', '01'],
        ['U02', 'agent2', hashedPasswordDefault, 'RABE Olivier', 'agent2', 'Contrôle NFC & Rondes', '06h–18h', '02'],
        ['U03', 'agent3', hashedPasswordDefault, 'ANDRY Soa', 'agent3', 'Surveillance & CR', '06h–18h', '03'],
        ['U99', 'superviseur', hashedPasswordAdmin, 'RAJAONA Patrick', 'supervisor', 'Superviseur Site', '24/7', 'SV'],
      ];

      for (const user of users) {
        await runQuery(
          client,
          'INSERT INTO users (id, username, password, name, role, role_label, vacation, avatar) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
          user
        );
      }

      // 2. Seed Access Log
      const accessLogs = [
        ['L1', 'RAKOTO Jean', '#A-0042', 'permanent', 'ZONE A', '08:47', 'Personnel permanent'],
        ['L2', 'RABE Marie', '#A-0017', 'permanent', 'ZONE B', '08:52', 'Personnel permanent'],
        ['L3', 'ANDRIA Paul', '#V-0003', 'visiteur', 'ZONE A', '09:05', 'Visiteur — escorte requise'],
        ['L4', 'Inconnu', '#?-????', 'refus', 'REFUS', '09:12', 'Badge non reconnu — alerte superviseur'],
        ['L5', 'RANDRIA Sitraka', '#A-0091', 'permanent', 'ZONE C', '09:18', 'Personnel permanent'],
        ['L6', 'TIANA Lova', '#V-0004', 'visiteur', 'ZONE A', '09:24', 'Prestataire — Telma'],
        ['L7', 'RAVELO Anja', '#A-0033', 'permanent', 'ZONE B', '09:31', 'Personnel permanent'],
      ];
      for (const log of accessLogs) {
        await runQuery(
          client,
          'INSERT INTO access_logs (id, name, badge, type, zone, time, detail) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          log
        );
      }

      // 3. Seed Visitors
      const visitors = [
        ['V1', 'ANDRIA Paul', 'Cabinet Audit RAVO', 'Réunion direction', 'V-0003', 'Mme RAHARISOA', '09:05', '2h', 'actif'],
        ['V2', 'TIANA Lova', 'Telma Telecom', 'Maintenance fibre', 'V-0004', 'M. RABE', '09:24', '4h', 'actif'],
        ['V3', 'RANDRIA Bako', 'DHL Express', 'Livraison colis', 'V-0001', 'Accueil', '08:12', '15min', 'sorti'],
      ];
      for (const vis of visitors) {
        await runQuery(
          client,
          'INSERT INTO visitors (id, name, company, motif, badge, host_agent, arrival, expected_duration, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
          vis
        );
      }

      // 4. Seed Consignes
      const consignes = [
        ['C1', 'RAJAONA Patrick (Superviseur)', 'Renforcer la vigilance sur la zone parking après 18h suite à l\'intrusion signalée hier soir.', 'high', '07:42', true, 'all'],
        ['C2', 'RAJAONA Patrick (Superviseur)', 'Visite délégation prévue à 14h — accueil à préparer, escorte permanente requise (badges V-0010 à V-0014).', 'med', '08:10', true, JSON.stringify(['agent1', 'agent2'])],
        ['C3', 'Direction', 'Rappel — port obligatoire du badge en zone B.', 'low', 'Hier 17:30', false, 'all'],
      ];
      for (const cons of consignes) {
        await runQuery(
          client,
          'INSERT INTO consignes (id, sender, text, priority, time, unread, target) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          cons
        );
      }

      // 5. Seed Notifications
      const notifications = [
        ['N1', 'Badge inconnu refusé en Zone A', '09:12', 'alert'],
        ['N2', 'Détection mouvement Caméra 03', '09:32', 'warn'],
        ['N3', 'Point de contrôle CP4 manqué', '09:45', 'warn'],
      ];
      for (const notif of notifications) {
        await runQuery(
          client,
          'INSERT INTO notifications (id, text, time, type) VALUES ($1, $2, $3, $4)',
          notif
        );
      }

      // 6. Seed Cameras
      const cameras = [
        ['CAM1', 'CAM 01 — Entrée principale', 'live'],
        ['CAM2', 'CAM 02 — Hall accueil', 'live'],
        ['CAM3', 'CAM 03 — Parking visiteurs', 'alerte'],
        ['CAM4', 'CAM 04 — Zone stockage', 'live'],
      ];
      for (const cam of cameras) {
        await runQuery(
          client,
          'INSERT INTO camera_feeds (id, label, status) VALUES ($1, $2, $3)',
          cam
        );
      }

      // 7. Seed Rondes & Checkpoints
      const rondes = [
        ['R1', 'Circuit Nuit — 06h', '06:00', 'Agent 02', 'encours'],
      ];
      for (const ronde of rondes) {
        await runQuery(
          client,
          'INSERT INTO rondes (id, circuit, start, agent, status) VALUES ($1, $2, $3, $4, $5)',
          ronde
        );
      }

      const today = new Date().toISOString().slice(0, 10);
      const checkpoints = [
        ['CP1', 'R1', 'Portail Principal', 'Périmètre', 'done', '06:15'],
        ['CP2', 'R1', 'Parking Visiteurs', 'Extérieur', 'done', '06:22'],
        ['CP3', 'R1', 'Local Technique', 'Bâtiment A', 'done', '06:31'],
        ['CP4', 'R1', 'Zone Stockage', 'Bâtiment B', 'missed', null],
        ['CP5', 'R1', 'Issue Secours Est', 'Périmètre', 'pending', null],
        ['CP6', 'R1', 'Issue Secours Ouest', 'Périmètre', 'pending', null],
        ['CP7', 'R1', 'Salle Serveurs', 'Bâtiment A', 'pending', null],
        ['CP8', 'R1', 'Toiture', 'Bâtiment A', 'pending', null],
      ];
      for (const cp of checkpoints) {
        await runQuery(
          client,
          'INSERT INTO checkpoints (id, ronde_id, name, zone, status, time) VALUES ($1, $2, $3, $4, $5, $6)',
          cp
        );
      }

      // 8. Seed Person Movements
      const personMovements = [
        ['PM1', 'entree', 'permanent', 'RAKOTO Jean', 'A-0042', 'VERT', 'ZONE A', 'Personnel permanent', today, '08:47', 'Agent 01', null],
        ['PM2', 'entree', 'permanent', 'RABE Marie', 'A-0017', 'VERT', 'ZONE B', 'Personnel permanent', today, '08:52', 'Agent 01', null],
        ['PM3', 'entree', 'visiteur', 'ANDRIA Paul', 'V-0003', 'ORANGE', 'ZONE A', 'Réunion direction', today, '09:05', 'Agent 01', null],
        ['PM4', 'entree', 'prestataire', 'TIANA Lova', 'V-0004', 'ORANGE', 'ZONE A', 'Maintenance fibre', today, '09:24', 'Agent 01', null],
        ['PM5', 'sortie', 'prestataire', 'RANDRIA Bako', 'V-0001', 'ORANGE', 'ZONE A', 'Livraison DHL', today, '08:27', 'Agent 01', 'PM0'],
      ];
      for (const pm of personMovements) {
        await runQuery(
          client,
          'INSERT INTO person_movements (id, type, person_type, full_name, badge, badge_color, zone, motif, date, time, agent, linked_to) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)',
          pm
        );
      }

      // 9. Seed Vehicle Movements
      const vehicleMovements = [
        ['VM1', 'entree', '3456 TBA', 'leger', 'RAKOTO Jean', null, 'Personnel permanent', 'P-12', today, '08:45', 'Agent 02'],
        ['VM2', 'entree', '7821 TBC', 'utilitaire', 'TIANA Lova', 'Telma Telecom', 'Maintenance fibre', 'L-03', today, '09:23', 'Agent 02'],
        ['VM3', 'sortie', '1190 TAA', 'poids-lourd', 'RANDRIA Bako', 'DHL', 'Livraison terminée', null, today, '08:27', 'Agent 02'],
      ];
      for (const vm of vehicleMovements) {
        await runQuery(
          client,
          'INSERT INTO vehicle_movements (id, type, plate, category, driver, company, motif, parking_spot, date, time, agent) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
          vm
        );
      }

      // 10. Seed Logbook Entries
      const logbook = [
        ['LB1', today, '06:15', 'ronde', 'Périmètre', 'Début ronde Circuit Nuit, tous accès vérifiés.', 'info', 'Agent 02'],
        ['LB2', today, '07:42', 'observation', 'Parking', 'Véhicule visiteur stationné sans badge — propriétaire identifié et badge délivré.', 'mineur', 'Agent 01'],
        ['LB3', today, '09:12', 'alerte', 'ZONE A', 'Badge inconnu refusé au lecteur principal. Alerte superviseur émise.', 'majeur', 'Système'],
        ['LB4', today, '09:32', 'incident', 'Parking visiteurs', 'Détection mouvement caméra 03 hors horaires, levée de doute OK.', 'mineur', 'Agent 03'],
      ];
      for (const lb of logbook) {
        await runQuery(
          client,
          'INSERT INTO logbook_entries (id, date, time, category, zone, description, severity, agent) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
          lb
        );
      }

      // 11. Seed Vacations
      const vacations = [
        [
          'VAC1',
          today,
          'jour',
          'Équipe Nuit (RAFANO Hery)',
          'KOUASSI Anicet',
          'RAS sur la nuit, 1 alerte caméra levée à 03h12 (chat errant).',
          'Stock badges visiteurs : 12 restants. Renforcer le suivi parking après 18h.',
          'Visite délégation prévue 14h — préparer 5 badges ORANGE.',
          true,
          true,
          'validee',
        ],
      ];
      for (const vac of vacations) {
        await runQuery(
          client,
          'INSERT INTO vacations (id, date, shift, outgoing_agent, incoming_agent, summary, remarks, pending_items, signed_out, signed_in, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
          vac
        );
      }

      console.log('Seeding completed successfully!');
    }
  } catch (err) {
    console.error('Error initializing database tables:', err.message);
    throw err;
  } finally {
    if (client) client.release();
  }
};

const query = async (text, params = []) => {
  const [result] = await pool.query(normalizeSql(text), params);
  return wrapResult(result);
};

const withTransaction = async (callback) => {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const transactionQuery = async (text, params = []) => runQuery(connection, text, params);
    const result = await callback(transactionQuery);

    await connection.commit();
    return result;
  } catch (error) {
    try {
      await connection.rollback();
    } catch (rollbackError) {
      console.error('Error rolling back transaction:', rollbackError.message);
    }

    throw error;
  } finally {
    connection.release();
  }
};

module.exports = {
  pool,
  query,
  initDB,
  withTransaction,
};
