// support-tracker.js: the merge point between player support tickets and the
// long-running tracker (collection `tracker_items`, same database).
//
// A ticket or suggestion links to tracker state through `trackerItemId` on its
// own document. The tracker item carries the back-pointer in its free-form
// `fields` bag (`supportKind` / `supportNumber` / `supportTitle`), so either
// side answers "what is tracking this report".
//
// This module holds only pure document builders: no database, no clock, no
// network. The support MCP handlers call them, and the tests pin them. That is
// deliberate. The one tool that writes must be trustworthy without being
// exercised against real tickets.

const TRACKER_COLLECTION = "tracker_items";

// Tracker completion says WHERE work got to. Mirrors the tracker's own Status
// enum; anything outside it is rejected rather than stored.
const TRACKER_STATUSES = [
  "open",
  "active",
  "blocked",
  "done_branch",
  "done_dev",
  "done_prod",
  "done",
  "dropped",
];

// Content fields an agent may edit per collection. Suggestion-only fields are
// rejected on tickets so a typo does not silently write nowhere.
const TICKET_EDIT_FIELDS = ["title", "description", "category", "tags"];
const SUGGESTION_EDIT_FIELDS = [
  "title",
  "description",
  "category",
  "tags",
  "gameSystem",
  "priority",
  "impact",
  "context",
];

// Length caps mirror the MCP tool schemas. Anything longer is rejected with a
// message naming the field, not truncated: silent truncation rewrites a
// reporter's words into something they did not write.
const LIMITS = {
  title: 200,
  description: 8000,
  category: 60,
  tag: 40,
  tags: 20,
  gameSystem: 60,
  priority: 20,
  impact: 2000,
  context: 8000,
  note: 500,
  trackerBody: 8000,
  project: 80,
  realm: 80,
  phase: 80,
  blocked_by: 500,
  updated_by: 80,
  trackerNote: 2000,
};

function isKind(kind) {
  return kind === "ticket" || kind === "suggestion";
}

function numberKey(kind) {
  return kind === "ticket" ? "ticketNumber" : "issueNumber";
}

// Stable tracker id for a report. Derived, never allocated, so re-running the
// sync converges on one row instead of littering.
function trackerIdFor(kind, number) {
  return `support-${kind}-${number}`;
}

function strError(value, field, min, max) {
  if (typeof value !== "string") return `${field} must be a string`;
  const t = value.trim();
  if (t.length < min) return `${field} must not be empty`;
  if (t.length > max) return `${field} must be at most ${max} characters`;
  return null;
}

// Validate one content-edit field. Returns the trimmed value or throws the
// rejection message for the caller to return.
function cleanEditField(kind, field, value) {
  const allowed = kind === "ticket" ? TICKET_EDIT_FIELDS : SUGGESTION_EDIT_FIELDS;
  if (!allowed.includes(field)) {
    throw new Error(
      kind === "ticket"
        ? `${field} applies to suggestions only`
        : `unknown field: ${field}`
    );
  }
  if (field === "tags") {
    if (!Array.isArray(value)) throw new Error("tags must be an array of strings");
    if (value.length > LIMITS.tags) throw new Error(`tags must hold at most ${LIMITS.tags} entries`);
    const cleaned = value.map((t) => {
      const err = strError(t, "tag", 1, LIMITS.tag);
      if (err) throw new Error(err);
      return String(t).trim();
    });
    return cleaned;
  }
  const err = strError(value, field, 1, LIMITS[field]);
  if (err) throw new Error(err);
  return String(value).trim();
}

// Build the {$set, $push} update for a content edit. `existing` is the stored
// document (for its current status); `fields` holds only caller-supplied keys.
// Returns { set, historyEntry } or { error }.
function buildContentUpdate(kind, existing, fields, by, now) {
  const names = Object.keys(fields || {}).filter((k) => fields[k] !== undefined);
  if (!names.length) return { error: "supply at least one field to update" };
  let set;
  try {
    set = {};
    for (const name of names) {
      set[name] = cleanEditField(kind, name, fields[name]);
    }
  } catch (e) {
    return { error: e.message };
  }
  set.updatedAt = now;
  const entry = {
    status: existing && existing.status != null ? existing.status : "open",
    at: now,
    by: by || "agent",
    source: "mcp",
    note: `content update: ${Object.keys(set).filter((k) => k !== "updatedAt").join(", ")}`,
  };
  return { set, historyEntry: entry };
}

// Build the upsert for the tracker item behind a report. Only supplied tracker
// keys are written, so flipping a tracker status never blanks a body nobody
// read. Returns { id, update } or { error }.
function buildTrackerUpsert(kind, number, ticketTitle, args, nowMs) {
  if (!isKind(kind)) return { error: `unknown kind: ${kind}` };
  const id = trackerIdFor(kind, number);
  const set = {};
  const putStr = (key, max, cap) => {
    if (args[key] === undefined) return null;
    const err = strError(args[key], key, 1, max);
    if (err) return err;
    set[cap || key] = String(args[key]).trim();
    return null;
  };
  for (const [key, max, cap] of [
    ["title", LIMITS.title],
    ["body", LIMITS.trackerBody],
    ["project", LIMITS.project],
    ["realm", LIMITS.realm],
    ["phase", LIMITS.phase],
    ["blocked_by", LIMITS.blocked_by],
    ["updated_by", LIMITS.updated_by],
  ]) {
    const err = putStr(key, max, cap);
    if (err) return { error: err };
  }
  if (args.status !== undefined) {
    if (!TRACKER_STATUSES.includes(args.status)) {
      return { error: `unknown tracker status: ${args.status}` };
    }
    set.status = args.status;
  }
  if (args.tags !== undefined) {
    if (!Array.isArray(args.tags)) return { error: "tags must be an array of strings" };
    if (args.tags.length > LIMITS.tags) return { error: `tags must hold at most ${LIMITS.tags} entries` };
    for (const t of args.tags) {
      const err = strError(t, "tag", 1, LIMITS.tag);
      if (err) return { error: err };
    }
    set.tags = args.tags.map((t) => String(t).trim());
  }
  // The back-pointer. The title falls back to the report's own title so an
  // upsert that only flips a status still reads sensibly on the board.
  if (set.title === undefined) set.title = (ticketTitle || `${kind} #${number}`).slice(0, LIMITS.title);
  if (set.kind === undefined) set.kind = "task";
  set.fields = {
    supportKind: kind,
    supportNumber: number,
    supportTitle: (ticketTitle || "").slice(0, LIMITS.title),
  };
  set.updated_at = nowMs;
  return {
    id,
    update: {
      $set: set,
      $setOnInsert: { id, created_at: nowMs },
    },
  };
}

// Build a note document hanging off a linked tracker item. Timestamped id, so
// two notes never collide the way a title-derived slug would.
function buildTrackerNote(trackerId, body, updatedBy, project, nowMs) {
  const err = strError(body, "body", 1, LIMITS.trackerNote);
  if (err) return { error: err };
  const text = String(body).trim();
  const title = text.split("\n")[0].slice(0, 90) || "note";
  const id = `${trackerId}#note-${nowMs}`;
  const doc = {
    id,
    kind: "note",
    status: "done",
    title,
    body: text,
    parent: trackerId,
    order: nowMs,
    created_at: nowMs,
    updated_at: nowMs,
  };
  if (project) doc.project = project;
  if (updatedBy !== undefined) {
    const uErr = strError(updatedBy, "updated_by", 1, LIMITS.updated_by);
    if (uErr) return { error: uErr };
    doc.updated_by = String(updatedBy).trim();
  }
  return { id, doc };
}

// Safe subset of a tracker item for the public reporter page. No ids, no
// numbers, no internal notes: status, why it is stuck, and when it moved.
function publicTrackedView(item) {
  if (!item) return null;
  const status = String(item.status || "open").replace(/_/g, " ");
  const out = { status };
  if (item.status === "blocked" && item.blocked_by) {
    out.blockedBy = String(item.blocked_by).slice(0, LIMITS.blocked_by);
  }
  if (item.updated_at || item.updatedAt) out.updatedAt = item.updated_at || item.updatedAt;
  return out;
}

module.exports = {
  TRACKER_COLLECTION,
  TRACKER_STATUSES,
  TICKET_EDIT_FIELDS,
  SUGGESTION_EDIT_FIELDS,
  LIMITS,
  isKind,
  numberKey,
  trackerIdFor,
  buildContentUpdate,
  buildTrackerUpsert,
  buildTrackerNote,
  publicTrackedView,
};
