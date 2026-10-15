// Ingest AHD Discord "idea" channels into a vectorized, searchable store.
// REST polling only (no gateway) so it never conflicts with the live bot.
// Embeds each human message with bge-small and upserts into `discord_ideas`.
// Idempotent by message id. Run on demand or via cron.
//   node mcp/ingest-discord.js [perChannel=200]
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
require("dotenv").config({ path: require("path").join(__dirname, "..", "mcp-discord.env") });
const { MongoClient } = require("mongodb");

const BOT = process.env.DISCORD_BOT_TOKEN;
const API = "https://discord.com/api/v10";
const DB_NAME = "a-house-divided";
const COLLECTION = "discord_ideas";
// Idea-bearing channels (names). Override with DISCORD_IDEA_CHANNELS (csv).
const IDEA_CHANNELS = (process.env.DISCORD_IDEA_CHANNELS ||
  "ideas-and-thoughts,suggestions-discussion,development-roadmap,current-stuff,dev-chat,gameplay-advisors")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
if (!BOT) { console.error("DISCORD_BOT_TOKEN required"); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function discord(path, tries = 0) {
  const r = await fetch(API + path, { headers: { Authorization: "Bot " + BOT } });
  if (r.status === 429 && tries < 8) { // rate limited — honour retry_after and retry
    const body = await r.json().catch(() => ({}));
    await sleep(Math.ceil(((body.retry_after || 1) + 0.25) * 1000));
    return discord(path, tries + 1);
  }
  if (!r.ok) throw new Error("discord " + r.status + " " + (await r.text()).slice(0, 120));
  return r.json();
}

let _pipe = null;
async function embed(text) {
  if (!_pipe) { const { pipeline } = await import("@xenova/transformers"); _pipe = await pipeline("feature-extraction", "Xenova/bge-small-en-v1.5"); }
  const out = await _pipe(String(text).slice(0, 4000), { pooling: "mean", normalize: true });
  return Array.from(out.data);
}

(async () => {
  // perChannel <= 0 (or "all") = full history backfill (paginate to the start).
  const arg = process.argv[2] || "200";
  const cap = (arg === "all" || parseInt(arg, 10) <= 0) ? Infinity : parseInt(arg, 10);
  const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 2 });
  await client.connect();
  const col = client.db(DB_NAME).collection(COLLECTION);
  await col.createIndex({ messageId: 1 }, { unique: true });
  await col.createIndex({ channelName: 1, ts: -1 });

  const guilds = await discord("/users/@me/guilds");
  const guildId = guilds[0].id;
  const chans = (await discord(`/guilds/${guildId}/channels`)).filter((c) => c.type === 0 || c.type === 5);
  const targets = chans.filter((c) => IDEA_CHANNELS.includes(c.name.toLowerCase()));
  console.log("ingesting from:", targets.map((c) => "#" + c.name).join(", ") || "(none matched)");

  let total = 0, embedded = 0;
  for (const ch of targets) {
    let before = null, got = 0;
    while (got < cap) {
      const page = await discord(`/channels/${ch.id}/messages?limit=100${before ? "&before=" + before : ""}`);
      if (!page.length) break;
      before = page[page.length - 1].id;
      got += page.length;
      for (const m of page) {
        if (m.author && m.author.bot) continue;
        const content = (m.content || "").trim();
        if (content.length < 12) continue; // skip trivial/empty
        total++;
        const exists = await col.findOne({ messageId: m.id }, { projection: { _id: 1 } });
        if (exists) continue; // already ingested (idempotent)
        const vec = await embed(content);
        embedded++;
        await col.updateOne({ messageId: m.id }, { $set: {
          messageId: m.id, channelId: ch.id, channelName: ch.name,
          author: m.author && (m.author.global_name || m.author.username),
          content, ts: new Date(m.timestamp),
          jumpLink: `https://discord.com/channels/${guildId}/${ch.id}/${m.id}`,
          embedding: vec,
        } }, { upsert: true });
      }
      process.stdout.write(`  #${ch.name}: ${got} scanned, ${embedded} new embedded\r`);
    }
    process.stdout.write("\n");
  }
  const count = await col.countDocuments();
  console.log(`\nseen ${total} human msgs, embedded ${embedded} new. collection total: ${count}`);
  process.exit(0);
})().catch((e) => { console.error("INGEST ERROR:", e); process.exit(1); });
