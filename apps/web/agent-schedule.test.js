"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ObjectId } = require("mongodb");
const {
  MIN_AHEAD_MS,
  STATUSES,
  validateSchedulePayload,
  createSchedule,
  listSchedules,
  cancelSchedule,
  claimDueSchedules,
  fireSchedule,
  processDueSchedules,
} = require("./agent-schedule");

function makeMemoryDb() {
  const docs = [];
  const collection = {
    async insertOne(doc) {
      const _id = new ObjectId();
      docs.push({ ...doc, _id });
      return { insertedId: _id };
    },
    find(query) {
      const matched = docs.filter((d) => matchQuery(d, query));
      const api = {
        sort() { return api; },
        limit(n) {
          api._limit = n;
          return api;
        },
        async toArray() {
          const out = matched.slice();
          out.sort((a, b) => {
            const aT = a.runAt?.getTime?.() || 0;
            const bT = b.runAt?.getTime?.() || 0;
            return aT - bT;
          });
          return out.slice(0, api._limit || out.length);
        },
      };
      return api;
    },
    async findOneAndUpdate(filter, update, options = {}) {
      const candidates = docs.filter((d) => matchQuery(d, filter));
      if (options.sort?.runAt) {
        candidates.sort((a, b) => (a.runAt?.getTime?.() || 0) - (b.runAt?.getTime?.() || 0));
      }
      const doc = candidates[0];
      if (!doc) return { value: null };
      applyUpdate(doc, update);
      return { value: { ...doc } };
    },
    async updateOne(filter, update) {
      const doc = docs.find((d) => matchQuery(d, filter));
      if (!doc) return { matchedCount: 0 };
      applyUpdate(doc, update);
      return { matchedCount: 1 };
    },
    _docs: docs,
  };
  return { collection() { return collection; }, _docs: docs };
}

function matchQuery(doc, query) {
  if (!query || typeof query !== "object") return true;
  if (query.$or) return query.$or.some((q) => matchQuery(doc, q));
  for (const [key, expected] of Object.entries(query)) {
    const actual = doc[key];
    if (expected && typeof expected === "object" && !(expected instanceof Date) && !(expected instanceof ObjectId)) {
      if (expected.$lte != null) {
        const left = actual instanceof Date ? actual.getTime() : actual;
        const right = expected.$lte instanceof Date ? expected.$lte.getTime() : expected.$lte;
        if (!(left <= right)) return false;
        continue;
      }
      if (expected.$gte != null) {
        const left = actual instanceof Date ? actual.getTime() : actual;
        const right = expected.$gte instanceof Date ? expected.$gte.getTime() : expected.$gte;
        if (!(left >= right)) return false;
        continue;
      }
      if (expected.$in) {
        if (!expected.$in.includes(actual)) return false;
        continue;
      }
    }
    if (expected instanceof ObjectId) {
      if (!actual || String(actual) !== String(expected)) return false;
      continue;
    }
    if (actual !== expected) return false;
  }
  return true;
}

function applyUpdate(doc, update) {
  if (update.$set) Object.assign(doc, update.$set);
}

function futureRunAt(ms = MIN_AHEAD_MS + 60_000) {
  return new Date(Date.now() + ms);
}

test("validateSchedulePayload rejects past runAt", () => {
  assert.throws(
    () => validateSchedulePayload({
      provider: "claude",
      prompt: "do the thing",
      runAt: new Date(Date.now() - 1000),
      cwd: "/root",
    }),
    /at least|future/i
  );
});

test("validateSchedulePayload rejects empty prompt", () => {
  assert.throws(
    () => validateSchedulePayload({
      provider: "claude",
      prompt: "   ",
      runAt: futureRunAt(),
      cwd: "/root",
    }),
    /Prompt is required/
  );
});

test("validateSchedulePayload accepts a valid one-shot job", () => {
  const v = validateSchedulePayload({
    provider: "claude",
    permissionMode: "ask",
    prompt: "Investigate auth",
    runAt: futureRunAt(),
    cwd: "/root",
    title: "Auth probe",
  });
  assert.equal(v.provider, "claude");
  assert.equal(v.permissionMode, "ask");
  assert.equal(v.prompt, "Investigate auth");
  assert.equal(v.title, "Auth probe");
  assert.ok(v.runAt instanceof Date);
});

test("createSchedule / listSchedules / cancelSchedule round-trip", async () => {
  const db = makeMemoryDb();
  const created = await createSchedule(db, {
    provider: "cursor",
    permissionMode: "ask",
    prompt: "Fix the flaky test",
    runAt: futureRunAt(),
    cwd: "/root",
    title: "Flaky",
  });
  assert.equal(created.status, STATUSES.pending);
  assert.ok(created.id);

  const listed = await listSchedules(db);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, created.id);

  const cancelled = await cancelSchedule(db, created.id);
  assert.equal(cancelled.status, STATUSES.cancelled);

  await assert.rejects(() => cancelSchedule(db, created.id), /not cancellable|not found/i);
});

test("claimDueSchedules atomically moves pending → running", async () => {
  const db = makeMemoryDb();
  const due = new Date(Date.now() - 1000);
  const later = futureRunAt(120_000);
  await createSchedule(db, {
    provider: "claude",
    prompt: "due now",
    runAt: futureRunAt(),
    cwd: "/root",
  });
  // Force first job due by rewriting runAt after insert.
  db._docs[0].runAt = due;
  await createSchedule(db, {
    provider: "claude",
    prompt: "later",
    runAt: later,
    cwd: "/root",
  });

  const claimed = await claimDueSchedules(db, { now: new Date(), limit: 5 });
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].status, STATUSES.running);
  assert.equal(claimed[0].prompt, "due now");

  const again = await claimDueSchedules(db, { now: new Date(), limit: 5 });
  assert.equal(again.length, 0);
});

test("fireSchedule marks fired on success and failed on spawn error", async () => {
  const db = makeMemoryDb();
  await createSchedule(db, {
    provider: "claude",
    prompt: "ship it",
    runAt: futureRunAt(),
    cwd: "/root",
    title: "Ship",
  });
  db._docs[0].runAt = new Date(Date.now() - 1);
  const [job] = await claimDueSchedules(db);

  const titles = [];
  const ok = await fireSchedule(db, job, {
    async spawnTmuxAgent() {
      return { name: "claude", kind: "claude" };
    },
    async seedAgentPrompt(name, text) {
      assert.equal(name, "claude");
      assert.equal(text, "ship it");
      return { ok: true };
    },
    setAgentTitle(sessionId, title) {
      titles.push({ sessionId, title });
      return { sessionId, title };
    },
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.name, "claude");
  assert.equal(db._docs[0].status, STATUSES.fired);
  assert.deepEqual(titles, [{ sessionId: "tmux:claude", title: "Ship" }]);

  await createSchedule(db, {
    provider: "codex",
    prompt: "boom",
    runAt: futureRunAt(),
    cwd: "/root",
  });
  db._docs[1].runAt = new Date(Date.now() - 1);
  const [bad] = await claimDueSchedules(db);
  const fail = await fireSchedule(db, bad, {
    async spawnTmuxAgent() { throw new Error("binary missing"); },
    async seedAgentPrompt() { throw new Error("should not seed"); },
    setAgentTitle() {},
  });
  assert.equal(fail.ok, false);
  assert.match(fail.error, /binary missing/);
  assert.equal(db._docs[1].status, STATUSES.failed);
});

test("processDueSchedules claims and fires in one pass", async () => {
  const db = makeMemoryDb();
  await createSchedule(db, {
    provider: "kimi",
    prompt: "batch",
    runAt: futureRunAt(),
    cwd: "/root",
  });
  db._docs[0].runAt = new Date(Date.now() - 5);
  const results = await processDueSchedules(db, {
    async spawnTmuxAgent(provider) {
      return { name: provider, kind: provider };
    },
    async seedAgentPrompt() { return { ok: true }; },
    setAgentTitle() {},
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, true);
  assert.equal(db._docs[0].status, STATUSES.fired);
});
