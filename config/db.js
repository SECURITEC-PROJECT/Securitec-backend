import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : new Pool({
      user: process.env.DB_USER,
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
      password: process.env.DB_PASSWORD,
      port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
    });

pool.on('connect', () => {
  console.log('Connecté à la base de données PostgreSQL avec succès.');
});

export default pool;