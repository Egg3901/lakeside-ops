// Extract common ideas / sentiments / themes from recent Discord chatter and
// store them as compact "theme" nodes (a curated, aggregated view of the 133k
// message corpus — NOT raw messages). Map-reduce over a per-channel sample:
//   map    — deepseek pulls candidate themes from each batch
//   reduce — deepseek merges them into ~15-20 canonical themes w/ sentiment
// Each theme is embedded (bge-small) so the knowledge graph can link it to the
// docs/skills/memory/suggestions it relates to. Replaces `discord_themes` each
// run (it's a current-state snapshot). LLM => run daily. Run: node mcp/extract-discord-themes.js
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { MongoClient } = require("mongodb");

const OLLAMA = process.env.OLLAMA_HOST || "127.0.0.1:11434";
const MODEL = process.env.THEMES_MODEL || "deepseek-v4-flash:cloud";
const WINDOW_DAYS = parseInt(process.env.THEMES_WINDOW_DAYS || "14", 10);
const PER_CHANNEL = 45, TOTAL_CAP = 560, MAP_BATCH = 70;

function chat(prompt, { timeoutMs = 90000 } = {}) {
  return new Promise((resolve) => {
    const [host, port = "11434"] = OLLAMA.split(":");
    const payload = JSON.stringify({ model: MODEL, stream: false, options: { temperature: 0.3 },
      messages: [{ role: "user", content: prompt }] });
    const req = require("http").request({ host, port: +port, path: "/api/chat", method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } },
      (res) => { let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => { try { resolve(JSON.parse(d).message.content); } catch { resolve(null); } }); });
    req.on("error", () => resolve(null));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(null); });
    req.write(payload); req.end();
  });
}
function parseJson(raw) { if (!raw) return null; const m = raw.match(/\[[\s\S]*\]/); if (!m) return null; try { return JSON.parse(m[0]); } catch { return null; } }
const clean = (s) => String(s || "").replace(/https?:\/\/\S+/g, "").replace(/<[@#!:][^>]+>/g, "").replace(/\s+/g, " ").trim();

let _pipe = null;
async function embed(text) {
  if (!_pipe) { const { pipeline } = await import("@xenova/transformers"); _pipe = await pipeline("feature-extraction", "Xenova/bge-small-en-v1.5"); }
  const out = await _pipe(String(text).slice(0, 2000), { pooling: "mean", normalize: true });
  return Array.from(out.data);
}
function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60); }

(async () => {
  const c = new MongoClient(process.env.MONGODB_URI, { directConnection: true });
  await c.connect();
  const db = c.db("a-house-divided");
  const msgs = db.collection("discord_messages");
  const since = new Date(Date.now() - WINDOW_DAYS * 86400000);

  // Per-channel recent sample so #general doesn't drown out everything.
  const channels = await msgs.distinct("channelName", { ts: { $gte: since } });
  let sample = [];
  for (const ch of channels) {
    const rows = await msgs.find({ channelName: ch, ts: { $gte: since } }, { projection: { content: 1, channelName: 1, author: 1 } })
      .sort({ ts: -1 }).limit(PER_CHANNEL).toArray();
    for (const r of rows) { const t = clean(r.content); if (t.length >= 25) sample.push(`[#${ch}] ${t.slice(0, 300)}`); }
  }
  sample = sample.slice(0, TOTAL_CAP);
  console.log(`sampled ${sample.length} messages across ${channels.length} channels (last ${WINDOW_DAYS}d)`);
  if (sample.length < 20) { console.log("not enough messages — aborting"); process.exit(0); }

  // MAP
  const candidates = [];
  for (let i = 0; i < sample.length; i += MAP_BATCH) {
    const batch = sample.slice(i, i + MAP_BATCH);
    const prompt = `You analyze community Discord messages for the political-sim game "A House Divided".\nFrom the messages below, extract up to 6 recurring THEMES (ideas, feature requests, complaints, praise, recurring discussions).\nOutput ONLY a JSON array; each item: {"title": "<=6 words", "gist": "one sentence", "sentiment": "positive|negative|mixed|neutral", "gameSystem": "economy|elections|parties|legislature|executive|corporations|diplomacy|map_geo|npps|combat_or_military|onboarding_account|meta_other|null"}.\n\nMESSAGES:\n${batch.join("\n")}`;
    const arr = parseJson(await chat(prompt));
    if (arr) candidates.push(...arr.filter((x) => x && x.title));
    process.stdout.write(`  map ${Math.min(i + MAP_BATCH, sample.length)}/${sample.length}\r`);
  }
  console.log(`\ncandidates: ${candidates.length}`);
  if (!candidates.length) { console.log("no candidates — aborting (LLM unavailable?)"); process.exit(1); }

  // REDUCE
  const cand = candidates.map((x) => `- ${x.title} (${x.sentiment || "?"}, ${x.gameSystem || "?"}): ${x.gist || ""}`).join("\n");
  const reducePrompt = `Below are candidate themes extracted from batches of "A House Divided" community Discord messages. Merge duplicates and synthesize into 12-20 CANONICAL themes that capture the community's common ideas, sentiments and requests.\nOutput ONLY a JSON array; each item: {"title": "<=7 words", "summary": "1-2 sentences", "sentiment": "positive|negative|mixed|neutral", "gameSystem": "<same enum or null>", "prevalence": "high|medium|low"}.\n\nCANDIDATES:\n${cand}`;
  const themes = parseJson(await chat(reducePrompt, { timeoutMs: 120000 }));
  if (!themes || !themes.length) { console.log("reduce failed — keeping previous themes"); process.exit(1); }
  console.log(`canonical themes: ${themes.length}`);

  // embed + replace snapshot
  const docs = [];
  for (const t of themes) {
    if (!t.title) continue;
    const emb = await embed(`${t.title}\n${t.summary || ""}`);
    docs.push({ slug: slug(t.title), title: String(t.title).slice(0, 80), summary: String(t.summary || "").slice(0, 400),
      sentiment: t.sentiment || "neutral", gameSystem: t.gameSystem && t.gameSystem !== "null" ? t.gameSystem : null,
      prevalence: t.prevalence || "medium", embedding: emb, windowDays: WINDOW_DAYS, sampleSize: sample.length, createdAt: new Date() });
  }
  const coll = db.collection("discord_themes");
  await coll.deleteMany({});
  if (docs.length) await coll.insertMany(docs);
  console.log(`\nDONE — stored ${docs.length} themes (from ${sample.length} messages).`);
  await c.close();
  process.exit(0);
})().catch((e) => { console.error("THEMES ERROR:", e); process.exit(1); });
