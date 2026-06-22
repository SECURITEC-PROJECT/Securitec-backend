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

const isTruthyEnv = (value) =>
  ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());

const bootstrapDefaultUsers = async (client) => {
  const userCount = await runQuery(client, 'SELECT COUNT(*) AS count FROM users');
  if (parseInt(userCount.rows[0].count, 10) !== 0) {
    return;
  }

  const allowDefaultUsers = process.env.NODE_ENV !== 'production' || isTruthyEnv(process.env.BOOTSTRAP_DEFAULT_USERS);
  if (!allowDefaultUsers) {
    return;
  }

  const defaultUsers = [
    {
      id: 'U01',
      username: process.env.BOOTSTRAP_AGENT1_USERNAME || 'agent1',
      password: process.env.BOOTSTRAP_AGENT1_PASSWORD || '1234',
      name: process.env.BOOTSTRAP_AGENT1_NAME || 'KOUASSI Anicet',
      role: 'agent1',
      roleLabel: process.env.BOOTSTRAP_AGENT1_ROLE_LABEL || 'Accueil & Administration',
      vacation: process.env.BOOTSTRAP_AGENT1_VACATION || '06h-18h',
      avatar: process.env.BOOTSTRAP_AGENT1_AVATAR || '01',
    },
    {
      id: 'U02',
      username: process.env.BOOTSTRAP_AGENT2_USERNAME || 'agent2',
      password: process.env.BOOTSTRAP_AGENT2_PASSWORD || '1234',
      name: process.env.BOOTSTRAP_AGENT2_NAME || 'RABE Olivier',
      role: 'agent2',
      roleLabel: process.env.BOOTSTRAP_AGENT2_ROLE_LABEL || 'Contrôle NFC & Rondes',
      vacation: process.env.BOOTSTRAP_AGENT2_VACATION || '06h-18h',
      avatar: process.env.BOOTSTRAP_AGENT2_AVATAR || '02',
    },
    {
      id: 'U03',
      username: process.env.BOOTSTRAP_AGENT3_USERNAME || 'agent3',
      password: process.env.BOOTSTRAP_AGENT3_PASSWORD || '1234',
      name: process.env.BOOTSTRAP_AGENT3_NAME || 'ANDRY Soa',
      role: 'agent3',
      roleLabel: process.env.BOOTSTRAP_AGENT3_ROLE_LABEL || 'Surveillance & CR',
      vacation: process.env.BOOTSTRAP_AGENT3_VACATION || '06h-18h',
      avatar: process.env.BOOTSTRAP_AGENT3_AVATAR || '03',
    },
    {
      id: 'U99',
      username: process.env.BOOTSTRAP_SUPERVISOR_USERNAME || 'superviseur',
      password: process.env.BOOTSTRAP_SUPERVISOR_PASSWORD || 'admin',
      name: process.env.BOOTSTRAP_SUPERVISOR_NAME || 'RAJAONA Patrick',
      role: 'supervisor',
      roleLabel: process.env.BOOTSTRAP_SUPERVISOR_ROLE_LABEL || 'Superviseur site',
      vacation: process.env.BOOTSTRAP_SUPERVISOR_VACATION || '24/7',
      avatar: process.env.BOOTSTRAP_SUPERVISOR_AVATAR || 'SV',
    },
  ];

  const hashedUsers = defaultUsers.map((user) => ({
    ...user,
    password: bcrypt.hashSync(user.password, 10),
  }));

  for (const user of hashedUsers) {
    await runQuery(
      client,
      'INSERT INTO users (id, username, password, name, role, role_label, vacation, avatar) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [user.id, user.username, user.password, user.name, user.role, user.roleLabel, user.vacation, user.avatar]
    );
  }

  console.log('Development users bootstrapped successfully.');
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

    await adminPool.query(
      `CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await adminPool.end();

    const schemaPath = path.join(__dirname, 'schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    client = await pool.getConnection();
    await client.query(schemaSql);

    console.log('MySQL tables verified/created successfully.');

    await bootstrapDefaultUsers(client);
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
