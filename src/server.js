import "dotenv/config";
import { setDefaultResultOrder } from "node:dns";
import { createServer } from "node:http";
import { handleRequest } from "./routes.js";
import { closePool } from "./server-support.js";

setDefaultResultOrder("ipv4first");
const port = Number(process.env.PORT || 5000);
const server = createServer(handleRequest);

server.listen(port, () => {
  console.log("Backend Securitec démarré sur http://localhost:" + port);
  console.log("Vérification API/base : http://localhost:" + port + "/api/health");
});

async function shutdown() {
  await new Promise((resolve) => server.close(resolve));
  await closePool();
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
