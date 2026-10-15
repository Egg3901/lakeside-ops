// knowledge-store.js — shared data layer for the Ops knowledge platform.
//
// Backs three logical "collections" (docs | skills | memory) inside a single
// MongoDB collection `ops_knowledge`. Each entry is markdown-with-frontmatter
// (mirroring the Claude memory store convention: one fact/skill/doc per entry,
// addressed by a kebab-case `name` that is unique within its kind).
//
// This module is intentionally EMBED-AGNOSTIC: callers pass embeddings in. The
// dashboard process and the MCP process each own their own @xenova/transformers
// pipeline, so this file has no ML dependency. The embedding contract matches
// the existing qa_memory pattern in server.js: store `Array.from(embedText(x))`,
// rank with `cosine(q, new Float32Array(entry.embedding))`.

const { MongoClient, ObjectId } = require("mongodb");

function resolveKnowledgeDbName() {
  if (process.env.MONGODB_DB_NAME) return process.env.MONGODB_DB_NAME;
  if (process.env.KNOWLEDGE_DB_NAME) return process.env.KNOWLEDGE_DB_NAME;
  try {
    const { getConfig } = require("./src/core/config");
    const cfg = getConfig();
    if (cfg.mongodb?.dbName) return cfg.mongodb.dbName;
    const primary = (cfg.projects || []).find((p) => p.key === cfg.primaryProject);
    if (primary?.integrations?.mongodb?.dbName) return primary.integrations.mongodb.dbName;
  } catch { /* config optional at boot */ }
  return "ops-dashboard";
}

function resolveLegacyProject() {
  if (process.env.KNOWLEDGE_LEGACY_PROJECT) return process.env.KNOWLEDGE_LEGACY_PROJECT;
  if (process.env.KNOWLEDGE_DEFAULT_PROJECT) return process.env.KNOWLEDGE_DEFAULT_PROJECT;
  try {
    const { getConfig } = require("./src/core/config");
    const cfg = getConfig();
    if (cfg.knowledge?.legacyProject) return cfg.knowledge.legacyProject;
    if (cfg.primaryProject) return cfg.primaryProject;
  } catch { /* optional */ }
  return "shared";
}

const DB_NAME = resolveKnowledgeDbName();
const COLLECTION = process.env.KNOWLEDGE_COLLECTION || "ops_knowledge";
const KINDS = ["docs", "skills", "memory"];
// Multi-repo siloing: every entry belongs to a `project`. Reads default to
// OPEN (any agent can see any project) so the brain stays shared; pass a
// project to scope a read to that project PLUS the always-visible SHARED
// project. Writes default to SHARED unless a project is given. `all` is an
// explicit "search everything" sentinel for reads.
const PROJECT_SHARED = "shared";
const PROJECT_DEFAULT_WRITE = PROJECT_SHARED;
const LEGACY_PROJECT = resolveLegacyProject();

function normProject(p) {
  const s = String(p == null ? "" : p)
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return s || PROJECT_SHARED;
}

// Mongo filter fragment scoping a read to a project. Undefined/null/"all" =>
// no restriction (open access). Otherwise the named project + SHARED.
function projectScope(project) {
  if (project == null || project === "all") return {};
  return { project: { $in: [normProject(project), PROJECT_SHARED] } };
}
const EMBED_DIM = 384; // bge-small-en-v1.5
const QUERY_LOG_COLLECTION = "knowledge_query_log";
const RERANK_CONFIG_COLLECTION = "knowledge_rerank_config";
const CANDIDATE_POOL_CAP = 5000; // see query() — past this, brute-force cosine needs a real ANN index

let _client = null;

async function getDb(uri) {
  if (!_client) {
    _client = new MongoClient(uri || process.env.MONGODB_URI, {
      maxPoolSize: 2,
      // Railway's live mongod is a standalone behind a TCP proxy. Without this
      // the driver treats the single host as a seed list and tries to discover
      // a replica set, falling back to localhost and failing.
      directConnection: true,
    });
    await _client.connect();
  }
  return _client.db(DB_NAME);
}

// One-time index setup. Unique (kind, name) enforces the "one entry per slug"
// convention and makes save() an idempotent upsert. Safe to call repeatedly.
async function ensureIndexes(db) {
  const col = db.collection(COLLECTION);
  // Backfill the project axis onto the pre-siloing corpus BEFORE the new unique
  // index goes on, so nothing collides on a null project.
  await col.updateMany({ project: { $exists: false } }, { $set: { project: LEGACY_PROJECT } });
  // Retire the old (kind,name) uniqueness — the slug is now unique per project,
  // so the same name can live in two repos.
  try { await col.dropIndex("kind_1_name_1"); } catch (_) { /* already gone */ }
  await col.createIndex({ project: 1, kind: 1, name: 1 }, { unique: true });
  await col.createIndex({ project: 1, kind: 1, deletedAt: 1, updatedAt: -1 });
  await col.createIndex({ kind: 1, deletedAt: 1, updatedAt: -1 });
  await col.createIndex({ title: "text", body: "text", description: "text", tags: "text" });
  // Backlink lookups for the knowledge graph: "who links to this entry".
  await col.createIndex({ links: 1, deletedAt: 1 });
  // Shared-tag neighbor lookups (the second graph axis).
  await col.createIndex({ tags: 1, deletedAt: 1 });

  // Per-query feature log — the training signal for learned rerank weights.
  // TTL'd at 90d so it self-prunes; it's a rolling training window, not a
  // permanent audit log.
  await db
    .collection(QUERY_LOG_COLLECTION)
    .createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });
}

// ─── cosine similarity (pure, no deps) ──────────────────────────────────────
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function assertKind(kind) {
  if (!KINDS.includes(kind)) {
    throw new Error(`unknown collection "${kind}" (expected one of: ${KINDS.join(", ")})`);
  }
}

// Normalize a user-supplied slug. Keeps the kebab-case memory convention.
function slugify(name) {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

// Extract [[wiki-links]] from a body → array of unique target slugs. Supports
// [[slug|label]]. This is what turns the flat store into a traversable graph.
function parseLinks(body) {
  const out = new Set();
  const rx = /\[\[([^\]]+)\]\]/g;
  let m;
  while ((m = rx.exec(String(body || ""))) !== null) {
    const s = slugify(m[1].split("|")[0]);
    if (s) out.add(s);
  }
  return Array.from(out);
}

// ─── write: idempotent upsert on (kind, name) ───────────────────────────────
// `embedding` is an optional number[] (already computed by the caller). When
// absent, the entry is stored without a vector (keyword-searchable only).
// On update, the prior revision is snapshotted into `history` (capped) so a
// clobber never destroys another agent's work, and the return value carries an
// advisory `_conflict` flag when a materially different entry by a different
// author was overwritten. Pass `expectedVersion` for optimistic concurrency —
// the save is refused (VERSION_CONFLICT) if the entry moved underneath you.
async function save(db, kind, entry, { actor = "system", expectedVersion = null, project = null } = {}) {
  assertKind(kind);
  const name = slugify(entry.name || entry.title || "");
  if (!name) throw new Error("save requires a name or title");

  const col = db.collection(COLLECTION);
  const now = new Date();
  const embedding =
    Array.isArray(entry.embedding) && entry.embedding.length === EMBED_DIM
      ? entry.embedding
      : null;

  // Resolve which project this entry lives in: an explicit arg wins; otherwise
  // keep an existing entry's project (so plain updates don't move it); a brand
  // new entry with no project given defaults to SHARED.
  let proj = project != null ? normProject(project) : null;
  if (proj == null) {
    const any = await col.findOne({ kind, name }, { projection: { project: 1 } });
    proj = any && any.project ? any.project : PROJECT_DEFAULT_WRITE;
  }

  const existing = await col.findOne({ kind, name, project: proj });
  const isUpdate = !!(existing && !existing.deletedAt);

  if (expectedVersion != null && isUpdate && existing.version !== expectedVersion) {
    const err = new Error(
      `version conflict on "${name}": stored version is ${existing.version}, you passed expectedVersion ${expectedVersion}. Re-read with knowledge_get and merge.`
    );
    err.code = "VERSION_CONFLICT";
    err.currentVersion = existing.version;
    throw err;
  }

  const set = {
    kind,
    name,
    project: proj,
    title: entry.title || name,
    description: entry.description || "",
    body: entry.body || "",
    metadata: entry.metadata || {},
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    links: parseLinks(entry.body || ""),
    embedding,
    semantic: embedding != null,
    updatedAt: now,
    updatedBy: actor,
    deletedAt: null,
  };

  const update = {
    $set: set,
    $setOnInsert: { createdAt: now, createdBy: actor, hits: 0, feedback: { up: 0, down: 0 } },
    $inc: { version: 1 },
  };
  if (isUpdate) {
    // Keep the last 10 revisions so nothing is ever silently lost.
    update.$push = {
      history: {
        $each: [{
          version: existing.version || 0,
          title: existing.title,
          body: existing.body,
          updatedBy: existing.updatedBy,
          updatedAt: existing.updatedAt,
        }],
        $slice: -10,
      },
    };
  }

  const res = await col.findOneAndUpdate({ kind, name, project: proj }, update, {
    upsert: true,
    returnDocument: "after",
  });
  // Driver v6 returns the doc directly; older versions wrap it in `.value`.
  const doc = (res && (res.value !== undefined ? res.value : res)) || (await col.findOne({ kind, name, project: proj }));

  // Advisory (non-blocking) conflict signal: did we just overwrite a
  // materially different entry that a *different* agent authored?
  let similarityToPrev = null;
  if (isUpdate && embedding && Array.isArray(existing.embedding) && existing.embedding.length) {
    similarityToPrev = Number(
      cosine(Float32Array.from(embedding), Float32Array.from(existing.embedding)).toFixed(4)
    );
  }
  const differentAuthor = isUpdate && existing.updatedBy && existing.updatedBy !== actor;
  const materiallyDifferent =
    similarityToPrev != null
      ? similarityToPrev < 0.6
      : isUpdate && Math.abs((existing.body || "").length - (entry.body || "").length) > 200;
  doc._action = isUpdate ? "updated" : "created";
  doc._prevVersion = isUpdate ? existing.version || 0 : null;
  doc._prevAuthor = isUpdate ? existing.updatedBy || null : null;
  doc._similarityToPrev = similarityToPrev;
  doc._conflict = !!(differentAuthor && materiallyDifferent);
  return doc;
}

async function get(db, kind, name, { project = null } = {}) {
  assertKind(kind);
  return db.collection(COLLECTION).findOne({ kind, name: slugify(name), deletedAt: null, ...projectScope(project) });
}

// `offset` pages past the limit; order "name" is stable while entries are
// being edited, which a full walk needs (updatedAt order reshuffles mid-walk).
async function list(db, kind, { limit = 200, offset = 0, order = "updated", includeBody = false, project = null } = {}) {
  assertKind(kind);
  const projection = includeBody ? {} : { body: 0, embedding: 0 };
  return db
    .collection(COLLECTION)
    .find({ kind, deletedAt: null, ...projectScope(project) }, { projection })
    .sort(order === "name" ? { name: 1, _id: 1 } : { updatedAt: -1, _id: 1 })
    .skip(Math.max(0, offset | 0))
    .limit(Math.min(limit, 1000))
    .toArray();
}

// Soft delete — preserves history and lets the dashboard surface a tombstone.
async function remove(db, kind, name, { actor = "system", project = null } = {}) {
  assertKind(kind);
  const res = await db.collection(COLLECTION).updateOne(
    { kind, name: slugify(name), deletedAt: null, ...projectScope(project) },
    { $set: { deletedAt: new Date(), deletedBy: actor } }
  );
  return res.modifiedCount > 0;
}

// ─── version history + diff (all kinds: docs, skills, memory) ───────────────
// Every save() snapshots the prior revision into history[]; this exposes the
// full version timeline plus a line diff between any two revisions.
async function history(db, kind, name) {
  assertKind(kind);
  const e = await db.collection(COLLECTION).findOne(
    { kind, name: slugify(name) },
    { projection: { embedding: 0 } }
  );
  if (!e) return null;
  const versions = (e.history || []).map((h) => ({
    version: h.version,
    updatedBy: h.updatedBy,
    updatedAt: h.updatedAt,
    title: h.title,
    body: h.body,
  }));
  versions.push({
    version: e.version,
    updatedBy: e.updatedBy,
    updatedAt: e.updatedAt,
    title: e.title,
    body: e.body,
    current: true,
  });
  return { kind: e.kind, name: e.name, currentVersion: e.version, versions };
}

// Minimal dependency-free LCS line diff → unified-ish "  ctx / - old / + new".
function diffLines(oldStr, newStr) {
  const a = String(oldStr == null ? "" : oldStr).split("\n");
  const b = String(newStr == null ? "" : newStr).split("\n");
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push("  " + a[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push("- " + a[i]); i++; }
    else { out.push("+ " + b[j]); j++; }
  }
  while (i < n) out.push("- " + a[i++]);
  while (j < m) out.push("+ " + b[j++]);
  return out.join("\n");
}

// ─── graph: neighbors (outbound [[links]] + backlinks) ──────────────────────
// Links are matched by `name` across all kinds, since [[slug]] carries no kind.
async function neighbors(db, kind, name, { limit = 25, project = null } = {}) {
  if (kind) assertKind(kind);
  const col = db.collection(COLLECTION);
  const slug = slugify(name);
  const scope = projectScope(project);
  const proj = { projection: { body: 0, embedding: 0, history: 0 } };
  const self = await col.findOne({ kind, name: slug, deletedAt: null, ...scope });
  const outNames = self && Array.isArray(self.links) ? self.links : [];
  const outbound = outNames.length
    ? await col.find({ name: { $in: outNames }, deletedAt: null, ...scope }, proj).limit(limit).toArray()
    : [];
  const backlinks = await col
    .find({ links: slug, deletedAt: null, ...scope }, proj)
    .limit(limit)
    .toArray();
  // Shared-tag siblings: a second, cheaper graph axis than explicit [[links]].
  // Entries that share ≥1 tag but aren't already an explicit neighbor or self.
  const selfTags = self && Array.isArray(self.tags) ? self.tags : [];
  const excluded = new Set([slug, ...outNames, ...backlinks.map((b) => b.name)]);
  let sharedTag = [];
  if (selfTags.length) {
    const cand = await col
      .find({ tags: { $in: selfTags }, deletedAt: null, ...scope }, proj)
      .limit(limit + excluded.size)
      .toArray();
    sharedTag = cand
      .filter((c) => !excluded.has(c.name))
      .map((c) => ({
        ...trimNeighbor(c),
        sharedTags: (c.tags || []).filter((t) => selfTags.includes(t)),
      }))
      .slice(0, limit);
  }
  return {
    outbound: outbound.map(trimNeighbor),
    // Unresolved outbound links (a [[target]] that doesn't exist yet) — useful
    // signal for what's worth writing next.
    danglingOut: outNames.filter((n) => !outbound.some((o) => o.name === n)),
    backlinks: backlinks.map(trimNeighbor),
    sharedTag,
  };
}
function trimNeighbor(e) {
  return { name: e.name, kind: e.kind, title: e.title, description: e.description, tags: e.tags };
}

// ─── reinforcement: usefulness feedback ─────────────────────────────────────
async function feedback(db, kind, name, vote, { actor = "system", project = null } = {}) {
  assertKind(kind);
  const field = vote === "up" ? "feedback.up" : vote === "down" ? "feedback.down" : null;
  if (!field) throw new Error('vote must be "up" or "down"');
  const col = db.collection(COLLECTION);
  const slug = slugify(name);
  const res = await col.findOneAndUpdate(
    { kind, name: slug, deletedAt: null, ...projectScope(project) },
    { $inc: { [field]: 1 }, $set: { lastFeedbackAt: new Date(), lastFeedbackBy: actor } },
    { returnDocument: "after" }
  );
  // Driver v6 returns the doc directly; older versions wrap it in `.value`.
  const doc = res == null ? null : res.value !== undefined ? res.value : res;
  if (!doc) return null;
  return { name: doc.name, kind: doc.kind, feedback: doc.feedback || { up: 0, down: 0 } };
}

function toObjectId(id) {
  try { return typeof id === "string" ? new ObjectId(id) : id; } catch { return null; }
}

// Reinforcement telemetry: bump retrieval counters for entries that were
// actually returned to an agent. Fire-and-forget — never fail a read on it.
async function recordHits(db, ids) {
  const objIds = (ids || []).map(toObjectId).filter(Boolean);
  if (!objIds.length) return;
  try {
    await db.collection(COLLECTION).updateMany(
      { _id: { $in: objIds } },
      { $inc: { hits: 1 }, $set: { lastRetrievedAt: new Date() } }
    );
  } catch (_) { /* telemetry only */ }
}

const REVIEW_STALE_DAYS = 7;

// Curation: when an agent reads an entry that hasn't been touched in over a
// week, flag it for the next review pass (verify a doc is still correct/needed;
// decide whether a memory is worth keeping). Idempotent — only flags entries
// that aren't already pending and weren't reviewed within the window. Fire-and-
// forget: never fail a read on it.
async function flagStaleOnRead(db, ids, { maxAgeDays = REVIEW_STALE_DAYS } = {}) {
  const objIds = (ids || []).map(toObjectId).filter(Boolean);
  if (!objIds.length) return;
  const cutoff = new Date(Date.now() - maxAgeDays * 86400000);
  try {
    await db.collection(COLLECTION).updateMany(
      {
        _id: { $in: objIds },
        deletedAt: null,
        updatedAt: { $lt: cutoff },
        reviewPending: { $ne: true },
        $or: [{ lastReviewedAt: { $exists: false } }, { lastReviewedAt: { $lt: cutoff } }],
      },
      {
        $set: {
          reviewPending: true,
          reviewFlaggedAt: new Date(),
          reviewReason: `read while >${maxAgeDays}d since last update`,
        },
      }
    );
  } catch (_) { /* curation telemetry only */ }
}

// The queue the review pass consumes: entries flagged stale-on-read.
async function listReviewQueue(db, { limit = 500 } = {}) {
  return db
    .collection(COLLECTION)
    .find({ reviewPending: true, deletedAt: null }, { projection: { embedding: 0, history: 0 } })
    .sort({ reviewFlaggedAt: 1 })
    .limit(limit)
    .toArray();
}

// Clear the flag after assessment and record the outcome + when it was reviewed
// (so it won't re-flag until it goes stale again).
async function markReviewed(db, kind, name, { recommendation = "keep", note = "", actor = "review-pass" } = {}) {
  assertKind(kind);
  await db.collection(COLLECTION).updateOne(
    { kind, name: slugify(name) },
    {
      $set: {
        reviewPending: false,
        lastReviewedAt: new Date(),
        reviewedBy: actor,
        reviewRecommendation: recommendation,
        reviewNote: note,
      },
    }
  );
}

// Pure heuristic: given a flagged entry, recommend keep / ditch / verify.
// - memory: keep if it's been used or edited; ditch-candidate if cold & unused;
//   otherwise verify. (Never auto-deletes here — caller decides.)
// - docs/skills: verify correctness/relevance (keep outright if well-used).
function assessEntry(e, { now = Date.now() } = {}) {
  const days = (d) => (d ? (now - new Date(d).getTime()) / 86400000 : Infinity);
  const hits = e.hits || 0;
  const edits = e.version || 1;
  const fb = e.feedback || { up: 0, down: 0 };
  const net = (fb.up || 0) - (fb.down || 0);
  const ageSinceUpdate = days(e.updatedAt);
  const sinceRetrieved = days(e.lastRetrievedAt);
  const signals = { hits, edits, net, ageSinceUpdate: Math.round(ageSinceUpdate), sinceRetrieved: Math.round(sinceRetrieved) };

  if (e.kind === "memory") {
    const valued = hits >= 5 || edits >= 3 || net > 0 || sinceRetrieved <= 30;
    const cold = hits === 0 && edits <= 1 && sinceRetrieved > 30 && ageSinceUpdate > 30;
    if (valued) return { recommendation: "keep", reason: "used or maintained recently", signals };
    if (cold) return { recommendation: "ditch", reason: "no hits/edits and cold >30d — likely obsolete", signals };
    return { recommendation: "verify", reason: "low signal — confirm still worth keeping", signals };
  }
  // docs / skills
  if (hits >= 8) return { recommendation: "keep", reason: "heavily referenced", signals };
  if (net < 0) return { recommendation: "verify", reason: "net-negative feedback — likely wrong/stale", signals };
  return { recommendation: "verify", reason: "stale on read — confirm still correct & needed", signals };
}

// ─── read: hybrid retrieval ─────────────────────────────────────────────────
// Combines keyword filtering with vector similarity. `queryEmbedding` is the
// caller-computed query vector (optional). When present, entries that carry an
// embedding are ranked by cosine; entries without one fall back to a keyword
// score so the result set is never silently empty on a fresh corpus.
// Default weights for the hand-tuned formula that shipped originally. A
// learned alternative can be written to RERANK_CONFIG_COLLECTION by
// train-rerank-weights.js once enough real query_log + feedback data exists;
// getRerankWeights() falls back to these when no learned weights are stored
// yet (or the process hasn't refreshed its 60s cache).
const DEFAULT_WEIGHTS = { sem: 1, key: 1, reinforce: 1, recency: 1, graph: 1, bias: 0 };

let _weightsCache = null;
let _weightsCacheAt = 0;
async function getRerankWeights(db) {
  const now = Date.now();
  if (_weightsCache && now - _weightsCacheAt < 60_000) return _weightsCache;
  const doc = await db.collection(RERANK_CONFIG_COLLECTION).findOne({ _id: "active" });
  _weightsCache = doc && doc.weights ? { ...DEFAULT_WEIGHTS, ...doc.weights } : DEFAULT_WEIGHTS;
  _weightsCacheAt = now;
  return _weightsCache;
}

async function setRerankWeights(db, weights, meta = {}) {
  await db
    .collection(RERANK_CONFIG_COLLECTION)
    .updateOne({ _id: "active" }, { $set: { weights, updatedAt: new Date(), ...meta } }, { upsert: true });
  _weightsCache = null; // force reload on next query()
}

// Fire-and-forget: records the scored candidate pool for a semantic query so
// train-rerank-weights.js has (query → per-candidate feature vector) pairs to
// learn from later, joined against each entry's accumulated feedback/hits at
// training time. Never blocks or fails the caller.
async function logQueryOutcome(db, { text, kind, scored }) {
  try {
    await db.collection(QUERY_LOG_COLLECTION).insertOne({
      text: String(text || "").slice(0, 500),
      kind: kind || null,
      createdAt: new Date(),
      candidates: scored.slice(0, 20).map((s, i) => ({
        name: s.entry.name,
        kind: s.entry.kind,
        sem: s.sem,
        key: s.key,
        reinforce: s.reinforce,
        recency: s.recency,
        rank: i,
      })),
    });
  } catch (_) {
    /* best-effort */
  }
}

async function query(db, { kind = null, text = "", queryEmbedding = null, limit = 10, log = true, project = null } = {}) {
  if (kind) assertKind(kind);
  const col = db.collection(COLLECTION);

  const filter = { deletedAt: null, ...projectScope(project) };
  if (kind) filter.kind = kind;

  // Pull a candidate pool.
  let candidates;
  if (queryEmbedding) {
    // Semantic query: scan the whole (kind-scoped) corpus so recall isn't
    // bounded by keyword overlap. Brute-force cosine is exact and, at our scale
    // (hundreds–few thousand vectors), faster than maintaining an ANN index.
    // CANDIDATE_POOL_CAP is a safety bound — past that, add a real vector index.
    const poolSize = await col.countDocuments({ ...filter, embedding: { $ne: null } });
    if (poolSize > CANDIDATE_POOL_CAP) {
      console.warn(
        `[knowledge-store] embedded corpus (${poolSize}) exceeds the brute-force cosine cap ` +
          `(${CANDIDATE_POOL_CAP}) — recall is now bounded by the cap, not a real limit. ` +
          `Time to add an ANN index (hnswlib-node / sqlite-vec) instead of scanning everything.`
      );
    }
    candidates = await col.find({ ...filter, embedding: { $ne: null } }).limit(CANDIDATE_POOL_CAP).toArray();
  } else if (text && text.trim()) {
    const rx = new RegExp(text.trim().split(/\s+/).map(escapeRegex).join("|"), "i");
    candidates = await col
      .find({ ...filter, $or: [{ title: rx }, { body: rx }, { description: rx }, { tags: rx }] })
      .limit(200)
      .toArray();
    // Backfill with recent entries if the keyword pass was thin, so semantic
    // ranking still has something to work with.
    if (candidates.length < 50) {
      const extra = await col.find(filter).sort({ updatedAt: -1 }).limit(150).toArray();
      const seen = new Set(candidates.map((c) => String(c._id)));
      for (const e of extra) if (!seen.has(String(e._id))) candidates.push(e);
    }
  } else {
    candidates = await col.find(filter).sort({ updatedAt: -1 }).limit(200).toArray();
  }

  const q = queryEmbedding ? Float32Array.from(queryEmbedding) : null;
  const kw = text ? text.toLowerCase() : "";
  const w = await getRerankWeights(db);

  const scored = candidates.map((e) => {
    let sem = 0;
    if (q && Array.isArray(e.embedding) && e.embedding.length) {
      sem = cosine(q, new Float32Array(e.embedding));
    }
    // Lightweight keyword signal so non-embedded entries (and exact-name hits)
    // still rank sensibly — important when the embed pipeline is cold and there
    // is no query vector. Tokenize so multi-word queries score by per-term
    // overlap rather than requiring the whole phrase as one substring.
    let key = 0;
    if (kw) {
      const toks = kw.split(/\s+/).filter((t) => t.length > 1);
      if (toks.length) {
        const head = `${e.name} ${e.title} ${e.description} ${(e.tags || []).join(" ")}`.toLowerCase();
        const bodyLc = (e.body || "").toLowerCase();
        let hits = 0;
        for (const t of toks) {
          if (head.includes(t)) hits += 1; // title/name/desc/tags weigh most
          else if (bodyLc.includes(t)) hits += 0.5; // body-only is weaker
        }
        key = (hits / toks.length) * 0.8; // 0..0.8, below semantic's 0..1
        if (head.includes(kw)) key += 0.2; // exact-phrase bonus
      }
    }
    // Reinforcement: frequently-recalled and net-upvoted entries get a gentle
    // lift; downvotes pull down. Bounded (tanh) so real relevance always wins.
    const hits = e.hits || 0;
    const fb = e.feedback || { up: 0, down: 0 };
    const reinforce =
      0.06 * Math.tanh(hits / 12) + 0.05 * Math.tanh(((fb.up || 0) - (fb.down || 0)) / 4);
    // Recency: a mild freshness nudge (half-life ~90d) so stale entries drift
    // down without ever being hidden.
    let recency = 0;
    if (e.updatedAt) {
      const ageDays = (Date.now() - new Date(e.updatedAt).getTime()) / 86400000;
      recency = 0.04 * Math.exp(-ageDays / 90);
    }
    const score = w.sem * sem + w.key * key + w.reinforce * reinforce + w.recency * recency + (w.bias || 0);
    return { entry: e, score, sem, key, reinforce, recency };
  });

  scored.sort((a, b) => b.score - a.score);

  // Graph-boost: entries directly linked to/from the top semantic match are
  // often exactly what a query also needs (e.g. a runbook's linked incident
  // postmortem) even when their own text match is weaker. Bounded and applied
  // only against the #1 result so it can't cascade into an unrelated cluster.
  if (queryEmbedding && scored.length > 1 && w.graph) {
    const top = scored[0];
    const topLinks = new Set((top.entry.links || []).map(String));
    for (let i = 1; i < scored.length; i++) {
      const s = scored[i];
      const linksToTop = (s.entry.links || []).includes(top.entry.name);
      const linkedFromTop = topLinks.has(s.entry.name);
      if (linksToTop || linkedFromTop) s.score += 0.03 * w.graph;
    }
    scored.sort((a, b) => b.score - a.score);
  }

  const top = scored.slice(0, Math.min(limit, 50));
  if (log && queryEmbedding && text) {
    logQueryOutcome(db, { text, kind, scored: top }).catch(() => {});
  }
  return top.map(({ entry, score, sem, key, reinforce }) => ({
    id: String(entry._id),
    name: entry.name,
    kind: entry.kind,
    project: entry.project || LEGACY_PROJECT,
    title: entry.title,
    description: entry.description,
    body: entry.body,
    tags: entry.tags,
    links: entry.links || [],
    metadata: entry.metadata,
    updatedAt: entry.updatedAt,
    hits: entry.hits || 0,
    feedback: entry.feedback || { up: 0, down: 0 },
    score: Number(score.toFixed(4)),
    semanticScore: Number(sem.toFixed(4)),
    keywordScore: Number(key.toFixed(4)),
    reinforceScore: Number(reinforce.toFixed(4)),
  }));
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  getDb,
  ensureIndexes,
  save,
  get,
  list,
  remove,
  query,
  history,
  diffLines,
  neighbors,
  feedback,
  recordHits,
  flagStaleOnRead,
  listReviewQueue,
  markReviewed,
  assessEntry,
  parseLinks,
  cosine,
  slugify,
  normProject,
  projectScope,
  PROJECT_SHARED,
  LEGACY_PROJECT,
  getRerankWeights,
  setRerankWeights,
  logQueryOutcome,
  KINDS,
  EMBED_DIM,
  COLLECTION,
  QUERY_LOG_COLLECTION,
  RERANK_CONFIG_COLLECTION,
  DB_NAME,
  ObjectId,
};
