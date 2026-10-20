import {
    createPatrol,
    finishPatrol,
    getPatrols,
    updateCheckpoints,
} from "../controllers/patrolController.js";

const apiPrefix = "/api";

export async function handlePatrolRoutes(request, response, pool, pathname) {
  if (request.method === "GET" && pathname === `${apiPrefix}/patrols`) {
    await getPatrols(request, response, pool);
    return true;
  }
  if (request.method === "POST" && pathname === `${apiPrefix}/patrols`) {
    await createPatrol(request, response, pool);
    return true;
  }

  const checkMatch = pathname.match(/^\/api\/patrols\/(\d+)\/check$/);
  if (request.method === "PUT" && checkMatch) {
    await updateCheckpoints(request, response, pool, checkMatch[1]);
    return true;
  }

  const finishMatch = pathname.match(/^\/api\/patrols\/(\d+)\/finish$/);
  if (request.method === "PUT" && finishMatch) {
    await finishPatrol(request, response, pool, finishMatch[1]);
    return true;
  }

  return false;
}