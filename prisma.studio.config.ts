import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Prisma Studio uses Neon's pooled URL for reliable dashboard-style queries.
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),
  },
});
