// Server storyboard — mines the AHD Discord (guild age from snowflake, activity
// timeline, top contributors, announcements, indexed ideas) and has DeepSeek
// write a narrative timeline. Outputs the storyboard + raw stats JSON.
//   OLLAMA_URL=... node mcp/storyboard.js
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
require("dotenv").config({ path: require("path").join(__dirname, "..", "mcp-discord.env") });
const { MongoClient } = require("mongodb");
const BOT = process.env.DISCORD_BOT_TOKEN, API = "https://discord.com/api/v10";
const OURL = process.env.OLLAMA_URL || "http://localhost:11434/v1/chat/completions";
const MODEL = process.env.AUDIT_MODEL || "deepseek-v4-flash:cloud";
const snowflakeDate = (id) => new Date(Number(BigInt(id) >> 22n) + 1420070400000);

async function discord(p) { const r = await fetch(API + p, { headers: { Authorization: "Bot " + BOT } }); if (!r.ok) throw new Error("discord " + r.status); return r.json(); }
async function ask(messages, max = 1200) {
  const r = await fetch(OURL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: MODEL, messages, temperature: 0.3, max_tokens: max }) });
  if (!r.ok) throw new Error("ollama " + r.status + " " + (await r.text()).slice(0, 120));
  const j = await r.json(); return j.choices[0].message.content;
}

(async () => {
  const guilds = await discord("/users/@me/guilds?with_counts=true");
  const g = guilds[0], gid = g.id;
  const created = snowflakeDate(gid);
  const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
  const col = client.db("a-house-divided").collection("discord_ideas");
  const total = await col.countDocuments();
  const range = (await col.aggregate([{ $group: { _id: null, min: { $min: "$ts" }, max: { $max: "$ts" } } }]).toArray())[0] || {};
  const byMonth = await col.aggregate([{ $group: { _id: { $dateToString: { format: "%Y-%m", date: "$ts" } }, n: { $sum: 1 } } }, { $sort: { _id: 1 } }]).toArray();
  const top = await col.aggregate([{ $group: { _id: "$author", n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 12 }]).toArray();
  const sample = await col.aggregate([{ $sample: { size: 50 } }]).toArray();

  const chans = (await discord(`/guilds/${gid}/channels`)).filter((c) => c.type === 0 || c.type === 5);
  async function fetchChan(name, limit = 40) {
    const c = chans.find((x) => x.name === name); if (!c) return [];
    const m = await discord(`/channels/${c.id}/messages?limit=${limit}`);
    return m.map((x) => ({ content: x.content, ts: x.timestamp })).filter((x) => x.content);
  }
  const announce = [...(await fetchChan("alpha-announcements", 50)), ...(await fetchChan("development-roadmap", 30))];

  const digest =
`SERVER: "${g.name}" — created ${created.toDateString()} (${Math.round((Date.now() - created) / 86400000)} days old)
MEMBERS NOW: ${g.approximate_member_count}
INDEXED COMMUNITY MESSAGES: ${total}${range.min ? ` (spanning ${new Date(range.min).toDateString()} → ${new Date(range.max).toDateString()})` : ""}
MONTHLY MESSAGE VOLUME: ${byMonth.map((m) => m._id + ":" + m.n).join("  ")}
TOP CONTRIBUTORS: ${top.map((a) => a._id + " (" + a.n + ")").join(", ")}
ANNOUNCEMENTS / ROADMAP (recent first):
${announce.slice(0, 25).map((a) => "- " + (a.content || "").replace(/\n/g, " ").slice(0, 170)).join("\n")}
SAMPLE OF COMMUNITY IDEAS:
${sample.slice(0, 35).map((s) => "- [" + s.channelName + "] " + (s.content || "").replace(/\n/g, " ").slice(0, 130)).join("\n")}`;

  const story = await ask([
    { role: "system", content: 'You are a community historian for the political-simulation game "A House Divided". From the Discord activity data, write an engaging STORYBOARD / timeline of the server: founding, growth phases (read the monthly volume), the people who built it (top contributors), major events & milestones (from announcements/roadmap), and the recurring themes the community keeps pushing for. Use short dated sections and a warm but factual tone. ~380 words, markdown.' },
    { role: "user", content: digest },
  ], 1400);

  console.log("=====STORYBOARD=====\n" + story);
  console.log("\n=====STATS=====\n" + JSON.stringify({ guild: g.name, created: created.toISOString(), members: g.approximate_member_count, indexed: total, range, byMonth, top }));
  process.exit(0);
})().catch((e) => { console.error("STORYBOARD ERROR:", e); process.exit(1); });
