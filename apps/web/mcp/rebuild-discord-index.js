// Rebuild data/ideas.hnsw + ideas-labels.json from Mongo `discord_messages`,
// for when the on-disk index is corrupted (first needed 2026-09-01: the index
// truncated to 9MB during its 2026-08-27 write and every hourly incremental
// died on readIndexSync for two days). Messages and their text live in Mongo,
// embeddings are local bge-small, so no Discord traffic is needed.
//
// After a successful rebuild this clears `discord_ingest_state`, so the next
// ingest-discord-new.js run re-baselines each channel from Mongo's newest
// message and pulls anything later from Discord.
//   nice -n 15 node mcp/rebuild-discord-index.js
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
require("dotenv").config({ path: require("path").join(__dirname, "..", "mcp-discord.env") });
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
const { HierarchicalNSW } = require("hnswlib-node");

const DIM = 384, BATCH = 64;
const DATA = path.join(__dirname, "..", "data");
const INDEX_FILE = path.join(DATA, "ideas.hnsw");
const LABELS_FILE = path.join(DATA, "ideas-labels.json");
const LOCK_FILE = path.join(DATA, "ingest.lock");

if (fs.existsSync(LOCK_FILE)) {
  const age = Date.now() - fs.statSync(LOCK_FILE).mtimeMs;
  if (age < 55 * 60 * 1000) { console.error("ingest lock held — not rebuilding under a live ingest"); process.exit(1); }
}
fs.writeFileSync(LOCK_FILE, String(process.pid));
process.on("exit", () => { try { fs.unlinkSync(LOCK_FILE); } catch (_) {} });

let _pipe = null;
async function embedBatch(texts) {
  if (!_pipe) { const { pipeline } = await import("@xenova/transformers"); _pipe = await pipeline("feature-extraction", "Xenova/bge-small-en-v1.5"); }
  const out = await _pipe(texts, { pooling: "mean", normalize: true });
  const arr = [];
  for (let i = 0; i < texts.length; i++) arr.push(Array.from(out.data.slice(i * DIM, (i + 1) * DIM)));
  return arr;
}

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3, directConnection: true });
  await client.connect();
  const db = client.db("a-house-divided");
  const msgs = db.collection("discord_messages");

  const total = await msgs.countDocuments();
  console.log(`rebuilding from ${total} messages in Mongo`);
  const index = new HierarchicalNSW("cosine", DIM);
  index.initIndex(total + 20000);
  const labels = [];

  // Paginate by _id instead of holding one cursor open: embedding 150k
  // messages takes ~35 minutes and Mongo reaps idle cursors long before that
  // (first attempt died at 85% with CursorNotFound). Each page is a fresh,
  // short-lived query.
  let done = 0;
  let lastId = null;
  const t0 = Date.now();
  const PAGE = 2048;
  for (;;) {
    const page = await msgs
      .find(lastId ? { _id: { $gt: lastId } } : {}, { projection: { messageId: 1, content: 1 } })
      .sort({ _id: 1 })
      .limit(PAGE)
      .toArray();
    if (!page.length) break;
    lastId = page[page.length - 1]._id;
    for (let s = 0; s < page.length; s += BATCH) {
      const chunk = page.slice(s, s + BATCH);
      const vecs = await embedBatch(chunk.map((d) => (d.content || "").trim().slice(0, 2000) || " "));
      for (let i = 0; i < chunk.length; i++) {
        index.addPoint(vecs[i], labels.length);
        labels.push(chunk[i].messageId);
      }
    }
    done += page.length;
    const rate = done / ((Date.now() - t0) / 1000);
    if (done % (PAGE * 4) < PAGE) {
      console.log(`  ${done}/${total} (${rate.toFixed(0)}/s, ~${Math.round((total - done) / rate)}s left)`);
    }
  }

  index.writeIndexSync(INDEX_FILE + ".tmp");
  fs.renameSync(INDEX_FILE + ".tmp", INDEX_FILE);
  fs.writeFileSync(LABELS_FILE + ".tmp", JSON.stringify(labels));
  fs.renameSync(LABELS_FILE + ".tmp", LABELS_FILE);
  const size = fs.statSync(INDEX_FILE).size;
  if (size < labels.length * DIM * 2) {
    console.error(`index file suspiciously small (${size} bytes for ${labels.length} points) — NOT resetting ingest state`);
    process.exit(1);
  }

  const cleared = await db.collection("discord_ingest_state").deleteMany({});
  console.log(`DONE: ${labels.length} points, index ${(size / 1e6).toFixed(1)}MB, ingest state cleared (${cleared.deletedCount} channels re-baseline from Mongo)`);
  process.exit(0);
})().catch((e) => { console.error("REBUILD ERROR:", e); process.exit(1); });
