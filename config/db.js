import { getNeonPool } from "../src/config/neonPool.js";

// Compatibility facade: older controllers use this module, but all queries
// must go through the same IPv4-pinned Neon pool as the active server.
const pool = {
  query(...args) {
    return getNeonPool().then((connectedPool) => connectedPool.query(...args));
  },
  connect(...args) {
    return getNeonPool().then((connectedPool) => connectedPool.connect(...args));
  },
  end() {
    return getNeonPool().then((connectedPool) => connectedPool.end());
  },
};

export default pool;
