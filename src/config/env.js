import 'dotenv/config'

export const env = {
  port: Number(process.env.PORT || 5000),
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
}

if (!env.databaseUrl) throw new Error('DATABASE_URL est absent du fichier .env.')
if (!env.jwtSecret || Buffer.byteLength(env.jwtSecret) < 32) throw new Error('JWT_SECRET doit contenir au moins 32 caractères.')
