import { apiPrefix, allowedOrigins, json } from "./server-support.js";
import { handleOperations } from "./routes/operations.js";
import { handleReports } from "./routes/reports.js";
import { handleAuth } from "./routes/auth.js";
import { handleAccessControl } from "./routes/access-control.js";
import { handleLogistics } from "./routes/logistics.js";
import { handlePatrols } from "./routes/patrols.js";
import { handleCameras } from "./routes/cameras.js";

const allowedMethods = "GET, POST, PUT, PATCH, DELETE, OPTIONS";

export async function handleRequest(request, response) {
  const origin = request.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Methods", allowedMethods);
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }
  if (request.method === "OPTIONS") return response.writeHead(204).end();

  const pathname = new URL(request.url || "/", "http://" + (request.headers.host || "localhost")).pathname;
  if (pathname === apiPrefix + "/cameras" || pathname.startsWith(apiPrefix + "/cameras/") || pathname === apiPrefix + "/camera-zones") {
    await handleCameras(request, response, pathname);
    return;
  }
  if (pathname === apiPrefix + "/logistics" || pathname.startsWith(apiPrefix + "/logistics/")) {
    await handleLogistics(request, response, pathname);
    return;
  }
  if (pathname === apiPrefix + "/patrols" || pathname.startsWith(apiPrefix + "/patrols/")) {
    await handlePatrols(request, response, pathname);
    return;
  }
  const accessControlRoute = apiPrefix + "/access-control";
  if (pathname === accessControlRoute || pathname.startsWith(accessControlRoute + "/")) {
    await handleAccessControl(request, response, pathname);
    return;
  }
  const operationRoutes = ["/sites", "/visitors", "/vehicles", "/shifts", "/passations"].map((route) => apiPrefix + route);
  if (operationRoutes.some((route) => pathname === route || pathname.startsWith(route + "/"))) {
    await handleOperations(request, response, pathname);
    if (!response.writableEnded) json(response, 404, { error: "Route introuvable" });
    return;
  }
  const reportsRoute = apiPrefix + "/service-reports";
  if (pathname === reportsRoute || pathname.startsWith(reportsRoute + "/")) {
    await handleReports(request, response, pathname);
    if (!response.writableEnded) json(response, 404, { error: "Route introuvable" });
    return;
  }
  if ([apiPrefix + "/auth/login", apiPrefix + "/auth/me", apiPrefix + "/health"].includes(pathname)) {
    await handleAuth(request, response, pathname);
    if (!response.writableEnded) json(response, 404, { error: "Route introuvable" });
    return;
  }
  return json(response, 404, { error: "Route introuvable" });
}
