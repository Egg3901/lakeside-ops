"use strict";

// kanban-store.js: the product kanban (admin page + agent MCP tools).
//
// One SQLite file shared by two processes: the dashboard (page and REST API)
// and the ops-knowledge MCP (agent tools). better-sqlite3 is synchronous and
// WAL mode lets both open the same file safely. The path comes from
// OPS_KANBAN_DB so both units point at the same database; the default keeps a
// development checkout self-contained.
//
// Lanes: now | next | blocked | backlog are the open board; done holds closed
// work so history survives. "Needs owner" is a flag, not a lane: the board
// pulls flagged items out of their lane into one section so owner decisions
// are never scattered. "Stale" is derived: an item in `now` with no update for
// STALE_DAYS days, or one explicitly flagged (stale_flagged_at). Any update
// clears the explicit flag.

const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const OPEN_LANES = ["now", "next", "blocked", "backlog"];
const LANES = [...OPEN_LANES, "done"];
const IMPACTS = ["high", "medium", "low"];
const REPORT_EVENTS = ["started", "progress", "blocked", "decision_requested", "completed"];
const STALE_DAYS = 5;
const DAY_MS = 86_400_000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS kanban_products (
  slug        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  aliases     TEXT NOT NULL DEFAULT '[]',
  mode        TEXT NOT NULL DEFAULT 'building',
  health      TEXT NOT NULL DEFAULT 'on_track',
  product_url TEXT,
  archived    INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0
);
-- Same shape the dashboard's project registry reads (slug, name, mode, health,
-- product_url, archived), so portfolio.hubDbPath can point at this file.
CREATE VIEW IF NOT EXISTS products AS
  SELECT slug, name, mode, health, product_url, archived FROM kanban_products;

CREATE TABLE IF NOT EXISTS kanban_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  product          TEXT NOT NULL REFERENCES kanban_products(slug),
  title            TEXT NOT NULL,
  detail           TEXT NOT NULL DEFAULT '',
  lane             TEXT NOT NULL DEFAULT 'backlog' CHECK (lane IN ('now','next','blocked','backlog','done')),
  impact           TEXT NOT NULL DEFAULT 'medium' CHECK (impact IN ('high','medium','low')),
  kind             TEXT NOT NULL DEFAULT 'task',
  needs_owner      INTEGER NOT NULL DEFAULT 0,
  assigned_to      TEXT,
  progress_summary TEXT NOT NULL DEFAULT '',
  last_progress_at TEXT,
  evidence_url     TEXT,
  source           TEXT NOT NULL DEFAULT 'local' CHECK (source IN ('local','github')),
  github_repo      TEXT,
  github_number    INTEGER,
  github_url       TEXT,
  github_state     TEXT,
  github_labels    TEXT,
  github_synced_at TEXT,
  stale_flagged_at TEXT,
  legacy_hub_id    INTEGER,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  closed_at        TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS kanban_items_github ON kanban_items(github_repo, github_number) WHERE github_repo IS NOT NULL;
CREATE INDEX IF NOT EXISTS kanban_items_lane ON kanban_items(lane, updated_at);
CREATE INDEX IF NOT EXISTS kanban_items_product ON kanban_items(product, lane);

-- Ids that were folded into another item (duplicates merged at import, or
-- later). Lookups by an alias id resolve to the surviving item.
CREATE TABLE IF NOT EXISTS kanban_item_aliases (
  alias_id INTEGER PRIMARY KEY,
  item_id  INTEGER NOT NULL REFERENCES kanban_items(id) ON DELETE CASCADE,
  reason   TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS kanban_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id         INTEGER REFERENCES kanban_items(id) ON DELETE SET NULL,
  product         TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  actor           TEXT NOT NULL DEFAULT 'system',
  summary         TEXT NOT NULL DEFAULT '',
  evidence_url    TEXT,
  idempotency_key TEXT UNIQUE,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS kanban_events_item ON kanban_events(item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS kanban_events_created ON kanban_events(created_at DESC);

CREATE TABLE IF NOT EXISTS kanban_github_sources (
  repo         TEXT PRIMARY KEY,
  product      TEXT NOT NULL REFERENCES kanban_products(slug),
  enabled      INTEGER NOT NULL DEFAULT 1,
  last_sync_at TEXT,
  last_error   TEXT
);
`;

function defaultDbPath(env = process.env) {
  return path.resolve(env.OPS_KANBAN_DB || path.join(__dirname, "data", "kanban.db"));
}

function badInput(message) {
  const error = new Error(message);
  error.code = "BAD_INPUT";
  return error;
}

function clean(value, max) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase().replace(/^[\w.-]+\//, "").replace(/[\s_]+/g, "-");
}

// Historical issue references must resolve to the same kanban item after a transfer.
const TRANSFERRED_REPOS = new Map([
  "AHDGame", "AHDClient", "AHDNative", "a-house-divided", "ahd-client",
  "ahd-android", "adhd-bot", "MOVGame", "MOVGame-native", "metroforge",
  "metroforge-native", "grand-century", "verdigris", "foreshore", "rialto",
  "lakeside-ops", "lakeside-code", "lakeside-operator", "LSGD-ops-dash", "ask",
].map((name) => [name.toLowerCase(), name]));
TRANSFERRED_REPOS.set("ahd-sim", "MOVGame");

function canonicalGithubRepo(repo) {
  const [owner, name] = repo.split("/");
  if (!name) return repo;
  if (!["egg3901", "lakesidegamedev"].includes(owner.toLowerCase())) return repo;
  const canonical = TRANSFERRED_REPOS.get(name.toLowerCase());
  return canonical ? `lakesidegamedev/${canonical}` : repo;
}

// Accepts "lakesidegamedev/AHDGame#123", "https://github.com/Egg3901/AHDGame/issues/123",
// or { repo, number }. Returns { repo, number, url } or null.
function parseGithubRef(input) {
  if (!input) return null;
  if (typeof input === "object" && input.repo && input.number) {
    const number = Number(input.number);
    if (!Number.isInteger(number) || number <= 0) throw badInput("github number must be a positive integer");
    const repo = canonicalGithubRepo(String(input.repo).trim());
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw badInput("github repo must look like owner/name");
    return { repo, number, url: `https://github.com/${repo}/issues/${number}` };
  }
  const text = String(input).trim();
  const url = text.match(/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(?:issues|pull)\/(\d+)\b/);
  if (url) {
    const repo = canonicalGithubRepo(url[1]);
    return { repo, number: Number(url[2]), url: text.split(/[?#]/)[0].replace(`/${url[1]}/`, `/${repo}/`) };
  }
  const short = text.match(/^([\w.-]+\/[\w.-]+)#(\d+)$/);
  if (short) {
    const repo = canonicalGithubRepo(short[1]);
    return { repo, number: Number(short[2]), url: `https://github.com/${repo}/issues/${short[2]}` };
  }
  throw badInput(`unrecognized GitHub reference "${text}" (use owner/repo#N or an issue URL)`);
}

function checkUrl(value, field) {
  const url = clean(value, 2000);
  if (url && !/^https?:\/\//i.test(url)) throw badInput(`${field} must be an http(s) URL`);
  return url;
}

function laneForLabels(labels) {
  const names = new Set(labels.map((label) => String(label).toLowerCase()));
  if (names.has("blocked")) return "blocked";
  if (names.has("in progress") || names.has("in-progress") || names.has("doing")) return "now";
  return "backlog";
}

function impactForLabels(labels) {
  const names = labels.map((label) => String(label).toLowerCase());
  if (names.some((name) => /critical|urgent|p0|p1|high priority/.test(name))) return "high";
  if (names.some((name) => /low priority|p3|p4/.test(name))) return "low";
  return "medium";
}

const execFileAsync = promisify(execFile);
const GH_BIN = process.env.GH_BIN || "gh";

async function ghJson(args, run = execFileAsync) {
  const { stdout } = await run(GH_BIN, args, { timeout: 120_000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, HOME: process.env.HOME || "/root" } });
  return JSON.parse(stdout);
}

async function fetchOpenIssues(repo, run) {
  return ghJson(["issue", "list", "--repo", repo, "--state", "open", "--limit", "1000", "--json", "number,title,url,labels,updatedAt"], run);
}

async function fetchIssueState(repo, number, run) {
  const issue = await ghJson(["api", `repos/${repo}/issues/${number}`], run);
  return { state: String(issue.state || "").toLowerCase(), title: issue.title, url: issue.html_url, labels: (issue.labels || []).map((l) => l.name) };
}

function openKanban(dbPath = defaultDbPath(), { now = () => new Date() } = {}) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const Database = require("better-sqlite3");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec(SCHEMA);

  const iso = () => now().toISOString();

  function products({ includeArchived = false } = {}) {
    return db.prepare(`SELECT slug, name, aliases, mode, health, product_url, archived FROM kanban_products ${includeArchived ? "" : "WHERE archived = 0"} ORDER BY sort_order, name`)
      .all().map((row) => ({ ...row, aliases: JSON.parse(row.aliases || "[]"), archived: Boolean(row.archived) }));
  }

  function upsertProduct({ slug, name, aliases = [], mode, health, product_url, archived = false, sort_order = 0 }) {
    db.prepare(`INSERT INTO kanban_products (slug, name, aliases, mode, health, product_url, archived, sort_order)
      VALUES (@slug, @name, @aliases, @mode, @health, @product_url, @archived, @sort_order)
      ON CONFLICT(slug) DO UPDATE SET name = excluded.name, aliases = excluded.aliases, mode = excluded.mode,
        health = excluded.health, product_url = excluded.product_url, archived = excluded.archived, sort_order = excluded.sort_order`)
      .run({ slug, name, aliases: JSON.stringify(aliases), mode: mode || "building", health: health || "on_track", product_url: product_url || null, archived: archived ? 1 : 0, sort_order });
  }

  // Slug, display name, or any alias, case-insensitive. "Egg3901/AHDGame"
  // drops the owner prefix first.
  function resolveProduct(input, { required = true } = {}) {
    if (input == null || input === "") {
      if (required) throw badInput("product is required");
      return null;
    }
    const key = normalizeKey(input);
    for (const product of products({ includeArchived: true })) {
      const names = [product.slug, product.name, ...product.aliases].map(normalizeKey);
      if (names.includes(key)) return product.slug;
    }
    throw badInput(`unknown product "${input}". Known: ${products().map((p) => `${p.slug} (${p.aliases.join(", ") || "no aliases"})`).join("; ")}`);
  }

  function resolveId(id) {
    const n = Number(id);
    if (!Number.isInteger(n) || n <= 0) throw badInput("id must be a positive integer");
    if (db.prepare("SELECT 1 FROM kanban_items WHERE id = ?").get(n)) return n;
    const alias = db.prepare("SELECT item_id FROM kanban_item_aliases WHERE alias_id = ?").get(n);
    if (alias) return alias.item_id;
    const error = new Error(`item ${n} not found`);
    error.code = "NOT_FOUND";
    throw error;
  }

  function present(row, { full = false, at = now().getTime() } = {}) {
    const updated = Date.parse(row.updated_at);
    const ageDays = Number.isFinite(updated) ? Math.floor((at - updated) / DAY_MS) : null;
    const staleByAge = row.lane === "now" && ageDays != null && ageDays >= STALE_DAYS;
    const item = {
      id: row.id,
      product: row.product,
      title: row.title,
      lane: row.lane,
      impact: row.impact,
      kind: row.kind,
      needs_owner: Boolean(row.needs_owner),
      stale: Boolean(row.stale_flagged_at) || staleByAge,
      stale_reason: row.stale_flagged_at ? `flagged ${row.stale_flagged_at.slice(0, 10)}` : staleByAge ? `no update in ${ageDays} days` : null,
      assigned_to: row.assigned_to || null,
      progress_summary: row.progress_summary || "",
      last_progress_at: row.last_progress_at || null,
      evidence_url: row.evidence_url || null,
      source: row.source,
      github: row.github_repo ? { repo: row.github_repo, number: row.github_number, url: row.github_url, state: row.github_state } : null,
      created_at: row.created_at,
      updated_at: row.updated_at,
      age_days: ageDays,
      closed_at: row.closed_at || null,
    };
    if (full) {
      item.detail = row.detail;
      item.github_labels = row.github_labels ? JSON.parse(row.github_labels) : [];
      item.legacy_hub_id = row.legacy_hub_id || null;
    } else {
      item.detail_excerpt = row.detail.length > 280 ? `${row.detail.slice(0, 277)}...` : row.detail;
    }
    return item;
  }

  function rowById(id) {
    return db.prepare("SELECT * FROM kanban_items WHERE id = ?").get(id);
  }

  function logEvent({ item_id, product, event_type, actor = "system", summary = "", evidence_url = null, idempotency_key = null, created_at = iso() }) {
    db.prepare(`INSERT INTO kanban_events (item_id, product, event_type, actor, summary, evidence_url, idempotency_key, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(item_id, product, event_type, actor, summary, evidence_url, idempotency_key, created_at);
  }

  const STALE_SQL = `(stale_flagged_at IS NOT NULL OR (lane = 'now' AND julianday(?) - julianday(updated_at) >= ${STALE_DAYS}))`;

  function list({ product, lane, lanes, stale, needs_owner, include_done = false, q, source, limit = 200 } = {}) {
    const where = [];
    const params = [];
    if (product) { where.push("product = ?"); params.push(resolveProduct(product)); }
    const laneList = lanes || (lane ? [lane] : null);
    if (laneList) {
      for (const l of laneList) if (!LANES.includes(l)) throw badInput(`lane must be one of ${LANES.join(", ")}`);
      where.push(`lane IN (${laneList.map(() => "?").join(",")})`);
      params.push(...laneList);
    } else if (!include_done) {
      where.push("lane != 'done'");
    }
    if (stale === true) { where.push(STALE_SQL); params.push(iso()); }
    if (stale === false) { where.push(`NOT ${STALE_SQL}`); params.push(iso()); }
    if (needs_owner === true) where.push("needs_owner = 1");
    if (needs_owner === false) where.push("needs_owner = 0");
    if (source) { where.push("source = ?"); params.push(source); }
    if (q) { where.push("(title LIKE ? OR detail LIKE ? OR progress_summary LIKE ?)"); const like = `%${q}%`; params.push(like, like, like); }
    const max = Math.min(Math.max(Number(limit) || 200, 1), 1000);
    const rows = db.prepare(`SELECT * FROM kanban_items ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY CASE lane WHEN 'now' THEN 0 WHEN 'blocked' THEN 1 WHEN 'next' THEN 2 WHEN 'backlog' THEN 3 ELSE 4 END,
        CASE impact WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, updated_at DESC LIMIT ?`).all(...params, max + 1);
    const at = now().getTime();
    return { items: rows.slice(0, max).map((row) => present(row, { at })), truncated: rows.length > max };
  }

  function get(id, { events = 25 } = {}) {
    const realId = resolveId(id);
    const item = present(rowById(realId), { full: true });
    item.aliases = db.prepare("SELECT alias_id, reason FROM kanban_item_aliases WHERE item_id = ?").all(realId);
    item.events = db.prepare("SELECT event_type, actor, summary, evidence_url, created_at FROM kanban_events WHERE item_id = ? ORDER BY created_at DESC, id DESC LIMIT ?").all(realId, events);
    return item;
  }

  function add(input = {}, { actor = "agent" } = {}) {
    const product = resolveProduct(input.product);
    const title = clean(input.title, 300);
    if (!title) throw badInput("title is required");
    let lane = input.lane || "backlog";
    if (!OPEN_LANES.includes(lane)) throw badInput(`lane must be one of ${OPEN_LANES.join(", ")}`);
    const impact = input.impact || "medium";
    if (!IMPACTS.includes(impact)) throw badInput(`impact must be one of ${IMPACTS.join(", ")}`);
    const github = input.github ? parseGithubRef(input.github) : null;
    if (github) {
      const existing = db.prepare("SELECT id FROM kanban_items WHERE github_repo = ? AND github_number = ?").get(github.repo, github.number);
      if (existing) throw badInput(`${github.repo}#${github.number} is already item ${existing.id}; update that item instead`);
    }
    const start = input.start === true;
    if (start) lane = "now";
    const stamp = iso();
    const assigned = clean(input.assigned_to, 120) || (start ? actor : null);
    const id = db.transaction(() => {
      const info = db.prepare(`INSERT INTO kanban_items (product, title, detail, lane, impact, kind, needs_owner, assigned_to, evidence_url,
          github_repo, github_number, github_url, github_state, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(product, title, clean(input.detail, 20000) || "", lane, impact, clean(input.kind, 40) || "task", input.needs_owner ? 1 : 0,
          assigned, checkUrl(input.evidence_url, "evidence_url"), github?.repo || null, github?.number || null, github?.url || null,
          github ? "open" : null, stamp, stamp);
      const newId = Number(info.lastInsertRowid);
      logEvent({ item_id: newId, product, event_type: "created", actor, summary: `Added to ${lane}`, created_at: stamp });
      if (start) logEvent({ item_id: newId, product, event_type: "started", actor, summary: clean(input.summary, 4000) || "Started", created_at: stamp });
      return newId;
    })();
    return get(id, { events: 5 });
  }

  const UPDATABLE = ["title", "detail", "lane", "impact", "kind", "needs_owner", "assigned_to", "evidence_url", "github", "product", "progress_summary", "stale"];

  function update(id, patch = {}, { actor = "agent" } = {}) {
    const realId = resolveId(id);
    const row = rowById(realId);
    const changes = {};
    for (const key of Object.keys(patch)) {
      if (patch[key] === undefined) continue;
      if (!UPDATABLE.includes(key)) throw badInput(`cannot update "${key}"; allowed: ${UPDATABLE.join(", ")}`);
    }
    if (patch.title !== undefined) { const t = clean(patch.title, 300); if (!t) throw badInput("title cannot be empty"); changes.title = t; }
    if (patch.detail !== undefined) changes.detail = clean(patch.detail, 20000) || "";
    if (patch.lane !== undefined) {
      if (!LANES.includes(patch.lane)) throw badInput(`lane must be one of ${LANES.join(", ")}`);
      changes.lane = patch.lane;
      changes.closed_at = patch.lane === "done" ? (row.closed_at || iso()) : null;
    }
    if (patch.impact !== undefined) { if (!IMPACTS.includes(patch.impact)) throw badInput(`impact must be one of ${IMPACTS.join(", ")}`); changes.impact = patch.impact; }
    if (patch.kind !== undefined) changes.kind = clean(patch.kind, 40) || "task";
    if (patch.needs_owner !== undefined) changes.needs_owner = patch.needs_owner ? 1 : 0;
    if (patch.assigned_to !== undefined) changes.assigned_to = clean(patch.assigned_to, 120);
    if (patch.evidence_url !== undefined) changes.evidence_url = checkUrl(patch.evidence_url, "evidence_url");
    if (patch.progress_summary !== undefined) { changes.progress_summary = clean(patch.progress_summary, 4000) || ""; changes.last_progress_at = iso(); }
    if (patch.product !== undefined) changes.product = resolveProduct(patch.product);
    if (patch.github !== undefined) {
      const github = patch.github ? parseGithubRef(patch.github) : null;
      if (github) {
        const other = db.prepare("SELECT id FROM kanban_items WHERE github_repo = ? AND github_number = ? AND id != ?").get(github.repo, github.number, realId);
        if (other) throw badInput(`${github.repo}#${github.number} is already item ${other.id}`);
      }
      changes.github_repo = github?.repo || null;
      changes.github_number = github?.number || null;
      changes.github_url = github?.url || null;
      changes.github_state = github ? (row.github_repo === github.repo && row.github_number === github.number ? row.github_state : "open") : null;
    }
    // Touching an item is the review the stale flag asks for; `stale: true`
    // re-flags explicitly.
    changes.stale_flagged_at = patch.stale === true ? iso() : null;
    const stamp = iso();
    changes.updated_at = stamp;
    const described = Object.keys(changes).filter((k) => !["updated_at", "closed_at", "stale_flagged_at", "last_progress_at", "github_number", "github_url", "github_state"].includes(k))
      .map((k) => (k === "lane" ? `lane ${row.lane} -> ${changes.lane}` : k === "needs_owner" ? `needs_owner ${changes.needs_owner ? "on" : "off"}` : k === "github_repo" ? "github link" : k));
    if (patch.stale !== undefined) described.push(patch.stale ? "flagged stale" : "stale cleared");
    db.transaction(() => {
      const keys = Object.keys(changes);
      db.prepare(`UPDATE kanban_items SET ${keys.map((k) => `${k} = @${k}`).join(", ")} WHERE id = @id`).run({ ...changes, id: realId });
      logEvent({ item_id: realId, product: changes.product || row.product, event_type: changes.lane && changes.lane !== row.lane ? "moved" : "updated", actor, summary: described.join(", ") || "touched", created_at: stamp });
    })();
    return get(realId, { events: 5 });
  }

  function report({ id, event, summary, evidence_url = null, actor = "agent", idempotency_key = null }) {
    if (!REPORT_EVENTS.includes(event)) throw badInput(`event must be one of ${REPORT_EVENTS.join(", ")}`);
    const text = clean(summary, 4000);
    if (!text) throw badInput("summary is required");
    const realId = resolveId(id);
    const key = clean(idempotency_key, 200);
    if (key) {
      const seen = db.prepare("SELECT item_id FROM kanban_events WHERE idempotency_key = ?").get(key);
      if (seen) return { duplicate: true, item: get(seen.item_id, { events: 5 }) };
    }
    const evidence = checkUrl(evidence_url, "evidence_url");
    const row = rowById(realId);
    const stamp = iso();
    const set = { updated_at: stamp, stale_flagged_at: null, progress_summary: text, last_progress_at: stamp };
    if (evidence) set.evidence_url = evidence;
    if (event === "started") { set.lane = "now"; set.assigned_to = actor; set.closed_at = null; }
    if (event === "blocked") set.lane = "blocked";
    if (event === "decision_requested") set.needs_owner = 1;
    if (event === "completed") { set.lane = "done"; set.closed_at = stamp; set.needs_owner = 0; }
    db.transaction(() => {
      const keys = Object.keys(set);
      db.prepare(`UPDATE kanban_items SET ${keys.map((k) => `${k} = @${k}`).join(", ")} WHERE id = @id`).run({ ...set, id: realId });
      logEvent({ item_id: realId, product: row.product, event_type: event, actor, summary: text, evidence_url: evidence, idempotency_key: key, created_at: stamp });
    })();
    return { duplicate: false, item: get(realId, { events: 5 }) };
  }

  function brief({ product, limit = 10 } = {}) {
    const slug = product ? resolveProduct(product) : null;
    const pick = (opts) => list({ ...opts, product: slug || undefined, limit }).items;
    const count = (where, ...params) => db.prepare(`SELECT COUNT(*) AS n FROM kanban_items WHERE ${where} ${slug ? "AND product = ?" : ""}`).get(...params, ...(slug ? [slug] : [])).n;
    const stamp = iso();
    return {
      scope: slug || "all products",
      generated_at: stamp,
      counts: {
        now: count("lane = 'now' AND needs_owner = 0"),
        next: count("lane = 'next' AND needs_owner = 0"),
        blocked: count("lane = 'blocked' AND needs_owner = 0"),
        backlog: count("lane = 'backlog' AND needs_owner = 0"),
        needs_owner: count("lane != 'done' AND needs_owner = 1"),
        stale: count(`lane != 'done' AND ${STALE_SQL}`, stamp),
      },
      needs_owner: pick({ needs_owner: true }),
      now: pick({ lane: "now", needs_owner: false }),
      blocked: pick({ lane: "blocked", needs_owner: false }),
      next: pick({ lane: "next", needs_owner: false }),
      stale: pick({ stale: true }),
      recent: db.prepare(`SELECT e.item_id, i.title, e.product, e.event_type, e.actor, e.summary, e.evidence_url, e.created_at
        FROM kanban_events e LEFT JOIN kanban_items i ON i.id = e.item_id
        WHERE e.event_type IN ('started','progress','blocked','decision_requested','completed','created') ${slug ? "AND e.product = ?" : ""}
        ORDER BY e.created_at DESC, e.id DESC LIMIT ?`).all(...(slug ? [slug] : []), limit),
    };
  }

  function board() {
    const { items } = list({ limit: 1000 });
    const sources = db.prepare("SELECT repo, product, enabled, last_sync_at, last_error FROM kanban_github_sources ORDER BY repo").all();
    return { generated_at: iso(), stale_days: STALE_DAYS, products: products(), items, github_sources: sources };
  }

  // GitHub sync. Open issues in each enabled source repo are upserted (new
  // ones land in backlog, or now/blocked by label); a linked item whose issue
  // is no longer open is confirmed closed per issue before it moves to done.
  // Sync never bumps updated_at for unchanged items, so it cannot mask
  // staleness.
  async function syncGithub({ repo = null, run } = {}) {
    const sources = db.prepare("SELECT * FROM kanban_github_sources WHERE enabled = 1 AND (? IS NULL OR repo = ?) ORDER BY repo").all(repo, repo);
    const results = [];
    for (const source of sources) {
      const result = { repo: source.repo, product: source.product, ok: true, open: 0, added: 0, updated: 0, closed: 0, reopened: 0 };
      try {
        const issues = await fetchOpenIssues(source.repo, run);
        result.open = issues.length;
        const openNumbers = new Set(issues.map((issue) => issue.number));
        const stamp = iso();
        db.transaction(() => {
          for (const issue of issues) {
            const labels = (issue.labels || []).map((label) => label.name);
            const existing = db.prepare("SELECT * FROM kanban_items WHERE github_repo = ? AND github_number = ?").get(source.repo, issue.number);
            if (!existing) {
              const info = db.prepare(`INSERT INTO kanban_items (product, title, lane, impact, kind, source, github_repo, github_number, github_url, github_state, github_labels, github_synced_at, created_at, updated_at)
                VALUES (?, ?, ?, ?, 'issue', 'github', ?, ?, ?, 'open', ?, ?, ?, ?)`)
                .run(source.product, issue.title, laneForLabels(labels), impactForLabels(labels), source.repo, issue.number, issue.url, JSON.stringify(labels), stamp, stamp, stamp);
              logEvent({ item_id: Number(info.lastInsertRowid), product: source.product, event_type: "created", actor: "github-sync", summary: `Imported open issue ${source.repo}#${issue.number}`, created_at: stamp });
              result.added += 1;
              continue;
            }
            const reopened = existing.github_state !== "open" || existing.lane === "done";
            const titleChanged = existing.source === "github" && existing.title !== issue.title;
            const set = { github_state: "open", github_labels: JSON.stringify(labels), github_synced_at: stamp, github_url: issue.url };
            if (titleChanged) set.title = issue.title;
            if (reopened) { set.lane = existing.lane === "done" ? "backlog" : existing.lane; set.closed_at = null; }
            if (titleChanged || reopened) set.updated_at = stamp;
            const keys = Object.keys(set);
            db.prepare(`UPDATE kanban_items SET ${keys.map((k) => `${k} = @${k}`).join(", ")} WHERE id = @id`).run({ ...set, id: existing.id });
            if (reopened) { logEvent({ item_id: existing.id, product: existing.product, event_type: "reopened", actor: "github-sync", summary: `${source.repo}#${issue.number} is open again`, created_at: stamp }); result.reopened += 1; }
            else if (titleChanged) result.updated += 1;
          }
        })();
        const missing = db.prepare("SELECT * FROM kanban_items WHERE github_repo = ? AND lane != 'done' AND github_state = 'open'").all(source.repo)
          .filter((item) => !openNumbers.has(item.github_number));
        for (const item of missing) {
          const state = await fetchIssueState(item.github_repo, item.github_number, run);
          if (state.state === "open") continue;
          closeLinked(item, state.state);
          result.closed += 1;
        }
        db.prepare("UPDATE kanban_github_sources SET last_sync_at = ?, last_error = NULL WHERE repo = ?").run(iso(), source.repo);
      } catch (error) {
        result.ok = false;
        result.error = String(error.message || error).slice(0, 500);
        db.prepare("UPDATE kanban_github_sources SET last_error = ? WHERE repo = ?").run(result.error, source.repo);
      }
      results.push(result);
    }
    // Linked items in repos that are not sync sources (a link added by hand).
    if (!repo) {
      const sourceRepos = new Set(db.prepare("SELECT repo FROM kanban_github_sources").all().map((s) => s.repo));
      const orphans = db.prepare("SELECT * FROM kanban_items WHERE github_repo IS NOT NULL AND lane != 'done' AND github_state = 'open'").all()
        .filter((item) => !sourceRepos.has(item.github_repo));
      for (const item of orphans) {
        try {
          const state = await fetchIssueState(item.github_repo, item.github_number, run);
          if (state.state !== "open") { closeLinked(item, state.state); results.push({ repo: item.github_repo, ok: true, closed: 1, item: item.id }); }
        } catch (error) {
          results.push({ repo: item.github_repo, ok: false, item: item.id, error: String(error.message || error).slice(0, 300) });
        }
      }
    }
    return results;
  }

  function closeLinked(item, state) {
    const stamp = iso();
    db.transaction(() => {
      db.prepare("UPDATE kanban_items SET github_state = ?, lane = 'done', closed_at = ?, needs_owner = 0, updated_at = ?, github_synced_at = ? WHERE id = ?")
        .run(state || "closed", stamp, stamp, stamp, item.id);
      logEvent({ item_id: item.id, product: item.product, event_type: "github_closed", actor: "github-sync", summary: `${item.github_repo}#${item.github_number} is ${state || "closed"} on GitHub`, created_at: stamp });
    })();
  }

  return {
    db,
    path: dbPath,
    close: () => db.close(),
    products,
    upsertProduct,
    resolveProduct,
    resolveId,
    list,
    get,
    add,
    update,
    report,
    brief,
    board,
    syncGithub,
    logEvent,
  };
}

let shared = null;
// One handle per process, opened lazily so a missing better-sqlite3 build or
// an unwritable path fails the kanban routes, not the whole process.
function sharedKanban() {
  if (!shared) shared = openKanban();
  return shared;
}

module.exports = {
  openKanban,
  sharedKanban,
  defaultDbPath,
  parseGithubRef,
  laneForLabels,
  impactForLabels,
  fetchIssueState,
  OPEN_LANES,
  LANES,
  IMPACTS,
  REPORT_EVENTS,
  STALE_DAYS,
};
