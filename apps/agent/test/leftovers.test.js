"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { createRecovery } = require("../lib/operator/selfrecovery");


const ledgerOf = (jobs, extra = {}) => ({ data: { jobs: Object.fromEntries(jobs.map((j) => [j.id, j])), ...extra }, audit() {}, save() {} });



test("a dead blocked app task is dismissed after an hour; one with a pending decision is kept", () => {
  const dead = { id: "d", kind: "conversation", state: "blocked", replyChannel: "app", source: { channelId: "app" }, updatedAt: 1, summary: "model request failed: error" };
  const kept = { id: "k", kind: "command", state: "blocked", replyChannel: "app", source: { channelId: "app" }, updatedAt: 1 };
  const ledger = ledgerOf([dead, kept], { decisions: { x: { id: "x", jobId: "k", state: "pending" } } });
  createRecovery({ ledger, now: () => 2 * 3600000 }).tick({});
  assert.equal(dead.state, "dismissed"); assert.equal(kept.state, "blocked");
});

test("discord_search is a read for owner app tasks, not a blocked mutation", () => {
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "../lib/operator/ownermuse-policy.js"), "utf8");
  assert.match(src, /const READS = new Set\(\["discord_search",/);
});

test("wait contract: legit waits stay, unknown waits are capped, woken, then asked of the owner", () => {
  let t = 10 * 3600000;
  const decided = { id: "d", kind: "ticket", ticket: 1, state: "blocked", ownerDecisionPending: true };
  const player = { id: "p", kind: "ticket", ticket: 2, state: "waiting", waitingFor: { kind: "player_reply" }, lastPublishedAt: t - 3600000, lastPlayerAt: t - 7200000, wakeAt: t + 6 * 3600000 };
  const sub = { id: "s", kind: "ticket", ticket: 3, state: "waiting", ciWatch: { x: 1 }, wakeAt: t + 3 * 3600000 };
  const unknown = { id: "u", kind: "ticket", ticket: 1578, state: "waiting", summary: "Await production release", wakeAt: t + 7 * 3600000 };
  const ledger = { data: { jobs: { d: decided, p: player, s: sub, u: unknown }, decisions: { x: { id: "x", jobId: "d", state: "pending" } }, outbox: {} }, audit() {}, save() {}, notify() {} };
  const r = createRecovery({ ledger, config: { ownerId: "owner" }, now: () => t });
  r.tick({});
  assert.equal(unknown.wakeAt, t + 45 * 60000);
  assert.equal(player.wakeAt, t + 6 * 3600000); assert.equal(sub.wakeAt, t + 3 * 3600000); assert.equal(decided.state, "blocked");
  t += 46 * 60000; r.tick({});
  assert.equal(unknown.state, "queued"); assert.match(unknown.inbox.at(-1).content, /waiting on something unknown/);
  unknown.state = "waiting"; unknown.wakeAt = t + 7 * 3600000;
  t += 46 * 60000; r.tick({});
  const asked = Object.values(ledger.data.decisions).filter((x) => x.jobId === "u");
  assert.equal(asked.length, 1); assert.match(asked[0].question, /Ticket 1578: Keir has stalled twice/);
  assert.equal(unknown.ownerDecisionPending, true);
});

test("wait contract: a player silent for 24 hours after an answer triggers an offer to resolve", () => {
  let t = 100 * 3600000;
  const j = { id: "q", kind: "ticket", ticket: 9, state: "waiting", waitingFor: { kind: "player_reply" }, lastPublishedAt: t - 25 * 3600000, lastPlayerAt: t - 30 * 3600000, wakeAt: t + 3600000 };
  const ledger = { data: { jobs: { q: j }, decisions: {} }, audit() {}, save() {}, notify() {} };
  createRecovery({ ledger, config: { ownerId: "o" }, now: () => t }).tick({});
  assert.equal(j.state, "queued"); assert.match(j.inbox.at(-1).content, /Offer to resolve/);
});

test("an uncertain non-merge action asks the owner, and the answer settles it", () => {
  let t = 10 * 3600000;
  const j = { id: "h", kind: "ticket", ticket: 77, state: "blocked", effects: { "heal:abc": { state: "started", at: t - 31 * 60000, error: "timeout" } } };
  const ledger = { data: { jobs: { h: j }, decisions: {}, outbox: {} }, audit() {}, save() {}, notify() {} };
  const r = createRecovery({ ledger, config: { ownerId: "o" }, now: () => t });
  r.tick({});
  const x = Object.values(ledger.data.decisions).find((y) => y.selfRecovery?.effect === "heal:abc");
  assert.ok(x); assert.match(x.question, /Approve if it did NOT happen/);
  r.tick({}); assert.equal(Object.values(ledger.data.decisions).filter((y) => y.selfRecovery).length, 1);
  x.state = "reject"; r.tick({});
  assert.equal(j.effects["heal:abc"].state, "done"); assert.equal(j.state, "queued"); assert.match(j.inbox.at(-1).content, /DID happen/);
});

test("a ticket held by another operator for two hours asks the owner; approve hands it back", () => {
  let t = 10 * 3600000; const handed = [];
  const j = { id: "x", kind: "ticket", ticket: 1558, state: "queued", updatedAt: t - 3 * 3600000 };
  const ledger = { data: { jobs: { x: j }, decisions: {}, outbox: {} }, audit() {}, save() {}, notify() {} };
  const r = createRecovery({ ledger, config: { ownerId: "o" }, now: () => t });
  const ctx = { supportDeferred: (job) => job.ticket === 1558, setTicketOwner: (n, o) => handed.push([n, o]) };
  r.tick({}, ctx); t += 2 * 3600000 + 1; r.tick({}, ctx);
  const x = Object.values(ledger.data.decisions).find((y) => y.selfRecovery?.kind === "handback");
  assert.ok(x); assert.match(x.question, /Ticket 1558 has been held by another operator/);
  x.state = "approve"; r.tick({}, ctx);
  assert.deepEqual(handed, [[1558, "keir"]]);
});

test("a player silent for 6 hours triggers a find-it-yourself nudge before the 24 hour resolve offer", () => {
  let t = 100 * 3600000;
  const j = { id: "q", kind: "ticket", ticket: 1579, state: "waiting", waitingFor: { kind: "player_reply" }, lastPublishedAt: t - 7 * 3600000, lastPlayerAt: t - 8 * 3600000, wakeAt: t + 3600000 };
  const ledger = { data: { jobs: { q: j }, decisions: {} }, audit() {}, save() {}, notify() {} };
  createRecovery({ ledger, config: { ownerId: "o" }, now: () => t }).tick({});
  assert.equal(j.state, "queued"); assert.match(j.inbox.at(-1).content, /find it now/);
});
