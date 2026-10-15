"use strict";

const { engineHealth } = require("./engine-health");
const fs = require("fs");
const path = require("path");

const CACHE_MS = 30_000;
let cached = null;

function metric(name, help, value, labels = {}) {
  if (value == null || !Number.isFinite(Number(value))) return "";
  const pairs = Object.entries(labels).map(([key, raw]) => {
    const escaped = String(raw).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
    return `${key}="${escaped}"`;
  });
  const suffix = pairs.length ? `{${pairs.join(",")}}` : "";
  return `# HELP ${name} ${help}\n# TYPE ${name} gauge\n${name}${suffix} ${Number(value)}\n`;
}

async function snapshot(db) {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) return cached.value;
  const value = await engineHealth(db);
  cached = { at: now, value };
  return value;
}

async function renderPrometheusMetrics(db) {
  const engine = await snapshot(db);
  let worktrees = null;
  try {
    const report = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "worktree-fleet-latest.json"), "utf8"));
    worktrees = report.after || report.before;
  } catch {
    // The scheduled audit has not completed yet. Engine metrics remain useful.
  }
  const lines = [
    metric("lakeside_world_turn", "Current A House Divided turn", engine.turn),
    metric("lakeside_world_year", "Current in-game year", engine.year),
    metric("lakeside_world_paused", "Whether the live world is paused", engine.paused ? 1 : 0),
    metric("lakeside_turn_last_duration_seconds", "Duration of the most recent turn", engine.lastTurn && engine.lastTurn.durationMs / 1000),
    metric("lakeside_turn_last_success", "Whether the most recent turn completed successfully", engine.lastTurn ? (engine.lastTurn.success === false ? 0 : 1) : null),
    metric("lakeside_turn_recent_average_seconds", "Average duration across recent turns", engine.recent && engine.recent.avgMs / 1000),
    metric("lakeside_turn_recent_max_seconds", "Maximum duration across recent turns", engine.recent && engine.recent.maxMs / 1000),
    metric("lakeside_turn_recent_failures", "Failed turns in the recent turn window", engine.recent && engine.recent.failures),
    metric("lakeside_turn_overdue_minutes", "Minutes the next scheduled turn is overdue", engine.schedule && engine.schedule.overdueMin),
    metric("lakeside_elections_active", "Active elections", engine.elections && engine.elections.active),
    metric("lakeside_elections_overdue", "Active elections past their end time", engine.elections && engine.elections.overdue),
    metric("lakeside_engine_signals", "Current engine health signals", engine.flags && engine.flags.length),
    metric("lakeside_ops_process_uptime_seconds", "Ops dashboard process uptime", process.uptime()),
    metric("lakeside_ops_process_rss_bytes", "Ops dashboard resident memory", process.memoryUsage().rss),
    metric("lakeside_worktrees_total", "Registered secondary Git worktrees across the fleet", worktrees && worktrees.worktrees),
    ...Object.entries(worktrees?.classifications || {}).map(([classification, count]) =>
      metric("lakeside_worktrees_by_state", "Git worktrees by lifecycle classification", count, { classification })
    ),
  ];
  return lines.filter(Boolean).join("");
}

function resetMetricsCache() {
  cached = null;
}

module.exports = { renderPrometheusMetrics, resetMetricsCache };
