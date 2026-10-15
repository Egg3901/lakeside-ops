#!/usr/bin/env node
"use strict";

// One-time import of the open Lakeside Hub product kanban into the ops kanban.
//
//   node scripts/kanban-import-hub.js --hub <hub.db snapshot> [--db <kanban.db>] [--log <file.json>] [--dry-run]
//
// Rules (owner decision 2026-10-09):
// - only open lanes (now, next, blocked, backlog); shipped items stay in the
//   Hub archive and are not imported;
// - GitHub-sourced items are checked live with `gh` and skipped when closed;
// - known duplicates are merged into the richer item, which keeps the GitHub
//   link; the folded id becomes an alias so old references still resolve;
// - local items in `now` with no update for STALE_DAYS days are flagged stale
//   (not deleted);
// - owner decisions ("Decide:" titles, "owner decision" titles, needs_owner
//   set, or listed explicitly) get needs_owner so they land in one section.
// Hub item ids are preserved, so "Hub 242673" style references keep working.
//
// Refuses to run against a kanban that already has items.

const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");
const { openKanban, defaultDbPath, fetchIssueState, STALE_DAYS } = require("../kanban-store");

const PRODUCT_ALIASES = {
  "a-house-divided": ["ahd", "ahdgame", "a house divided", "adhd-bot", "adhd bot", "ahdclient", "ahd-client", "ahdnative", "ahd-native", "ahd-android"],
  "margin-of-victory": ["mov", "ahd-sim"],
  metroforge: ["mf", "metroforge-native"],
  "grand-century": ["gc"],
  verdigris: [],
  foreshore: ["rialto"],
};
// [survivor, folded]: the survivor is the richer local item; the folded one is
// the GitHub-synced copy of the same tracker issue.
const KNOWN_DUPLICATES = [
  [33169, 33191, "same AHDGame issue #2159"],
  [235869, 235870, "same turn tracker AHDGame #3416"],
];
const EXPLICIT_OWNER_DECISIONS = [152750, 187151, 152552, 254139];
const OPEN_LANES = ["now", "next", "blocked", "backlog"];
const LANE_RANK = { now: 0, blocked: 1, next: 2, backlog: 3 };

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
}

function iso(value) {
  if (!value) return null;
  const text = String(value);
  const normalized = /T/.test(text) ? text : `${text.replace(" ", "T")}Z`;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function later(a, b) {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

async function main() {
  const hubPath = arg("--hub");
  if (!hubPath) throw new Error("--hub <hub.db snapshot> is required");
  const dbPath = path.resolve(arg("--db", defaultDbPath()));
  const logPath = arg("--log");
  const dryRun = process.argv.includes("--dry-run");
  const startedAt = new Date();
  const staleCutoff = startedAt.getTime() - STALE_DAYS * 86_400_000;

  const hub = new Database(hubPath, { readonly: true, fileMustExist: true });
  const products = hub.prepare("SELECT * FROM products ORDER BY id").all();
  const slugById = new Map(products.map((p) => [p.id, p.slug]));
  const sources = hub.prepare("SELECT * FROM github_sources ORDER BY id").all();
  const rows = hub.prepare(`SELECT * FROM product_work WHERE lane IN (${OPEN_LANES.map(() => "?").join(",")}) ORDER BY id`).all(...OPEN_LANES);
  const shippedCount = hub.prepare("SELECT COUNT(*) AS n FROM product_work WHERE lane NOT IN ('now','next','blocked','backlog')").get().n;

  const log = {
    started_at: startedAt.toISOString(),
    hub_snapshot: path.resolve(hubPath),
    kanban_db: dbPath,
    dry_run: dryRun,
    hub_totals: { items: rows.length + shippedCount, open_lane_items: rows.length, shipped_not_imported: shippedCount },
    imported: [],
    merged: [],
    skipped_closed: [],
    flagged_stale: [],
    needs_owner: [],
    possible_duplicates: [],
    github_check_errors: [],
  };

  // Live GitHub state for every item that carries a GitHub link.
  const ghState = new Map();
  for (const row of rows.filter((r) => r.source_repo && r.source_number)) {
    try {
      const state = await fetchIssueState(row.source_repo, row.source_number);
      ghState.set(row.id, state.state);
    } catch (error) {
      ghState.set(row.id, null);
      log.github_check_errors.push({ id: row.id, ref: `${row.source_repo}#${row.source_number}`, error: String(error.message || error).slice(0, 200) });
    }
  }

  const byId = new Map(rows.map((r) => [r.id, r]));
  const folded = new Map(); // folded id -> survivor id
  for (const [survivor, dupe, reason] of KNOWN_DUPLICATES) {
    if (byId.has(survivor) && byId.has(dupe)) folded.set(dupe, { survivor, reason });
    else log.merged.push({ survivor, folded: dupe, reason, note: "not both open in Hub; nothing merged" });
  }

  const items = [];
  for (const row of rows) {
    if (folded.has(row.id)) continue;
    const isGithubSourced = row.source === "github";
    const state = ghState.get(row.id);
    if (isGithubSourced && state && state !== "open") {
      log.skipped_closed.push({ id: row.id, ref: `${row.source_repo}#${row.source_number}`, title: row.title, github_state: state });
      continue;
    }
    if (isGithubSourced && state == null) {
      // Could not confirm: import, and say so, rather than silently dropping work.
      log.github_check_errors.find((e) => e.id === row.id).action = "imported unverified";
    }
    const item = {
      id: row.id,
      product: slugById.get(row.product_id),
      title: row.title,
      detail: row.detail || "",
      lane: row.lane,
      impact: ["high", "medium", "low"].includes(row.impact) ? row.impact : "medium",
      kind: row.kind || "task",
      needs_owner: row.needs_owner ? 1 : 0,
      assigned_to: row.assigned_to || null,
      progress_summary: row.progress_summary || "",
      last_progress_at: iso(row.last_progress_at),
      source: isGithubSourced ? "github" : "local",
      github_repo: row.source_repo || null,
      github_number: row.source_number || null,
      github_url: row.source_url || null,
      github_state: row.source_repo ? state || row.source_state || "open" : null,
      github_labels: row.source_labels || null,
      created_at: iso(row.created_at) || startedAt.toISOString(),
      updated_at: iso(row.updated_at) || startedAt.toISOString(),
      legacy_hub_id: row.id,
      hub_ids: [row.id],
      evidence_url: null,
    };
    for (const [dupeId, { survivor, reason }] of folded) {
      if (survivor !== row.id) continue;
      const dupe = byId.get(dupeId);
      const dupeState = ghState.get(dupeId);
      const before = { lane: item.lane, detail_len: item.detail.length };
      if ((dupe.detail || "").length > item.detail.length) item.detail = dupe.detail;
      if (LANE_RANK[dupe.lane] < LANE_RANK[item.lane]) item.lane = dupe.lane;
      item.needs_owner = item.needs_owner || dupe.needs_owner ? 1 : 0;
      if (later(iso(dupe.last_progress_at), item.last_progress_at) === iso(dupe.last_progress_at) && dupe.progress_summary) {
        item.progress_summary = dupe.progress_summary;
        item.last_progress_at = iso(dupe.last_progress_at);
        item.assigned_to = dupe.assigned_to || item.assigned_to;
      }
      if (!item.github_repo && dupe.source_repo) {
        item.github_repo = dupe.source_repo;
        item.github_number = dupe.source_number;
        item.github_url = dupe.source_url;
        item.github_state = dupeState || dupe.source_state || "open";
        item.github_labels = dupe.source_labels;
      }
      // Sync stamps updated_at on GitHub copies every 15 minutes, so only real
      // progress on the folded copy counts as activity.
      item.updated_at = later(item.updated_at, later(item.last_progress_at, iso(dupe.last_progress_at)));
      item.hub_ids.push(dupeId);
      log.merged.push({ survivor: row.id, folded: dupeId, reason, survivor_title: row.title, folded_title: dupe.title,
        github: `${item.github_repo}#${item.github_number}`, github_state: item.github_state, lane: `${before.lane} -> ${item.lane}`,
        detail_kept_from: (dupe.detail || "").length > before.detail_len ? dupeId : row.id });
    }
    if (/^decide:/i.test(item.title) || /owner decision/i.test(item.title) || EXPLICIT_OWNER_DECISIONS.includes(item.id)) item.needs_owner = 1;
    if (item.needs_owner) log.needs_owner.push({ id: item.id, product: item.product, lane: item.lane, title: item.title, reason: row.needs_owner ? "needs_owner set in Hub" : "owner-decision title or listed" });
    const lastTouch = later(item.updated_at, item.last_progress_at);
    if (item.lane === "now" && item.source === "local" && Date.parse(lastTouch) < staleCutoff) {
      item.stale_flagged_at = startedAt.toISOString();
      log.flagged_stale.push({ id: item.id, product: item.product, title: item.title, last_update: lastTouch, days: Math.floor((startedAt.getTime() - Date.parse(lastTouch)) / 86_400_000) });
    }
    items.push(item);
  }

  // Unlisted duplicates: a local item whose detail cites a GitHub issue that is
  // also its own imported item. Reported for the owner, not merged.
  const githubItems = new Map(items.filter((i) => i.source === "github").map((i) => [`${i.github_repo}#${i.github_number}`, i.id]));
  for (const item of items.filter((i) => i.source === "local")) {
    for (const m of item.detail.matchAll(/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)/g)) {
      const other = githubItems.get(`${m[1]}#${m[2]}`);
      if (other && other !== item.id) log.possible_duplicates.push({ local: item.id, github_item: other, ref: `${m[1]}#${m[2]}`, title: item.title });
    }
  }

  const events = hub.prepare("SELECT * FROM work_events ORDER BY id").all();
  const idMap = new Map();
  for (const item of items) for (const hid of item.hub_ids) idMap.set(hid, item.id);

  log.counts = {
    hub_open_lane_items: rows.length,
    imported: items.length,
    merged: log.merged.filter((m) => m.survivor && !m.note).length,
    skipped_closed: log.skipped_closed.length,
    flagged_stale: log.flagged_stale.length,
    needs_owner: log.needs_owner.length,
    by_lane: OPEN_LANES.reduce((acc, lane) => ({ ...acc, [lane]: items.filter((i) => i.lane === lane && !i.needs_owner).length }), {}),
    events_imported: events.filter((e) => idMap.has(e.work_id)).length,
    shipped_not_imported: shippedCount,
  };
  log.imported = items.map((i) => ({ id: i.id, product: i.product, lane: i.lane, needs_owner: Boolean(i.needs_owner), stale: Boolean(i.stale_flagged_at), source: i.source, github: i.github_repo ? `${i.github_repo}#${i.github_number}` : null, title: i.title }));

  if (!dryRun) {
    const kanban = openKanban(dbPath);
    const existing = kanban.db.prepare("SELECT COUNT(*) AS n FROM kanban_items").get().n;
    if (existing > 0) throw new Error(`refusing to import: ${dbPath} already has ${existing} items`);
    const { db } = kanban;
    db.transaction(() => {
      products.forEach((p, index) => kanban.upsertProduct({
        slug: p.slug, name: p.name, aliases: PRODUCT_ALIASES[p.slug] || [], mode: p.mode, health: p.health,
        product_url: p.product_url || null, archived: Boolean(p.archived), sort_order: p.company_focus_rank || 10 + index,
      }));
      for (const s of sources) {
        db.prepare("INSERT OR REPLACE INTO kanban_github_sources (repo, product, enabled, last_sync_at, last_error) VALUES (?, ?, ?, NULL, NULL)")
          .run(s.repo, slugById.get(s.product_id), s.enabled ? 1 : 0);
      }
      const insert = db.prepare(`INSERT INTO kanban_items (id, product, title, detail, lane, impact, kind, needs_owner, assigned_to, progress_summary,
          last_progress_at, evidence_url, source, github_repo, github_number, github_url, github_state, github_labels, stale_flagged_at, legacy_hub_id,
          created_at, updated_at)
        VALUES (@id, @product, @title, @detail, @lane, @impact, @kind, @needs_owner, @assigned_to, @progress_summary, @last_progress_at, @evidence_url,
          @source, @github_repo, @github_number, @github_url, @github_state, @github_labels, @stale_flagged_at, @legacy_hub_id, @created_at, @updated_at)`);
      for (const item of items) insert.run({ stale_flagged_at: null, ...item, hub_ids: undefined });
      for (const [dupeId, { survivor, reason }] of folded) {
        db.prepare("INSERT INTO kanban_item_aliases (alias_id, item_id, reason) VALUES (?, ?, ?)").run(dupeId, survivor, `merged at Hub import: ${reason}`);
      }
      const insertEvent = db.prepare(`INSERT INTO kanban_events (item_id, product, event_type, actor, summary, evidence_url, idempotency_key, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const e of events) {
        const target = idMap.get(e.work_id);
        if (!target) continue;
        insertEvent.run(target, slugById.get(e.product_id), e.event_type, e.actor || "system", e.summary || "", e.evidence_url || null, e.idempotency_key || null, iso(e.created_at) || startedAt.toISOString());
      }
      // Latest evidence URL per item, so the card can link it directly.
      db.exec(`UPDATE kanban_items SET evidence_url = (SELECT e.evidence_url FROM kanban_events e WHERE e.item_id = kanban_items.id AND e.evidence_url IS NOT NULL ORDER BY e.created_at DESC LIMIT 1) WHERE evidence_url IS NULL`);
      const stamp = startedAt.toISOString();
      for (const item of items) {
        kanban.logEvent({ item_id: item.id, product: item.product, event_type: "imported", actor: "hub-import",
          summary: `Imported from Lakeside Hub${item.hub_ids.length > 1 ? ` (merged Hub ${item.hub_ids.join(" + ")})` : ""}${item.stale_flagged_at ? "; flagged stale for owner review" : ""}`, created_at: stamp });
      }
    })();
    log.kanban_check = {
      items: db.prepare("SELECT COUNT(*) AS n FROM kanban_items").get().n,
      events: db.prepare("SELECT COUNT(*) AS n FROM kanban_events").get().n,
      aliases: db.prepare("SELECT COUNT(*) AS n FROM kanban_item_aliases").get().n,
    };
    kanban.close();
  }
  log.finished_at = new Date().toISOString();
  const text = JSON.stringify(log, null, 2);
  if (logPath) fs.writeFileSync(logPath, text);
  console.log(JSON.stringify({ counts: log.counts, kanban_check: log.kanban_check || null, possible_duplicates: log.possible_duplicates.length, github_check_errors: log.github_check_errors.length }, null, 2));
}

main().catch((error) => {
  console.error(`[kanban-import] ${error.stack || error}`);
  process.exit(1);
});
