"use strict";

// Discover Keir conversations without turning ambient guild chat into tasks.
// A persisted cursor avoids rereading inactive channels. The first pass retains
// one day of context; known conversations then catch up from their archive cursor.
function createDiscovery({ discord, ingest, store, guildId, now = () => Date.now(), log = console.log }) {
  async function scan() {
    if (!guildId) return;
    const channels = await discord("GET", `/guilds/${guildId}/channels`);
    let active = { threads: [] };
    try { active = await discord("GET", `/guilds/${guildId}/threads/active`); }
    catch (e) { log(`archive active threads: ${e.message}`); }
    const byId = new Map([...channels, ...(active.threads || [])].map((c) => [c.id, { ...c, guild_id: guildId }]));
    // Previously observed archived/private threads can be absent from active.
    for (const t of store.listThreads({ limit: 500 })) if (t.guild_id === guildId && !byId.has(t.channel_id)) {
      try { byId.set(t.channel_id, await discord("GET", `/channels/${t.channel_id}`)); }
      catch (e) { log(`archive channel ${t.channel_id}: ${e.message}`); }
    }
    const dayCursor = String(BigInt(now() - 86400000 - 1420070400000) << 22n);
    for (const ch of byId.values()) {
      if (![0, 5, 10, 11, 12].includes(ch.type)) continue;
      try {
        const known = store.thread(ch.id);
        if (known) { await ingest.backfill(ch.id); continue; }
        let after = store.discoveryCursor(ch.id) || dayCursor;
        if (ch.last_message_id && ch.last_message_id === after) continue;
        for (let page = 0; page < 10; page++) {
          const rows = await discord("GET", `/channels/${ch.id}/messages?limit=100&after=${after}`);
          if (!rows.length) break;
          rows.sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1);
          await ingest.recordChannel(ch, rows);
          after = rows.at(-1).id;
          store.setDiscoveryCursor(ch.id, after);
          if (rows.length < 100) break;
        }
      } catch (e) { log(`archive scan ${ch.id}: ${e.message}`); }
    }
  }
  return { scan };
}
module.exports = { createDiscovery };
