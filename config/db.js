import 'dotenv/config';
import dns from 'node:dns';
import pkg from 'pg';
const { Pool } = pkg;

// Neon répond souvent en IPv6 en premier : on force l'IPv4 d'abord pour éviter les ETIMEDOUT
dns.setDefaultResultOrder('ipv4first');

const options = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      user: process.env.DB_USER,
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
      password: process.env.DB_PASSWORD,
      port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
    };

const pool = new Pool({
  ...options,
  connectionTimeoutMillis: 20000, // laisse le temps à Neon de se réveiller
  idleTimeoutMillis: 300000, // garde la connexion ouverte 5 min : évite de refaire une connexion lente
  keepAlive: true,
});

pool.on('connect', () => {
  console.log('Connecté à la base de données PostgreSQL avec succès.');
});

// Évite qu'une coupure réseau sur une connexion inactive fasse planter le serveur
pool.on('error', (err) => {
  console.error('Erreur sur une connexion inactive du pool:', err.code || err.name, err.message);
});

export default pool;
