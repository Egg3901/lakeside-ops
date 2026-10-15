// replay-analytics.js — pull aggregate analytics from the self-hosted OpenReplay
// ClickHouse (experimental.sessions / product_analytics.events / experimental.issues).
// ClickHouse HTTP isn't exposed to the host, so we shell out to `docker exec`.
const { execFile } = require("child_process");

// Known non-human user agents to flag/exclude from "real user" counts.
const BOT_BROWSERS = ["Applebot", "Googlebot", "bingbot", "PetalBot", "YandexBot", "GPTBot"];

function chQuery(sql) {
  return new Promise((resolve, reject) => {
    execFile(
      "docker",
      ["exec", "clickhouse", "clickhouse-client", "-q", sql + " FORMAT JSONEachRow"],
      { maxBuffer: 16 * 1024 * 1024, timeout: 20000 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error((stderr || err.message || "clickhouse error").slice(0, 500)));
        const out = String(stdout).trim();
        if (!out) return resolve([]);
        try {
          resolve(out.split("\n").map((l) => JSON.parse(l)));
        } catch (e) {
          reject(new Error("parse: " + e.message));
        }
      }
    );
  });
}

// `sinceHours` optionally scopes to a recent window (null = all-time).
async function getReplayDigest(sinceHours = null) {
  const sessWhere = sinceHours ? `WHERE datetime >= now() - INTERVAL ${Number(sinceHours)} HOUR` : "";
  const evtSince = sinceHours ? ` AND created_at >= now() - INTERVAL ${Number(sinceHours)} HOUR` : "";
  const issSince = sinceHours ? ` AND _timestamp >= now() - INTERVAL ${Number(sinceHours)} HOUR` : "";
  const botList = BOT_BROWSERS.map((b) => `'${b}'`).join(",");

  const [overview, engagement, realUsers, topClicks, topViews, friction, issues, devices, errors] =
    await Promise.all([
      chQuery(
        `SELECT count() sessions, uniqExact(user_uuid) users, toString(min(datetime)) first, toString(max(datetime)) last FROM experimental.sessions ${sessWhere}`
      ),
      chQuery(
        `SELECT round(avg(duration)/1000,1) avg_sec, round(quantile(0.5)(duration)/1000,1) median_sec, round(avg(pages_count),1) avg_pages, round(avg(events_count),1) avg_events FROM experimental.sessions ${sessWhere ? sessWhere + " AND" : "WHERE"} duration>0`
      ),
      chQuery(
        `SELECT count() bot_sessions FROM experimental.sessions ${sessWhere ? sessWhere + " AND" : "WHERE"} user_browser IN (${botList})`
      ),
      chQuery(
        `SELECT "$current_path" path, count() clicks, uniqExact(session_id) sessions FROM product_analytics.events WHERE "$event_name"='CLICK'${evtSince} GROUP BY path ORDER BY clicks DESC LIMIT 12`
      ),
      chQuery(
        `SELECT "$current_path" path, count() views, uniqExact(session_id) sessions FROM product_analytics.events WHERE "$event_name"='LOCATION'${evtSince} GROUP BY path ORDER BY views DESC LIMIT 12`
      ),
      chQuery(
        `SELECT context_string url, count() n FROM experimental.issues WHERE type='mouse_thrashing' AND context_string LIKE 'http%'${issSince} GROUP BY url ORDER BY n DESC LIMIT 12`
      ),
      chQuery(
        `SELECT type, count() n FROM experimental.issues WHERE 1=1${issSince} GROUP BY type ORDER BY n DESC`
      ),
      chQuery(
        `SELECT user_device_type dev, user_browser br, user_os os, count() n FROM experimental.sessions ${sessWhere} GROUP BY dev,br,os ORDER BY n DESC LIMIT 10`
      ),
      chQuery(
        `SELECT "$current_path" path, count() n FROM product_analytics.events WHERE "$event_name"='ERROR'${evtSince} GROUP BY path ORDER BY n DESC LIMIT 8`
      ),
    ]);

  const ov = overview[0] || {};
  const botSessions = Number(realUsers[0]?.bot_sessions || 0);
  return {
    overview: { ...ov, botSessions, humanSessions: Math.max(0, Number(ov.sessions || 0) - botSessions) },
    engagement: engagement[0] || {},
    topClicks,
    topViews,
    friction,
    issues,
    devices,
    errors,
    window: sinceHours ? `last ${sinceHours}h` : "all-time",
    generatedAt: new Date().toISOString(),
  };
}

// Richer point-in-time report (weekly snapshot): digest + extra sections.
async function getReplayReport(sinceHours = 168) {
  const evtSince = ` AND created_at >= now() - INTERVAL ${Number(sinceHours)} HOUR`;
  const [digest, weekOverWeek, entryPages, busiestHours, rageSelectors, topElements] =
    await Promise.all([
      getReplayDigest(sinceHours),
      chQuery(
        `SELECT countIf(datetime >= now()-INTERVAL ${Number(sinceHours)} HOUR) this_period, countIf(datetime >= now()-INTERVAL ${2 * Number(sinceHours)} HOUR AND datetime < now()-INTERVAL ${Number(sinceHours)} HOUR) prev_period, round(avgIf(duration/1000, datetime >= now()-INTERVAL ${Number(sinceHours)} HOUR AND duration>0),0) this_dur, round(avgIf(duration/1000, datetime >= now()-INTERVAL ${2 * Number(sinceHours)} HOUR AND datetime < now()-INTERVAL ${Number(sinceHours)} HOUR AND duration>0),0) prev_dur FROM experimental.sessions`
      ),
      chQuery(
        `SELECT path, count() sessions FROM (SELECT session_id, argMin("$current_path", "$time") path FROM product_analytics.events WHERE "$event_name"='LOCATION'${evtSince} GROUP BY session_id) GROUP BY path ORDER BY sessions DESC LIMIT 10`
      ),
      chQuery(
        `SELECT toHour(datetime) hour, count() sessions FROM experimental.sessions WHERE datetime >= now()-INTERVAL ${Number(sinceHours)} HOUR GROUP BY hour ORDER BY hour`
      ),
      chQuery(
        `SELECT type, substring(context_string,1,90) selector, count() n FROM experimental.issues WHERE type IN ('click_rage','dead_click') AND _timestamp >= now()-INTERVAL ${Number(sinceHours)} HOUR GROUP BY type, selector ORDER BY n DESC LIMIT 10`
      ),
      chQuery(
        `SELECT "$current_path" path, substring(JSONExtractString(toString("$properties"),'label'),1,70) element, count() clicks FROM product_analytics.events WHERE "$event_name"='CLICK'${evtSince} AND element!='' GROUP BY path, element ORDER BY clicks DESC LIMIT 12`
      ),
    ]);
  return { ...digest, weekOverWeek: weekOverWeek[0] || {}, entryPages, busiestHours, rageSelectors, topElements, periodHours: sinceHours };
}

module.exports = { getReplayDigest, getReplayReport, chQuery, BOT_BROWSERS };
