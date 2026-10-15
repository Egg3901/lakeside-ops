// Executive digest — an IN-DEPTH, ENTERTAINING morning DM as a real Discord
// embed (not a Hermes plain-text send — Hermes' `send` has no embed option,
// so this posts straight to the Discord API with the bot token Hermes
// itself uses). Takes the full daily report (every section) + the actual
// new tickets/suggestions opened in the last 24h + worktree health, and has
// Kimi rewrite it with actual personality — the user wants "brainrot"
// energy, not a corporate status update, while staying grounded in real
// numbers (Kimi is given the real data and told to riff ON it, not invent).
//
// Triggered hourly by ahd-executive-digest.timer; only actually sends
// during the 7am America/New_York hour (self-gating handles DST, so the
// timer itself never needs updating twice a year) and only once per day
// (dedup via `executive_digest_sent` collection).
//
//   node mcp/gen-executive-digest.js [--force]
require("dotenv").config({ quiet: true, path: require("path").join(__dirname, "..", ".env") });
require("dotenv").config({ quiet: true, path: "/root/.hermes/.env" }); // DISCORD_BOT_TOKEN lives here, not LSGD-ops-dash's own .env
const store = require("../knowledge-store");
const dailyReport = require("../daily-report");
const { callChat } = require("../llm");
const { scanAll } = require("/root/bin/worktree-status.js");

const DISCORD_API = "https://discord.com/api/v10";
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
// Resolved once via POST /users/@me/channels {recipient_id: <user id>} — see
// the "user-discord-id" memory entry for how this was derived. A raw user
// ID is NOT a valid message-send target; it must be an opened DM channel ID.
const DM_CHANNEL = process.env.EXEC_DIGEST_DM_CHANNEL || "1506641727081943040";
const REPORT_URL = "https://ops.ahousedividedgame.com/reports";
const FORCE = process.argv.includes("--force");

const MOOD_COLOR = { good: 0x2ecc71, watch: 0xf1c40f, alert: 0xe74c3c };

function currentHourET() {
  return parseInt(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hour12: false }).format(new Date()), 10);
}

async function alreadySentToday(db, dateKey) {
  const doc = await db.collection("executive_digest_sent").findOne({ _id: dateKey });
  return !!doc;
}

async function markSent(db, dateKey) {
  await db.collection("executive_digest_sent").updateOne({ _id: dateKey }, { $set: { sentAt: new Date() } }, { upsert: true });
}

async function newItemsLast24h(db) {
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const [tickets, suggestions] = await Promise.all([
    db.collection("tickets").find({ createdAt: { $gte: since } }).project({ title: 1, category: 1, number: 1 }).sort({ createdAt: -1 }).limit(15).toArray().catch(() => []),
    db.collection("suggestions").find({ createdAt: { $gte: since } }).project({ title: 1, category: 1, issueNumber: 1 }).sort({ createdAt: -1 }).limit(15).toArray().catch(() => []),
  ]);
  return { tickets, suggestions };
}

// A few actual raw Discord lines so Kimi can quote something real instead of
// just restating message-count stats — this is what the user specifically
// flagged as missing.
async function discordQuotes(db) {
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const recent = await db.collection("discord_messages")
    .find({ ts: { $gte: since }, content: { $exists: true, $ne: "" } })
    .sort({ ts: -1 }).limit(50)
    .project({ channelName: 1, author: 1, content: 1 }).toArray().catch(() => []);
  return recent.map((m) => `[${m.channelName}] ${m.author}: ${(m.content || "").replace(/\n/g, " ").slice(0, 160)}`);
}

function worktreeSummary() {
  try {
    const s = scanAll();
    return { locked: s.locked.length, mergeable: s.mergeable.length + s.prunable.length, active: s["active-feature"].length };
  } catch {
    return null;
  }
}

// Feeds the real telemetry to Kimi and gets back a ready-to-post Discord
// embed structure. Kimi is told explicitly not to invent numbers — only to
// riff on what's given.
async function generateEmbed(doc, newItems, wt, quotes) {
  const factsBlock = [
    `HEADLINE: ${doc.headline}`,
    `MOOD: ${doc.mood}`,
    `EXEC SUMMARY: ${doc.executiveSummary}`,
    "",
    "FULL SECTIONS:",
    ...(doc.sections || []).map((s) => `${s.emoji || ""} ${s.title}: ${s.body}`),
    "",
    "ACTION ITEMS:" + (doc.actions && doc.actions.length ? "" : " none today"),
    ...(doc.actions || []).map((a) => `- [${a.severity}] ${a.title}: ${a.detail}`),
    "",
    `NEW TICKETS (last 24h, ${newItems.tickets.length} total): ` + (newItems.tickets.map((t) => `#${t.number || "?"} "${t.title}" (${t.category || "?"})`).join("; ") || "none"),
    `NEW SUGGESTIONS (last 24h, ${newItems.suggestions.length} total): ` + (newItems.suggestions.map((s) => `#${s.issueNumber || "?"} "${s.title}" (${s.category || "?"})`).join("; ") || "none"),
    "",
    wt ? `WORKTREES: ${wt.locked} locked (agents actively working), ${wt.active} with real unmerged work, ${wt.mergeable} safe to clean up` : "",
    "",
    quotes.length ? `ACTUAL DISCORD MESSAGES FROM THE LAST 24H (quote 1-3 of the funniest/most relevant ones verbatim in the Community field — don't just say "N messages"):\n${quotes.join("\n")}` : "NO DISCORD ACTIVITY IN THE LAST 24H.",
  ].filter(Boolean).join("\n");

  const prompt = `You are writing a morning Discord DM briefing for the solo founder of "A House Divided", a live multiplayer political-sim game. He explicitly wants BRAINROT energy — funny, punchy, internet-native, entertaining to actually read at 7am — NOT a corporate status report. Roast bad numbers, hype good ones, use humor and personality. Be SPECIFIC: name actual ticket/suggestion titles, quote actual Discord lines, cite actual numbers — never vague filler like "the backlog is large" without naming what's IN it. But every number/fact/quote you use must come from the DATA below — riff on it, don't invent new facts.

Respond with ONLY valid JSON, no prose, no code fences:
{
  "title": "<punchy, meme-ish headline, <=100 chars, can use emoji>",
  "description": "<2-4 sentences, funny but informative, the vibe check for today>",
  "fields": [
    {"name": "<emoji + short punchy label, e.g. '🎮 The Game'>", "value": "<1-3 sentences, entertaining, grounded in the real data>"},
    ...one field per major topic: game/engine, economy, support & new tickets/suggestions (call out specific ones by title if there are any), community/discord, errors/reliability, worktrees/dev-ops
  ],
  "footer": "<one short punchy closing line, <=100 chars>"
}

Rules: 5-7 fields max. Each field value under 300 characters. If mood is "alert", make sure the urgency actually comes through even through the humor. If there's nothing interesting in a topic, it's fine to make a short joke about how quiet it is rather than forcing content.

DATA:
${factsBlock}`;

  // kimi-for-coding is a reasoning model — it spends tokens on
  // reasoning_content before the actual answer, so the budget has to cover
  // both (see pr-review.js's callLlmReview comment for the same gotcha).
  const { content } = await callChat({ messages: [{ role: "user", content: prompt }], maxTokens: 9000, temperature: 1 });
  let t = String(content || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const m = t.match(/\{[\s\S]*\}/);
  if (m) t = m[0];
  try {
    return JSON.parse(t);
  } catch (e) {
    console.error("[exec-digest] raw Kimi content that failed to parse:\n" + content);
    throw e;
  }
}

function fallbackEmbed(doc, newItems, wt) {
  // Only used if the Kimi call itself fails — plain but still not corporate.
  return {
    title: `📋 ${doc.headline || "Daily digest"} (fallback, Kimi call failed)`,
    description: doc.executiveSummary || "No summary available.",
    fields: [
      { name: "🎫 New tickets/suggestions", value: `${newItems.tickets.length} tickets, ${newItems.suggestions.length} suggestions in the last 24h.` },
      wt ? { name: "🌿 Worktrees", value: `${wt.locked} locked, ${wt.active} active-feature, ${wt.mergeable} safe to clean up.` } : null,
    ].filter(Boolean),
    footer: "Kimi bailed, you're getting the boring version today.",
  };
}

async function postEmbed(embed, mood) {
  const payload = {
    embeds: [{
      title: embed.title,
      description: embed.description,
      color: MOOD_COLOR[mood] || MOOD_COLOR.good,
      fields: (embed.fields || []).map((f) => ({ name: f.name, value: f.value, inline: false })),
      footer: { text: embed.footer ? `${embed.footer} · ${REPORT_URL}` : REPORT_URL },
      timestamp: new Date().toISOString(),
    }],
  };
  const res = await fetch(`${DISCORD_API}/channels/${DM_CHANNEL}/messages`, {
    method: "POST",
    headers: { Authorization: `Bot ${BOT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`discord ${res.status}: ${await res.text()}`);
  return res.json();
}

(async () => {
  const hour = currentHourET();
  if (!FORCE && hour !== 7) {
    console.log(`[exec-digest] current hour in America/New_York is ${hour}, not 7 — skipping (use --force to override)`);
    process.exit(0);
  }
  if (!BOT_TOKEN) { console.error("[exec-digest] DISCORD_BOT_TOKEN not found in /root/.hermes/.env"); process.exit(1); }

  const db = await store.getDb(process.env.MONGODB_URI);
  const dateKey = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date()); // YYYY-MM-DD, en-CA gives ISO order

  if (!FORCE && (await alreadySentToday(db, dateKey))) {
    console.log(`[exec-digest] already sent for ${dateKey} — skipping`);
    process.exit(0);
  }

  const doc = await db.collection(dailyReport.COLLECTION).findOne({}, { sort: { _id: -1 } });
  if (!doc) {
    console.error("[exec-digest] no daily report found at all — is ahd-daily-report.timer running?");
    process.exit(1);
  }

  const newItems = await newItemsLast24h(db);
  const wt = worktreeSummary();
  const quotes = await discordQuotes(db);

  let embed;
  try {
    embed = await generateEmbed(doc, newItems, wt, quotes);
  } catch (e) {
    console.error("[exec-digest] Kimi embed generation failed, using fallback:", e.message);
    embed = fallbackEmbed(doc, newItems, wt);
  }

  console.log("[exec-digest] posting embed:\n" + JSON.stringify(embed, null, 2));
  await postEmbed(embed, doc.mood);
  await markSent(db, dateKey);
  console.log(`[exec-digest] sent + marked ${dateKey}`);
  process.exit(0);
})().catch((e) => { console.error("[exec-digest] failed:", e.message); process.exit(1); });
