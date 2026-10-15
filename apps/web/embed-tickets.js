// Embed support tickets (title+description) with bge-small so the knowledge
// graph can link them to related docs/skills/memory. Idempotent; --all forces.
// Run: node embed-tickets.js [--all]
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
  const col = c.db("a-house-divided").collection("tickets");
  const docs = await col.find(FORCE ? {} : { embedding: { $exists: false } }).toArray();
  console.log(`embedding ${docs.length} tickets…`);
  let n = 0;
  for (const t of docs) {
    const text = [t.title, t.description].filter(Boolean).join("\n");
    if (!text.trim()) continue;
    await col.updateOne({ _id: t._id }, { $set: { embedding: await embed(text), embeddedAt: new Date() } });
    n++;
  }
  console.log(`done — embedded ${n}.`);
  await c.close();
  process.exit(0);
})().catch((e) => { console.error("ERROR:", e); process.exit(1); });
