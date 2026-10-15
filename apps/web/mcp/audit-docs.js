// DeepSeek doc auditor — runs Ollama Cloud deepseek "sub-agents" (concurrent)
// over the docs collection to (1) classify each doc keep/trim/improve and
// (2) surface coverage gaps. Verdicts persist to metadata.audit so the docs
// app / curation can act on them.  Usage: node mcp/audit-docs.js [limit]
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const store = require("../knowledge-store");

// Local Ollama (localhost:11434) proxies Ollama Cloud models (e.g.
// deepseek-v4-flash:cloud) — no key needed. Falls back to direct cloud if a key
// is set. Both speak the OpenAI /v1/chat/completions shape.
const URL = process.env.OLLAMA_URL || process.env.OLLAMA_CLOUD_URL || "https://ollama.com/v1/chat/completions";
const KEY = process.env.OLLAMA_CLOUD_KEY;
const MODEL = process.env.AUDIT_MODEL || "deepseek-v4-flash:cloud";

async function ask(messages, maxTokens = 400) {
  const headers = { "Content-Type": "application/json" };
  if (KEY) headers.Authorization = "Bearer " + KEY;
  const r = await fetch(URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ model: MODEL, messages, temperature: 0, max_tokens: maxTokens }),
  });
  if (!r.ok) throw new Error("http " + r.status + " " + (await r.text()).slice(0, 160));
  const j = await r.json();
  return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
}

async function auditDoc(d) {
  const sys =
    'You audit internal engineering/design docs for a political-simulation game. ' +
    'Judge each doc\'s LASTING reference value. Reply ONLY compact JSON: ' +
    '{"verdict":"keep|trim|improve","reason":"<=14 words"}. ' +
    "trim = stale / superseded / one-off plan or spec / duplicate / low-signal. " +
    "keep = evergreen reference. improve = useful but outdated, thin, or unclear.";
  const user =
    "Title: " + (d.title || d.name) +
    "\nSection: " + ((d.metadata && d.metadata.section) || "") +
    "\nPath: " + ((d.metadata && d.metadata.path) || "") +
    "\n\n" + (d.body || "").slice(0, 3000);
  const out = await ask([{ role: "system", content: sys }, { role: "user", content: user }]);
  try { return JSON.parse(out.match(/\{[\s\S]*\}/)[0]); }
  catch { return { verdict: "?", reason: out.slice(0, 60) }; }
}

async function pool(items, n, fn) {
  const res = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const idx = i++; try { res[idx] = await fn(items[idx], idx); } catch (e) { res[idx] = { error: e.message }; } }
  }));
  return res;
}

(async () => {
  const limit = parseInt(process.argv[2] || "0", 10);
  const db = await store.getDb();
  let docs = await db.collection(store.COLLECTION)
    .find({ kind: "docs", deletedAt: null })
    .project({ title: 1, name: 1, body: 1, "metadata.section": 1, "metadata.path": 1 }).toArray();
  if (limit) docs = docs.slice(0, limit);
  console.log(`auditing ${docs.length} docs with ${MODEL} (concurrency 4)…\n`);

  const verdicts = await pool(docs, 4, async (d) => {
    const v = await auditDoc(d);
    await db.collection(store.COLLECTION).updateOne({ _id: d._id },
      { $set: { "metadata.audit": { ...v, at: new Date(), model: MODEL } } });
    return { name: d.name, section: (d.metadata && d.metadata.section) || "", ...v };
  });

  const by = {}; verdicts.forEach((v) => { const k = (v && v.verdict) || "error"; by[k] = (by[k] || 0) + 1; });
  console.log("verdicts:", JSON.stringify(by));
  console.log("\n── TRIM candidates ──");
  verdicts.filter((v) => v && v.verdict === "trim").forEach((v) => console.log("  ✗", v.name, "—", v.reason));
  console.log("\n── IMPROVE ──");
  verdicts.filter((v) => v && v.verdict === "improve").forEach((v) => console.log("  ~", v.name, "—", v.reason));

  const titles = docs.map((d) => ((d.metadata && d.metadata.section) || "") + ": " + (d.title || d.name)).join("\n");
  const gaps = await ask([
    { role: "system", content: "You are a documentation lead for a political-simulation game codebase. Given the existing doc titles, list the 8 most important MISSING or underdocumented topics an engineer or AI agent would need. Short bullet list, each <=12 words." },
    { role: "user", content: titles },
  ], 600);
  console.log("\n═══ GAP ANALYSIS (DeepSeek) ═══\n" + gaps);
  process.exit(0);
})().catch((e) => { console.error("AUDIT ERROR:", e); process.exit(1); });
