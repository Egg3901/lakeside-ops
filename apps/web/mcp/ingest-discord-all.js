// Scaled Discord ingest — ALL channels, full history, resumable.
// Messages -> Mongo `discord_messages` (text only, light).
// Embeddings -> on-disk HNSW index (data/ideas.hnsw) + label map (ideas-labels.json).
// Batched embedding; REST-only (no gateway, no conflict with the live bot).
// Resumable: per-channel cursor in `discord_ingest_state`; re-run to continue.
// Run niced:  nice -n 15 node mcp/ingest-discord-all.js
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
const BATCH = 32;
if (!BOT) { console.error("DISCORD_BOT_TOKEN required"); process.exit(1); }
if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });

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

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3 });
  await client.connect();
  const db = client.db("a-house-divided");
  const msgs = db.collection("discord_messages"), state = db.collection("discord_ingest_state");
  await msgs.createIndex({ messageId: 1 }, { unique: true });
  await msgs.createIndex({ channelName: 1, ts: -1 });

  // load or init the HNSW index + label map
  let labels = [], maxEl = 50000;
  const index = new HierarchicalNSW("cosine", DIM);
  if (fs.existsSync(INDEX_FILE) && fs.existsSync(LABELS_FILE)) {
    labels = JSON.parse(fs.readFileSync(LABELS_FILE, "utf8"));
    index.readIndexSync(INDEX_FILE);
    maxEl = Math.max(50000, labels.length + 20000);
    index.resizeIndex(maxEl);
    console.log(`resumed index: ${labels.length} vectors`);
  } else { index.initIndex(maxEl, 16, 200); }
  let nextLabel = labels.length;
  function ensure(add) { if (nextLabel + add > maxEl) { maxEl = Math.max(maxEl * 2, nextLabel + add + 20000); index.resizeIndex(maxEl); } }
  function save() { index.writeIndexSync(INDEX_FILE); fs.writeFileSync(LABELS_FILE, JSON.stringify(labels)); }

  const gid = (await discord("/users/@me/guilds"))[0].id;
  const chans = (await discord(`/guilds/${gid}/channels`)).filter((c) => c.type === 0 || c.type === 5);
  console.log(`ingesting ${chans.length} channels (resumable)…`);
  let totalNew = 0, sinceSave = 0;

  for (const ch of chans) {
    let st = (await state.findOne({ channelId: ch.id })) || { channelId: ch.id, channelName: ch.name, oldestId: null, done: false, count: 0 };
    if (st.done) { console.log(`  #${ch.name}: done (${st.count})`); continue; }
    let before = st.oldestId;
    for (;;) {
      let page;
      try { page = await discord(`/channels/${ch.id}/messages?limit=100${before ? "&before=" + before : ""}`); }
      catch (e) { console.error(`  #${ch.name}: ${e.message} — pausing channel`); break; }
      if (!page.length) { st.done = true; break; }
      before = page[page.length - 1].id;
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
          totalNew += chunk.length; sinceSave += chunk.length; st.count += chunk.length;
        }
      }
      st.oldestId = before;
      await state.updateOne({ channelId: ch.id }, { $set: st }, { upsert: true });
      if (sinceSave >= 4000) { save(); console.log(`  …saved · total new ${totalNew} · index ${labels.length}`); sinceSave = 0; }
      process.stdout.write(`  #${ch.name}: ${st.count} embedded\r`);
    }
    await state.updateOne({ channelId: ch.id }, { $set: st }, { upsert: true });
    process.stdout.write("\n");
  }
  save();
  console.log(`\nDONE. messages: ${await msgs.countDocuments()} · index vectors: ${labels.length}`);
  process.exit(0);
})().catch((e) => { console.error("INGEST ERROR:", e); process.exit(1); });
