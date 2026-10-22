import { getNeonPool, resetNeonPool } from "../src/config/neonPool.js";

// Compatibility facade: older controllers use this module, but all queries
// must go through the same IPv4-pinned Neon pool as the active server.
const pool = {
  async query(...args) {
    const connectedPool = await getNeonPool();
    try {
      return await connectedPool.query(...args);
    } catch (error) {
      const sql = typeof args[0] === "string" ? args[0] : args[0]?.text || "";
      const readOnly = /^\s*SELECT\b/i.test(sql);
      const transient = isTransient(error);
      if (!readOnly || !transient) throw error;

      // Re-resolve Neon before retrying: the old pool was pinned to one IPv4,
      // which could become unreachable while other Neon addresses are healthy.
      const replacementPool = await resetNeonPool(connectedPool);
      return replacementPool.query(...args);
    }
  },
  async connect(...args) {
    const connectedPool = await getNeonPool();
    try {
      return await connectedPool.connect(...args);
    } catch (error) {
      if (!isTransient(error)) throw error;
      const replacementPool = await resetNeonPool(connectedPool);
      return replacementPool.connect(...args);
    }
  },
  end() {
    return getNeonPool().then((connectedPool) => connectedPool.end());
  },
};

function isTransient(error) {
  const codes = new Set(["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "ENETUNREACH", "08000", "08003", "08006"]);
  for (let current = error; current; current = current.cause) {
    if (codes.has(current.code)) return true;
    if (/timeout exceeded when trying to connect|connection terminated|query read timeout|read timeout/i.test(current.message || "")) return true;
  }
  return false;
}

export default pool;
