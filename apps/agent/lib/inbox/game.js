"use strict";

// Game API calls for reward claims. The amount lives in the game, keyed by
// campaign; this side never sends one. The grant is once per player, enforced
// by the game's database, so a retried call cannot pay twice.

function createGame({ baseUrl, botApiKey, fetchImpl = fetch }) {
  async function call(method, route, body) {
    const r = await fetchImpl(new URL(route, baseUrl), {
      method,
      headers: { "X-Bot-Token": botApiKey, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    const data = await r.json().catch(() => ({}));
    return { status: r.status, ok: r.ok, data };
  }

  /** The player's linked game characters, or [] when the Discord account is not linked. */
  async function characters(discordId) {
    const r = await call("GET", `/api/discord-bot/lookup?discordId=${encodeURIComponent(discordId)}`);
    if (r.status === 404) return [];
    if (!r.ok) throw new Error(`game lookup ${r.status}`);
    return r.data.found === false ? [] : (r.data.characters || []);
  }

  async function grant({ campaign, discordId, claimRef, characterId }) {
    const r = await call("POST", "/api/discord-bot/promo-grant", { campaign, discordId, claimRef, ...(characterId ? { characterId } : {}) });
    if (r.ok && ["granted", "already_granted"].includes(r.data.status)) return r.data;
    const e = new Error(r.data.error || `promo grant ${r.status}`);
    e.status = r.status;
    throw e;
  }

  return { characters, grant };
}

module.exports = { createGame };
