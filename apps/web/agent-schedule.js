// One-shot delayed live-agent schedules for /code.
// Durable in Mongo (`scheduled_live_agents`); the dash claims due jobs and
// fires them via spawnTmuxAgent + seedAgentPrompt.

"use strict";

const fs = require("fs");
const path = require("path");
const { ObjectId } = require("mongodb");
const {
  SPAWN_BINARIES,
  defaultPermissionMode,
  resolvePermissionMode,
  resolveSpawnModel,
  OPENCODE_MODEL_PROVIDERS,
} = require("./tmux-sessions");

const COLLECTION = "scheduled_live_agents";
const MIN_AHEAD_MS = 30_000;
const MAX_PROMPT_CHARS = 60_000;
const RECENT_MS = 24 * 60 * 60 * 1000;
const STATUSES = Object.freeze({
  pending: "pending",
  running: "running",
  fired: "fired",
  failed: "failed",
  cancelled: "cancelled",
});

function col(db) {
  return db.collection(COLLECTION);
}

function publicDoc(doc) {
  if (!doc) return null;
  return {
    id: String(doc._id),
    provider: doc.provider,
    permissionMode: doc.permissionMode,
    model: doc.model || null,
    cwd: doc.cwd,
    title: doc.title || null,
    prompt: doc.prompt,
    runAt: doc.runAt instanceof Date ? doc.runAt.toISOString() : doc.runAt,
    status: doc.status,
    createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : doc.createdAt,
    updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : doc.updatedAt,
    claimedAt: doc.claimedAt
      ? (doc.claimedAt instanceof Date ? doc.claimedAt.toISOString() : doc.claimedAt)
      : null,
    result: doc.result || null,
  };
}

function validateCwd(cwd) {
  const dir = path.resolve(String(cwd || "/root"));
  if (!dir.startsWith("/root")) throw new Error("Working directory must be under /root");
  let stat;
  try { stat = fs.statSync(dir); } catch { throw new Error(`Directory not found: ${dir}`); }
  if (!stat.isDirectory()) throw new Error(`Not a directory: ${dir}`);
  return dir;
}

function validateSchedulePayload(payload = {}, { requireFutureRunAt = true } = {}) {
  const provider = String(payload.provider || "").trim();
  if (!SPAWN_BINARIES[provider]) {
    throw new Error("Unsupported provider — choose claude, codex, kimi, cursor, opencode or ollama");
  }
  const permissionMode = String(
    payload.permissionMode || defaultPermissionMode(provider)
  ).trim();
  const resolved = resolvePermissionMode(provider, permissionMode);
  if (!resolved) throw new Error("Unsupported permission mode");

  const model = OPENCODE_MODEL_PROVIDERS[provider]
    ? resolveSpawnModel(provider, payload.model)
    : null;

  const cwd = validateCwd(payload.cwd);
  const prompt = String(payload.prompt || "").trim();
  if (!prompt) throw new Error("Prompt is required for scheduled agents");
  if (prompt.length > MAX_PROMPT_CHARS) {
    throw new Error(`Prompt exceeds ${MAX_PROMPT_CHARS} characters`);
  }

  const titleRaw = payload.title == null ? "" : String(payload.title).trim();
  const title = titleRaw ? titleRaw.slice(0, 80) : null;

  let runAt = null;
  if (payload.runAt != null && payload.runAt !== "") {
    runAt = payload.runAt instanceof Date ? payload.runAt : new Date(String(payload.runAt));
    if (Number.isNaN(runAt.getTime())) throw new Error("Invalid runAt datetime");
  }
  if (requireFutureRunAt) {
    if (!runAt) throw new Error("runAt is required");
    const ahead = runAt.getTime() - Date.now();
    if (ahead < MIN_AHEAD_MS) {
      throw new Error(`runAt must be at least ${MIN_AHEAD_MS / 1000}s in the future`);
    }
  }

  return {
    provider,
    permissionMode: resolved.id,
    model,
    cwd,
    title,
    prompt,
    runAt,
  };
}

async function createSchedule(db, payload) {
  const validated = validateSchedulePayload(payload, { requireFutureRunAt: true });
  const now = new Date();
  const doc = {
    ...validated,
    status: STATUSES.pending,
    createdAt: now,
    updatedAt: now,
    claimedAt: null,
    result: null,
  };
  const inserted = await col(db).insertOne(doc);
  return publicDoc({ ...doc, _id: inserted.insertedId });
}

async function listSchedules(db, { now = new Date() } = {}) {
  const since = new Date(now.getTime() - RECENT_MS);
  const rows = await col(db)
    .find({
      $or: [
        { status: STATUSES.pending },
        { status: STATUSES.running },
        {
          status: { $in: [STATUSES.fired, STATUSES.failed, STATUSES.cancelled] },
          updatedAt: { $gte: since },
        },
      ],
    })
    .sort({ runAt: 1, createdAt: 1 })
    .limit(100)
    .toArray();
  return rows.map(publicDoc);
}

async function cancelSchedule(db, id) {
  let _id;
  try { _id = new ObjectId(String(id)); } catch { throw new Error("Invalid schedule id"); }
  const result = await col(db).findOneAndUpdate(
    { _id, status: STATUSES.pending },
    { $set: { status: STATUSES.cancelled, updatedAt: new Date() } },
    { returnDocument: "after" }
  );
  const doc = result?.value ?? result;
  if (!doc || !doc._id) throw new Error("Schedule not found or not cancellable");
  return publicDoc(doc);
}

/**
 * Atomically claim the next due pending job (pending → running).
 * Returns the claimed doc or null.
 */
async function claimNextDueSchedule(db, { now = new Date() } = {}) {
  const claimedAt = now instanceof Date ? now : new Date(now);
  const result = await col(db).findOneAndUpdate(
    { status: STATUSES.pending, runAt: { $lte: claimedAt } },
    {
      $set: {
        status: STATUSES.running,
        claimedAt,
        updatedAt: claimedAt,
      },
    },
    { sort: { runAt: 1 }, returnDocument: "after" }
  );
  const doc = result?.value ?? result;
  if (!doc || !doc._id) return null;
  return doc;
}

async function claimDueSchedules(db, { now = new Date(), limit = 5 } = {}) {
  const claimed = [];
  for (let i = 0; i < limit; i += 1) {
    const job = await claimNextDueSchedule(db, { now });
    if (!job) break;
    claimed.push(job);
  }
  return claimed;
}

async function markFired(db, id, resultPayload) {
  await col(db).updateOne(
    { _id: id },
    {
      $set: {
        status: STATUSES.fired,
        updatedAt: new Date(),
        result: resultPayload,
      },
    }
  );
}

async function markFailed(db, id, error) {
  await col(db).updateOne(
    { _id: id },
    {
      $set: {
        status: STATUSES.failed,
        updatedAt: new Date(),
        result: { error: String(error?.message || error || "Unknown error") },
      },
    }
  );
}

/**
 * Fire a claimed (running) job: spawn → optional title → seed prompt.
 * `deps` injects spawn helpers for tests.
 */
async function fireSchedule(db, job, deps = {}) {
  const spawnTmuxAgent = deps.spawnTmuxAgent
    || require("./tmux-sessions").spawnTmuxAgent;
  const seedAgentPrompt = deps.seedAgentPrompt
    || require("./tmux-sessions").seedAgentPrompt;
  const setAgentTitle = deps.setAgentTitle
    || require("./tmux-sessions").setAgentTitle;

  let spawned = null;
  try {
    spawned = await spawnTmuxAgent(
      job.provider,
      job.cwd,
      job.permissionMode,
      job.model
    );
    if (job.title) {
      try {
        setAgentTitle(`tmux:${spawned.name}`, job.title);
      } catch { /* title is best-effort */ }
    }
    let seedOk = true;
    let seedError = null;
    try {
      const seed = await seedAgentPrompt(spawned.name, job.prompt);
      seedOk = !!(seed && seed.ok !== false);
    } catch (seedErr) {
      seedOk = false;
      seedError = String(seedErr?.message || seedErr || "seed failed");
    }
    const result = {
      name: spawned.name,
      kind: spawned.kind,
      seedOk,
      ...(seedError ? { seedError } : {}),
    };
    await markFired(db, job._id, result);
    return { ok: true, ...result, id: String(job._id) };
  } catch (err) {
    await markFailed(db, job._id, err);
    return {
      ok: false,
      error: String(err.message || err),
      id: String(job._id),
      name: spawned?.name || null,
    };
  }
}

async function processDueSchedules(db, deps = {}, options = {}) {
  const jobs = await claimDueSchedules(db, options);
  const results = [];
  for (const job of jobs) {
    results.push(await fireSchedule(db, job, deps));
  }
  return results;
}

module.exports = {
  COLLECTION,
  MIN_AHEAD_MS,
  MAX_PROMPT_CHARS,
  STATUSES,
  publicDoc,
  validateCwd,
  validateSchedulePayload,
  createSchedule,
  listSchedules,
  cancelSchedule,
  claimNextDueSchedule,
  claimDueSchedules,
  fireSchedule,
  processDueSchedules,
  markFired,
  markFailed,
};
