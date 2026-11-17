import 'dotenv/config'
import { defineConfig, env } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    // Prisma Migrate et Studio passent par la connexion directe.
    url: env('DIRECT_URL'),
  },
})
