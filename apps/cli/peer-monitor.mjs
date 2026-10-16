import crypto from "node:crypto";
import { inspectPeer, peerCredential } from "./peers.mjs";

// Read-only refreshes may reconnect automatically. Dispatch is deliberately
// separate: a lost handoff response must never start duplicate VPS work.
export function createPeerMonitor({ inspect = inspectPeer, env = process.env } = {}) {
  let pending;
  const cache = new Map();
  return {
    refresh(peers, options = {}) {
      if (pending) return pending;
      const keys = peers.map(peer => crypto.createHash("sha256").update(JSON.stringify([
        peer.id, peer.kind, peer.url, peer.directory, peer.tokenEnv, peer.auth, peer.cookieName, (() => { try { return peerCredential(peer, env) || ""; } catch { return "credential-unavailable"; } })(),
      ])).digest("hex"));
      for (const key of cache.keys()) if (!keys.includes(key)) cache.delete(key);
      pending = Promise.all(peers.map(async (peer, i) => {
        const observed = await inspect(peer, { ...options, env });
        const prior = cache.get(keys[i]);
        if (observed.state === "connected") {
          const current = { ...observed, stale: false, lastSuccessAt: observed.checkedAt };
          cache.set(keys[i], current);
          return current;
        }
        if (observed.errorKind === "auth") cache.delete(keys[i]);
        return { ...observed, stale: Boolean(prior && observed.errorKind !== "auth"),
          tasks: observed.errorKind === "auth" ? [] : prior?.tasks || [],
          lastSuccessAt: observed.errorKind === "auth" ? null : prior?.lastSuccessAt || null };
      })).finally(() => { pending = undefined; });
      return pending;
    },
  };
}
