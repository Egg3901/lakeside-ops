// Generate the Ideas digest — a storyboard narrative + theme list — from the
// vectorized Discord corpus, and store it in `ideas_meta` for the /ideas page.
// Re-run anytime (e.g., nightly / after a big ingest) to refresh.
//   OLLAMA_URL=... node mcp/gen-ideas-digest.js
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
require("dotenv").config({ path: require("path").join(__dirname, "..", "mcp-discord.env") });
const { MongoClient } = require("mongodb");
const BOT = process.env.DISCORD_BOT_TOKEN, API = "https://discord.com/api/v10";
const OURL = process.env.OLLAMA_URL || "http://localhost:11434/v1/chat/completions";
const MODEL = process.env.AUDIT_MODEL || "deepseek-v4-flash:cloud";
const snowDate = (id) => new Date(Number(BigInt(id) >> 22n) + 1420070400000);

async function discord(p) { const r = await fetch(API + p, { headers: { Authorization: "Bot " + BOT } }); if (!r.ok) throw new Error("discord " + r.status); return r.json(); }
async function ask(messages, max = 1400) {
  const r = await fetch(OURL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: MODEL, messages, temperature: 0.3, max_tokens: max }) });
  if (!r.ok) throw new Error("ollama " + r.status + " " + (await r.text()).slice(0, 120));
  return (await r.json()).choices[0].message.content;
}

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
  const db = client.db("a-house-divided");
  // Use the richer corpus (full discord_messages once it overtakes the POC set).
  const nMsgs = await db.collection("discord_messages").countDocuments();
  const nIdeas = await db.collection("discord_ideas").countDocuments();
  const col = db.collection(nMsgs >= nIdeas ? "discord_messages" : "discord_ideas");
  const total = Math.max(nMsgs, nIdeas);

  const g = (await discord("/users/@me/guilds?with_counts=true"))[0];
  const created = snowDate(g.id);
  const range = (await col.aggregate([{ $group: { _id: null, min: { $min: "$ts" }, max: { $max: "$ts" } } }]).toArray())[0] || {};
  const byMonth = await col.aggregate([{ $group: { _id: { $dateToString: { format: "%Y-%m", date: "$ts" } }, n: { $sum: 1 } } }, { $sort: { _id: 1 } }]).toArray();
  const top = await col.aggregate([{ $group: { _id: "$author", n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 12 }]).toArray();
  const sample = await col.aggregate([{ $sample: { size: 60 } }]).toArray();

  const ctx =
`SERVER "${g.name}" — created ${created.toDateString()} (${Math.round((Date.now() - created) / 86400000)} days old) — ${g.approximate_member_count} members.
INDEXED MESSAGES: ${total}${range.min ? ` (${new Date(range.min).toDateString()} → ${new Date(range.max).toDateString()})` : ""}
MONTHLY VOLUME: ${byMonth.map((m) => m._id + ":" + m.n).join("  ")}
TOP CONTRIBUTORS: ${top.map((a) => a._id + " (" + a.n + ")").join(", ")}
SAMPLE MESSAGES:
${sample.slice(0, 45).map((s) => "- [" + s.channelName + "] " + (s.content || "").replace(/\n/g, " ").slice(0, 130)).join("\n")}`;

  const storyboard = await ask([
    { role: "system", content: 'You are the community historian for the political-sim game "A House Divided". Write an engaging STORYBOARD/timeline from this Discord data: founding, growth phases (read the monthly volume), key people, major events, and recurring community themes. Short dated sections, warm but factual. ~380 words, markdown.' },
    { role: "user", content: ctx },
  ]);

  const themesRaw = await ask([
    { role: "system", content: "From this game community's messages, extract the 8 biggest recurring THEMES players push for. Reply ONLY a JSON array: [{\"title\":\"<=4 words\",\"summary\":\"one sentence\"}]." },
    { role: "user", content: ctx },
  ], 700);
  let themes = [];
  try { themes = JSON.parse(themesRaw.match(/\[[\s\S]*\]/)[0]); } catch { /* keep empty */ }

  await db.collection("ideas_meta").updateOne({ _id: "latest" }, { $set: {
    storyboard, themes,
    stats: { guild: g.name, created, members: g.approximate_member_count, indexed: total, byMonth, top },
    generatedAt: new Date(),
  } }, { upsert: true });
  console.log(`stored ideas_meta: ${themes.length} themes, storyboard ${storyboard.length} chars, corpus ${total} (${col.collectionName})`);
  process.exit(0);
})().catch((e) => { console.error("DIGEST ERROR:", e); process.exit(1); });
