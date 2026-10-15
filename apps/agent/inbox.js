"use strict";
const http = require("node:http");
const path = require("node:path");
const { createDiscord } = require("./lib/operator/discord");
const { createInboxStore } = require("./lib/inbox/store");
const { createDiscovery } = require("./lib/inbox/discovery");
const { createIngest } = require("./lib/inbox/ingest");
const { createVision } = require("./lib/inbox/vision");
const { createGame } = require("./lib/inbox/game");
const { createClaims } = require("./lib/inbox/claims");
const { createPublicHandler, createAdminHandler } = require("./lib/inbox/http");
const { readAlerts } = require("./lib/inbox/alerts");

// Keir inbox: archives DMs, tickets and guild conversations for the ops
// dashboard, and runs the itch.io reward claims. Separate from the operator so
// an inbox fault never touches the operator ledger.

const env = process.env;
const log = (msg) => console.log(`[keir-inbox] ${msg}`);
const stateDir = env.KEIR_INBOX_DIR || env.STATE_DIRECTORY || "/var/lib/keir-inbox";
const attachmentsDir = path.join(stateDir, "attachments");
const botId = env.KEIR_BOT_ID || "1479984768194969663";
const staffIds = [env.KEIR_OWNER_ID || "333052320252297216", ...(env.KEIR_SUPPORT_DELEGATES || "565289871799746593").split(",")].filter(Boolean);

for (const key of ["DISCORD_BOT_TOKEN", "KEIR_INBOX_ADMIN_TOKEN"]) if (!env[key]) { console.error(`[keir-inbox] ${key} is required`); process.exit(1); }

const discord = createDiscord({ token: env.DISCORD_BOT_TOKEN });
const store = createInboxStore(path.join(stateDir, "inbox.db"));
const guildId = env.KEIR_GUILD_ID || "1465445442987888743";
const ingest = createIngest({ discord, store, botId, guildId, attachmentsDir });
const discovery = createDiscovery({ discord, ingest, store, guildId, log });
const vision = createVision({ attachmentsDir, claudeBin: env.CLAUDE_BIN || undefined });
const game = createGame({ baseUrl: env.GAME_API_URL || "https://ahousedividedgame.com", botApiKey: env.DISCORD_BOT_API_KEY });
const campaign = env.KEIR_PROMO_CAMPAIGN || "itch-boost-2026-10";
const active = env.KEIR_PROMO_ACTIVE === "1" && Boolean(env.DISCORD_BOT_API_KEY) && vision.configured;
// Discord ids that run the full claim check without being paid (dry runs).
const testers = (env.KEIR_PROMO_TESTERS || "").split(",").map((x) => x.trim()).filter(Boolean);
const claims = createClaims({ store, ingest, game, vision, campaign, active, staffIds, testers, botId, log });

const publicServer = http.createServer(createPublicHandler({ ingest, onNew: claims.onMessage, log }));
const adminServer = http.createServer(createAdminHandler({ token: env.KEIR_INBOX_ADMIN_TOKEN, store, ingest, claims, attachmentsDir, alerts: () => readAlerts(), log }));

// Discovery and backfill catch missed events and replies sent by other Keir
// processes. Only recent inbound messages are acted on, so a long outage does
// not answer stale messages.
const BACKFILL_MS = 5 * 60_000;
let backfilling = false;
async function backfillAll() {
  if (backfilling) return;
  backfilling = true;
  try {
    try { await discovery.scan(); } catch (e) { log(`archive discovery: ${e.message}`); }
    for (const t of store.activeThreads(Date.now() - 14 * 86_400_000)) {
      if (t.kind !== "dm") continue;
      try {
        for (const m of await ingest.backfill(t.channel_id)) if (Date.now() - m.at < 3_600_000) await claims.onMessage(m);
      } catch (e) { log(`backfill ${t.channel_id}: ${e.message}`); }
    }
  } finally { backfilling = false; }
}

publicServer.listen(Number(env.KEIR_INBOX_PUBLIC_PORT || 9766), "127.0.0.1");
adminServer.listen(Number(env.KEIR_INBOX_ADMIN_PORT || 9767), "127.0.0.1", () => {
  log(`started; campaign ${campaign} ${active ? "ACTIVE" : "inactive"}`);
  claims.recover();
  backfillAll();
  setInterval(backfillAll, BACKFILL_MS).unref();
});

for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { publicServer.close(); adminServer.close(); store.close(); process.exit(0); });
