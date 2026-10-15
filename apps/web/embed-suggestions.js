// Embed player suggestions (title+description+impact) with bge-small and store
// the vector on each suggestion doc, so the knowledge-graph endpoint can link
// suggestions to the docs/skills/memory they relate to. Idempotent; re-run to
// refresh (only embeds docs missing/forced). Run: node embed-suggestions.js [--all]
require("dotenv").config();
const { MongoClient } = require("mongodb");

const FORCE = process.argv.includes("--all");
let _pipe = null;
async function embed(text) {
  if (!_pipe) { const { pipeline } = await import("@xenova/transformers"); _pipe = await pipeline("feature-extraction", "Xenova/bge-small-en-v1.5"); }
  const out = await _pipe(String(text).slice(0, 4000), { pooling: "mean", normalize: true });
  return Array.from(out.data);
}

(async () => {
  const c = new MongoClient(process.env.MONGODB_URI, { directConnection: true });
  await c.connect();
  const col = c.db("a-house-divided").collection("suggestions");
  const q = FORCE ? {} : { embedding: { $exists: false } };
  const docs = await col.find(q).toArray();
  console.log(`embedding ${docs.length} suggestions…`);
  let n = 0;
  for (const s of docs) {
    const text = [s.title, s.description, s.impact].filter(Boolean).join("\n");
    if (!text.trim()) continue;
    const vec = await embed(text);
    await col.updateOne({ _id: s._id }, { $set: { embedding: vec, embeddedAt: new Date() } });
    n++;
  }
  console.log(`done — embedded ${n}.`);
  await c.close();
  process.exit(0);
})().catch((e) => { console.error("ERROR:", e); process.exit(1); });
