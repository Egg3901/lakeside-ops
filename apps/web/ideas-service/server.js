// AHD Ideas service — scaled semantic search + RAG over the vectorized Discord
// corpus. Loads the on-disk HNSW index (data/ideas.hnsw) + label map into RAM,
// embeds queries with bge-small, and answers questions with DeepSeek grounded
// in real messages. Auto-reloads as the ingest grows the index. localhost-only;
// the dashboard proxies to it and enforces admin auth.  node ideas-service/server.js
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const path = require("path");
const fs = require("fs");
const express = require("express");
const { MongoClient } = require("mongodb");
const { HierarchicalNSW } = require("hnswlib-node");

const PORT = parseInt(process.env.IDEAS_PORT || "9728", 10);
const DIM = 384;
const DATA = path.join(__dirname, "..", "data");
const INDEX_FILE = path.join(DATA, "ideas.hnsw");
const LABELS_FILE = path.join(DATA, "ideas-labels.json");
const OURL = process.env.OLLAMA_URL || "http://localhost:11434/v1/chat/completions";
const MODEL = process.env.AUDIT_MODEL || "deepseek-v4-flash:cloud";

let index = null, labels = [], idxMtime = 0;
function loadIndex() {
  if (!fs.existsSync(INDEX_FILE) || !fs.existsSync(LABELS_FILE)) return false;
  const mtime = fs.statSync(INDEX_FILE).mtimeMs;
  if (mtime === idxMtime) return true; // unchanged
  try {
    const lbl = JSON.parse(fs.readFileSync(LABELS_FILE, "utf8"));
    const ix = new HierarchicalNSW("cosine", DIM);
    ix.readIndexSync(INDEX_FILE);
    ix.setEf(80);
    index = ix; labels = lbl; idxMtime = mtime;
    console.log(`[ideas] index loaded: ${labels.length} vectors`);
    return true;
  } catch (e) { console.warn("[ideas] index reload skipped (mid-write?):", e.message); return !!index; }
}

let _pipe = null;
async function embed(text, isQuery = true) {
  if (!_pipe) { const { pipeline } = await import("@xenova/transformers"); _pipe = await pipeline("feature-extraction", "Xenova/bge-small-en-v1.5"); }
  const prefix = isQuery ? "Represent this sentence for searching relevant passages: " : "";
  const out = await _pipe(prefix + String(text).slice(0, 4000), { pooling: "mean", normalize: true });
  return Array.from(out.data);
}
async function deepseek(messages, max = 900) {
  const r = await fetch(OURL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: MODEL, messages, temperature: 0.2, max_tokens: max }) });
  if (!r.ok) throw new Error("ollama " + r.status);
  return (await r.json()).choices[0].message.content;
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 4 });
  await client.connect();
  const msgs = client.db("a-house-divided").collection("discord_messages");
  loadIndex();
  setInterval(loadIndex, 120000); // pick up ingest growth every 2 min

  // label ids -> ordered message docs
  async function knnDocs(qvec, k) {
    if (!index || !labels.length) return [];
    const n = Math.min(k, labels.length);
    const res = index.searchKnn(qvec, n);
    const ids = res.neighbors.map((l) => labels[l]).filter(Boolean);
    const score = {}; res.neighbors.forEach((l, i) => { score[labels[l]] = 1 - res.distances[i]; });
    const docs = await msgs.find({ messageId: { $in: ids } }, { projection: { _id: 0, messageId: 1, content: 1, author: 1, channelName: 1, ts: 1, jumpLink: 1 } }).toArray();
    return docs.map((d) => ({ ...d, score: Number((score[d.messageId] || 0).toFixed(4)) })).sort((a, b) => b.score - a.score);
  }

  const app = express();
  app.use(express.json({ limit: "256kb" }));
  app.get("/healthz", (_q, r) => r.json({ ok: true, vectors: labels.length, loaded: !!index }));
  app.get("/reload", (_q, r) => { idxMtime = 0; r.json({ ok: loadIndex(), vectors: labels.length }); });

  app.get("/search", async (req, res) => {
    try {
      const q = String(req.query.q || "").trim();
      if (!q) return res.json({ results: [] });
      const limit = Math.min(parseInt(req.query.limit || "25", 10), 50);
      const docs = await knnDocs(await embed(q), limit);
      res.json({ results: docs, vectors: labels.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post("/ask", async (req, res) => {
    try {
      const question = String((req.body && req.body.question) || "").trim();
      if (!question) return res.status(400).json({ error: "question required" });
      const sources = await knnDocs(await embed(question), 16);
      if (!sources.length) return res.json({ answer: "No indexed messages yet.", sources: [] });
      const ctx = sources.map((s, i) => `[${i + 1}] (#${s.channelName}, ${s.author}) ${s.content.replace(/\n/g, " ").slice(0, 280)}`).join("\n");
      const answer = await deepseek([
        { role: "system", content: 'You answer questions about the game "A House Divided" using ONLY the community Discord messages provided. Be concise and concrete. Cite supporting messages inline as [1], [2]. If the messages do not answer it, say so.' },
        { role: "user", content: `Question: ${question}\n\nCommunity messages:\n${ctx}` },
      ]);
      res.json({ answer, sources });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.listen(PORT, "127.0.0.1", () => console.log(`[ideas] service on 127.0.0.1:${PORT} — ${labels.length} vectors`));
}
main().catch((e) => { console.error("[ideas] fatal:", e); process.exit(1); });
