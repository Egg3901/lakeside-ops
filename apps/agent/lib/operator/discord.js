"use strict";
const fs = require("node:fs");
function createDiscord({ token, fetchImpl = fetch, onMessages, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  async function discord(method, route, body, files = []) {
    const retrySafe = method === "GET" || (method === "POST" && route === "/users/@me/channels") ||
      (method === "POST" && /^\/channels\/\d+\/messages$/.test(route) && body?.enforce_nonce === true && Boolean(body.nonce));
    for (let attempt = 0; attempt < 3; attempt++) {
      let encoded = body === undefined ? undefined : JSON.stringify(body);
      if (files.length) {
        encoded = new FormData(); encoded.append("payload_json", JSON.stringify(body));
        files.forEach((f, i) => encoded.append(`files[${i}]`, new Blob([fs.readFileSync(f.path)], { type: /\.png$/i.test(f.name) ? "image/png" : "text/plain" }), f.name));
      }
      try {
        const r = await fetchImpl(`https://discord.com/api/v10${route}`, { method, headers: { Authorization: `Bot ${token}`, ...(!files.length ? { "Content-Type": "application/json" } : {}), "User-Agent": "DiscordBot (KeirOperator, 1.0)" },
          body: encoded, signal: AbortSignal.timeout(20000) });
        if (r.status === 429) {
          const wait = Math.min(Number((await r.json()).retry_after || 2), 30);
          await sleep(wait * 1000); continue;
        }
        if (!r.ok) {
          const error = new Error(`Discord ${method} ${route.split("?")[0]}: ${r.status}`); error.status = r.status; throw error;
        }
        const result = r.status === 204 ? null : await r.json();
        const channel = /^\/channels\/(\d+)\/messages(?:[/?]|$)/.exec(route);
        if (onMessages && channel && result) {
          const messages = (Array.isArray(result) ? result : [result]).filter((m) => m.id && m.author && m.timestamp);
          if (messages.length) await onMessages(channel[1], messages);
        }
        return result;
      } catch (e) {
        if (e.status && e.status < 500) throw e;
        if (retrySafe && attempt < 2) { await sleep(500 * 2 ** attempt); continue; }
        const cause = e.cause?.code || e.code || e.name;
        const error = new Error(`Discord ${method} ${route.split("?")[0]} failed after ${attempt + 1} attempt(s) (${cause}): ${e.message}`);
        error.status = e.status; throw error;
      }
    }
    throw new Error(`Discord ${method} ${route.split("?")[0]} remained rate limited`);
  }
  return discord;
}
function createScanHealth({ ledger, now = () => Date.now() }) {
  const state = ledger.data.scanHealth ||= { failures: 0 };
  function success() {
    const recovered = state.failures;
    state.failures = 0; state.lastSuccessAt = now(); delete state.lastError;
    return recovered;
  }
  function failure(error) {
    state.failures++; state.lastFailureAt = now(); state.lastError = error.message;
    return state.failures >= 3 || [401, 403].includes(error.status);
  }
  return { state, success, failure };
}
module.exports = { createDiscord, createScanHealth };
