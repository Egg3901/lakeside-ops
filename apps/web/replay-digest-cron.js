#!/usr/bin/env node
// replay-digest-cron.js — weekly OpenReplay digest to Discord (run by systemd timer).
// Pulls a 7-day aggregate from ClickHouse and posts an embed via the ops webhook.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { getReplayReport } = require("./replay-analytics");
const { renderReplayReport } = require("./replay-page");
const { notifyDiscord, COLORS } = require("./ops-discord");

const OPS_BASE = process.env.OPS_PUBLIC_URL || "https://ops.lakesidegames.net";
const strip = (p) => String(p || "—").replace(/^https?:\/\/[^/]+/, "");
const n = (x) => Number(x || 0).toLocaleString();

(async () => {
  const d = await getReplayReport(168); // last 7 days (digest + extra sections)

  // 1) Write the detailed archived report to the ops-dash reports library.
  const reportDate = new Date(d.generatedAt).toISOString().slice(0, 10);
  const reportSlug = `replay-weekly-${reportDate}`;
  try {
    fs.writeFileSync(path.join(__dirname, "reports", `${reportSlug}.html`), renderReplayReport(d));
    console.log("wrote report:", reportSlug);
  } catch (e) {
    console.error("report write failed:", e.message);
  }
  const reportUrl = `${OPS_BASE}/reports/${reportSlug}`;
  const o = d.overview || {},
    e = d.engagement || {};
  const issue = (t) => d.issues.find((i) => i.type === t)?.n || 0;

  const topClicks = d.topClicks
    .slice(0, 5)
    .map((r, i) => `\`${i + 1}.\` ${strip(r.path)} — **${n(r.clicks)}**`)
    .join("\n") || "_no data_";
  const friction = d.friction
    .slice(0, 5)
    .map((r, i) => `\`${i + 1}.\` ${strip(r.url)} — **${n(r.n)}**`)
    .join("\n") || "_none_";

  const res = await notifyDiscord({
    kind: "replay",
    title: "📹 Weekly Replay Digest",
    url: reportUrl,
    color: COLORS.blurple,
    description:
      `**${n(o.humanSessions)}** human sessions · **${n(o.users)}** users · ` +
      `median **${e.median_sec ? Math.round(e.median_sec) + "s" : "—"}** · ` +
      `**${e.avg_pages ?? "—"}** pages/session · ${n(o.botSessions)} bot sessions filtered`,
    fields: [
      { name: "🔥 Top pages (clicks)", value: topClicks, inline: true },
      { name: "😤 Frustration hotspots", value: friction, inline: true },
      {
        name: "⚠️ Friction signals (7d)",
        value: `dead clicks **${n(issue("dead_click"))}** · rage clicks **${n(issue("click_rage"))}** · thrashing **${n(issue("mouse_thrashing"))}** · bad requests **${n(issue("bad_request"))}** · crashes **${n(issue("app_crash"))}**`,
        inline: false,
      },
    ],
    footer: `Window ${o.first || ""} → ${o.last || ""} · full report → ${reportUrl.replace(/^https?:\/\//, "")}`,
  });

  if (res.error) {
    console.error("digest post failed:", res.error);
    process.exit(1);
  }
  console.log("weekly replay digest posted:", JSON.stringify(res));
})().catch((err) => {
  console.error("replay-digest-cron error:", err.message);
  process.exit(1);
});
