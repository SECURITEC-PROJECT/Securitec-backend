import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Prisma Studio and introspection use Neon's direct connection.
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DIRECT_URL"),
  },
});
