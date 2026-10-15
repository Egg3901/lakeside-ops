// Forward-incremental Discord ingest — pulls messages NEWER than what's indexed
// and appends them to the HNSW index (the backfill script only walks backward).
// Per channel: fetch `after=` the newest known id, embed (bge-small, local — no
// LLM), upsert Mongo `discord_messages`, addPoint to data/ideas.hnsw. Idempotent
// (unique messageId). Atomic index save (tmp+rename). Lockfile guards overlap so
// the hourly timer never collides with a manual run. REST-only (no gateway).
//   node mcp/ingest-discord-new.js
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
require("dotenv").config({ path: require("path").join(__dirname, "..", "mcp-discord.env") });
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
const { HierarchicalNSW } = require("hnswlib-node");

const BOT = process.env.DISCORD_BOT_TOKEN, API = "https://discord.com/api/v10", DIM = 384;
const DATA = path.join(__dirname, "..", "data");
const INDEX_FILE = path.join(DATA, "ideas.hnsw");
const LABELS_FILE = path.join(DATA, "ideas-labels.json");
const LOCK_FILE = path.join(DATA, "ingest.lock");
const BATCH = 32;
if (!BOT) { console.error("DISCORD_BOT_TOKEN required"); process.exit(1); }
if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });

// stale-tolerant lock: honour a fresh lock, steal one older than 55 min.
if (fs.existsSync(LOCK_FILE)) {
  const age = Date.now() - fs.statSync(LOCK_FILE).mtimeMs;
  if (age < 55 * 60 * 1000) { console.log("another ingest is running (lock held) — exiting"); process.exit(0); }
}
fs.writeFileSync(LOCK_FILE, String(process.pid));
const releaseLock = () => { try { fs.unlinkSync(LOCK_FILE); } catch (_) {} };
process.on("exit", releaseLock);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function discord(p, tries = 0) {
  const r = await fetch(API + p, { headers: { Authorization: "Bot " + BOT } });
  if (r.status === 429 && tries < 10) { const b = await r.json().catch(() => ({})); await sleep(Math.ceil(((b.retry_after || 1) + 0.3) * 1000)); return discord(p, tries + 1); }
  if (!r.ok) throw new Error("discord " + r.status);
  return r.json();
}

let _pipe = null;
async function embedBatch(texts) {
  if (!_pipe) { const { pipeline } = await import("@xenova/transformers"); _pipe = await pipeline("feature-extraction", "Xenova/bge-small-en-v1.5"); }
  const out = await _pipe(texts, { pooling: "mean", normalize: true });
  const n = texts.length, arr = [];
  for (let i = 0; i < n; i++) arr.push(Array.from(out.data.slice(i * DIM, (i + 1) * DIM)));
  return arr;
}
const bigmax = (ids) => ids.reduce((a, b) => (BigInt(b) > BigInt(a) ? b : a));

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3, directConnection: true });
  await client.connect();
  const db = client.db("a-house-divided");
  const msgs = db.collection("discord_messages"), state = db.collection("discord_ingest_state");
  await msgs.createIndex({ messageId: 1 }, { unique: true }).catch(() => {});
  await msgs.createIndex({ channelName: 1, ts: -1 }).catch(() => {});

  if (!fs.existsSync(INDEX_FILE) || !fs.existsSync(LABELS_FILE)) {
    console.error("no existing index — run mcp/ingest-discord-all.js first (this script only appends).");
    process.exit(1);
  }
  const labels = JSON.parse(fs.readFileSync(LABELS_FILE, "utf8"));
  const index = new HierarchicalNSW("cosine", DIM);
  index.readIndexSync(INDEX_FILE);
  let maxEl = Math.max(index.getMaxElements(), labels.length + 20000);
  index.resizeIndex(maxEl);
  let nextLabel = labels.length;
  const startCount = labels.length;
  const ensure = (add) => { if (nextLabel + add > maxEl) { maxEl = nextLabel + add + 20000; index.resizeIndex(maxEl); } };
  const save = () => {
    index.writeIndexSync(INDEX_FILE + ".tmp"); fs.renameSync(INDEX_FILE + ".tmp", INDEX_FILE);
    fs.writeFileSync(LABELS_FILE + ".tmp", JSON.stringify(labels)); fs.renameSync(LABELS_FILE + ".tmp", LABELS_FILE);
  };

  const gid = (await discord("/users/@me/guilds"))[0].id;
  const chans = (await discord(`/guilds/${gid}/channels`)).filter((c) => c.type === 0 || c.type === 5);
  let totalNew = 0;

  for (const ch of chans) {
    let st = (await state.findOne({ channelId: ch.id })) || {};
    // baseline: newest id we've already indexed for this channel
    let after = st.newestId;
    if (!after) {
      const newest = await msgs.find({ channelId: ch.id }, { projection: { messageId: 1 } }).sort({ ts: -1 }).limit(1).next();
      if (!newest) continue; // cold channel — leave to the backfill script
      after = newest.messageId;
    }
    let chNew = 0;
    for (;;) {
      let page;
      try { page = await discord(`/channels/${ch.id}/messages?limit=100&after=${after}`); }
      catch (e) { console.error(`  #${ch.name}: ${e.message}`); break; }
      if (!page.length) break;
      const advance = bigmax(page.map((m) => m.id)); // forward cursor = highest id in window
      const cand = page.filter((m) => !(m.author && m.author.bot) && (m.content || "").trim().length >= 5);
      if (cand.length) {
        const ids = cand.map((m) => m.id);
        const have = new Set((await msgs.find({ messageId: { $in: ids } }, { projection: { messageId: 1 } }).toArray()).map((x) => x.messageId));
        const fresh = cand.filter((m) => !have.has(m.id));
        for (let s = 0; s < fresh.length; s += BATCH) {
          const chunk = fresh.slice(s, s + BATCH);
          const vecs = await embedBatch(chunk.map((m) => m.content.trim().slice(0, 2000)));
          ensure(chunk.length);
          const docs = [];
          for (let i = 0; i < chunk.length; i++) {
            const m = chunk[i], label = nextLabel++;
            index.addPoint(vecs[i], label); labels[label] = m.id;
            docs.push({ messageId: m.id, channelId: ch.id, channelName: ch.name, author: m.author && (m.author.global_name || m.author.username), content: m.content.trim(), ts: new Date(m.timestamp), jumpLink: `https://discord.com/channels/${gid}/${ch.id}/${m.id}` });
          }
          await msgs.insertMany(docs, { ordered: false }).catch(() => {});
          totalNew += chunk.length; chNew += chunk.length;
        }
      }
      after = advance;
      st.newestId = advance; st.channelName = ch.name;
      await state.updateOne({ channelId: ch.id }, { $set: { newestId: st.newestId, channelName: ch.name } }, { upsert: true });
      if (page.length < 100) break; // caught up to the present
    }
    if (chNew) console.log(`  #${ch.name}: +${chNew}`);
  }
  save();
  console.log(`\nDONE. +${totalNew} new messages (index ${startCount} -> ${labels.length}).`);
  process.exit(0);
})().catch((e) => { console.error("INGEST ERROR:", e); process.exit(1); });
