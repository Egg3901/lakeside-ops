// Unit tests for atomic repair-launch claims (no DB, no I/O).
// Run: node --test ticket-repair-claim.test.js
const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { ObjectId } = require("mongodb");
const {
  STALE_LAUNCHING_MS,
  isLiveFixSession,
  claimRepairLaunch,
  completeRepairClaim,
  failRepairClaim,
} = require("./ticket-repair-claim");

// Minimal fake supporting exactly the operators the claim module uses:
// _id equality (ObjectId-aware), $or, $exists, null-matches-missing, $set, $unset.
function eq(a, b) {
  if (a && typeof a.equals === "function") return a.equals(b);
  if (b && typeof b.equals === "function") return b.equals(a);
  return a === b;
}
function matches(doc, filter) {
  for (const [k, cond] of Object.entries(filter)) {
    if (k === "$or") {
      if (!cond.some((c) => matches(doc, c))) return false;
      continue;
    }
    const v = doc[k];
    if (cond && typeof cond === "object" && !(cond instanceof ObjectId) && !Array.isArray(cond)) {
      if ("$exists" in cond) {
        const exists = v !== undefined;
        if (!!cond.$exists !== exists) return false;
        continue;
      }
    }
    if (cond === null) {
      if (v !== null && v !== undefined) return false;
      continue;
    }
    if (!eq(v, cond)) return false;
  }
  return true;
}
function makeDb() {
  const store = { tickets: new Map(), fix_sessions: new Map() };
  const api = (name) => ({
    async findOne(filter) {
      for (const d of store[name].values()) if (matches(d, filter)) return { ...d };
      return null;
    },
    async insertOne(doc) {
      const d = { ...doc };
      if (!d._id) d._id = new ObjectId();
      if (store[name].has(String(d._id))) { const e = new Error("duplicate key"); e.code = 11000; throw e; }
      store[name].set(String(d._id), d);
      return { insertedId: d._id };
    },
    async updateOne(filter, update) {
      for (const [k, d] of store[name]) {
        if (!matches(d, filter)) continue;
        if (update.$set) Object.assign(d, update.$set);
        if (update.$unset) for (const f of Object.keys(update.$unset)) delete d[f];
        store[name].set(k, d);
        return { matchedCount: 1, modifiedCount: 1 };
      }
      return { matchedCount: 0, modifiedCount: 0 };
    },
  });
  return { collection: api, _store: store };
}

const NOW = Date.now();
const TICKET_ID = new ObjectId();

describe("isLiveFixSession", () => {
  it("running/launched are live, failed is not", () => {
    assert.equal(isLiveFixSession({ status: "running" }, NOW), true);
    assert.equal(isLiveFixSession({ status: "launched" }, NOW), true);
    assert.equal(isLiveFixSession({ status: "failed" }, NOW), false);
    assert.equal(isLiveFixSession(null, NOW), false);
    assert.equal(isLiveFixSession({ status: "launching", launchedAt: new Date(NOW - 60_000) }, NOW), true);
  });
  it("stale launching claims expire, dateless ones stay live", () => {
    assert.equal(isLiveFixSession({ status: "launching", launchedAt: new Date(NOW - STALE_LAUNCHING_MS - 1000) }, NOW), false);
    assert.equal(isLiveFixSession({ status: "launching" }, NOW), true);
  });
});

describe("claimRepairLaunch", () => {
  let db;
  beforeEach(() => {
    db = makeDb();
    db._store.tickets.set(String(TICKET_ID), { _id: TICKET_ID, ticketNumber: 99, status: "open" });
  });
  const claim = (over = {}) => claimRepairLaunch(db, {
    collName: "tickets", itemId: TICKET_ID, targetType: "ticket",
    displayNumber: 99, launchedBy: "test", now: NOW, ...over,
  });

  it("claims a clean ticket and links it before any slow work", async () => {
    const r = await claim();
    assert.equal(r.status, "claimed");
    const ticket = await db.collection("tickets").findOne({ _id: TICKET_ID });
    assert.ok(ticket.fixSessionId instanceof ObjectId, "link stored as ObjectId");
    assert.equal(String(ticket.fixSessionId), r.fixSessionId);
    const doc = await db.collection("fix_sessions").findOne({ _id: ticket.fixSessionId });
    assert.equal(doc.status, "launching");
    assert.equal(doc.launchedBy, "test");
    assert.equal(doc.ticketNumber, 99);
  });

  it("second concurrent claim returns the winner without spawning", async () => {
    const first = await claim();
    assert.equal(first.status, "claimed");
    const second = await claim();
    assert.equal(second.status, "existing");
    assert.equal(second.fixSessionId, first.fixSessionId);
    assert.equal(db._store.fix_sessions.size, 1, "loser inserts no doc");
  });

  it("returns a running session without new docs", async () => {
    const first = await claim();
    await completeRepairClaim(db, first.fixSessionId, { status: "running", codeSessionId: "cs_1" });
    const second = await claim();
    assert.equal(second.status, "existing");
    assert.equal(second.session.codeSessionId, "cs_1");
    assert.equal(db._store.fix_sessions.size, 1);
  });

  it("reclaims a stale launching claim and supersedes it", async () => {
    const first = await claim();
    const old = await db.collection("fix_sessions").findOne({ _id: new ObjectId(first.fixSessionId) });
    old.launchedAt = new Date(NOW - STALE_LAUNCHING_MS - 1000);
    db._store.fix_sessions.set(String(old._id), old);
    const second = await claim();
    assert.equal(second.status, "claimed");
    assert.notEqual(second.fixSessionId, first.fixSessionId);
    const prev = await db.collection("fix_sessions").findOne({ _id: new ObjectId(first.fixSessionId) });
    assert.equal(prev.status, "superseded");
  });

  it("reclaims dangling and failed links", async () => {
    await db.collection("tickets").updateOne({ _id: TICKET_ID }, { $set: { fixSessionId: new ObjectId() } });
    const r1 = await claim();
    assert.equal(r1.status, "claimed");
    await failRepairClaim(db, { collName: "tickets", itemId: TICKET_ID, fixSessionId: r1.fixSessionId, error: "boom" });
    const r2 = await claim();
    assert.equal(r2.status, "claimed");
    assert.notEqual(r2.fixSessionId, r1.fixSessionId);
  });

  it("resolves string-hex links (worker stores strings, endpoint stores ObjectIds)", async () => {
    const first = await claim();
    await db.collection("tickets").updateOne({ _id: TICKET_ID }, { $set: { fixSessionId: first.fixSessionId } });
    const second = await claim();
    assert.equal(second.status, "existing");
    assert.equal(second.fixSessionId, first.fixSessionId);
  });
});

describe("failRepairClaim", () => {
  it("marks failed and releases our link, keeps a newer link", async () => {
    const db = makeDb();
    const id = new ObjectId();
    db._store.tickets.set(String(id), { _id: id });
    const c = await claimRepairLaunch(db, { collName: "tickets", itemId: id, targetType: "ticket", displayNumber: 1, now: NOW });
    await failRepairClaim(db, { collName: "tickets", itemId: id, fixSessionId: c.fixSessionId, error: new Error("spawn blew up") });
    const doc = await db.collection("fix_sessions").findOne({ _id: new ObjectId(c.fixSessionId) });
    assert.equal(doc.status, "failed");
    assert.match(doc.error, /spawn blew up/);
    const t = await db.collection("tickets").findOne({ _id: id });
    assert.ok(!("fixSessionId" in t), "our link released");

    // Relinked elsewhere since: must not clobber.
    const other = new ObjectId();
    await db.collection("tickets").updateOne({ _id: id }, { $set: { fixSessionId: other } });
    await failRepairClaim(db, { collName: "tickets", itemId: id, fixSessionId: c.fixSessionId, error: "late" });
    const t2 = await db.collection("tickets").findOne({ _id: id });
    assert.ok(t2.fixSessionId.equals(other), "newer link preserved");
  });
});
