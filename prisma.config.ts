import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    // La CLI de migration utilise la connexion directe Neon.
    url: env("DIRECT_URL"),
    shadowDatabaseUrl: env("SHADOW_DATABASE_URL"),
  },
});
