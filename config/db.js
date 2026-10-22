import { getNeonPool } from "../src/config/neonPool.js";

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
      const transient = ["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "ENETUNREACH", "08000", "08003", "08006"]
        .includes(error.code) || /connection terminated (unexpectedly|due to connection timeout)/i.test(error.message || "");
      if (!readOnly || !transient) throw error;

      // Neon may close an idle socket while resuming its compute. The pool
      // discards that socket; retry this read once on a fresh connection.
      return connectedPool.query(...args);
    }
  },
  connect(...args) {
    return getNeonPool().then((connectedPool) => connectedPool.connect(...args));
  },
  end() {
    return getNeonPool().then((connectedPool) => connectedPool.end());
  },
};

export default pool;
