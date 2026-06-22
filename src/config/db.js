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

const bootstrapSupervisorAccount = async (client) => {
  const username = process.env.BOOTSTRAP_SUPERVISOR_USERNAME;
  const password = process.env.BOOTSTRAP_SUPERVISOR_PASSWORD;

  if (!username || !password) {
    return;
  }

  const userCount = await runQuery(client, 'SELECT COUNT(*) AS count FROM users');
  if (parseInt(userCount.rows[0].count, 10) !== 0) {
    return;
  }

  const id = process.env.BOOTSTRAP_SUPERVISOR_ID || 'U99';
  const name = process.env.BOOTSTRAP_SUPERVISOR_NAME || username;
  const role = process.env.BOOTSTRAP_SUPERVISOR_ROLE || 'supervisor';
  const roleLabel = process.env.BOOTSTRAP_SUPERVISOR_ROLE_LABEL || 'Superviseur site';
  const vacation = process.env.BOOTSTRAP_SUPERVISOR_VACATION || '24/7';
  const avatar = process.env.BOOTSTRAP_SUPERVISOR_AVATAR || 'SV';
  const hashedPassword = bcrypt.hashSync(password, 10);

  await runQuery(
    client,
    'INSERT INTO users (id, username, password, name, role, role_label, vacation, avatar) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [id, username.trim(), hashedPassword, name.trim(), role, roleLabel.trim(), vacation, avatar.trim()]
  );

  console.log('Bootstrap supervisor account created.');
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

    await bootstrapSupervisorAccount(client);
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
