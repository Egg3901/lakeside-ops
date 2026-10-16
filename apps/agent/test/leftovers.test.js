"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { createEffectReconciler } = require("../lib/operator/effectreconcile");
const { createRecovery } = require("../lib/operator/selfrecovery");


const ledgerOf = (jobs, extra = {}) => ({ data: { jobs: Object.fromEntries(jobs.map((j) => [j.id, j])), ...extra }, audit() {}, save() {} });

test("a merge that GitHub shows merged is settled done and the task resumes", async () => {
  const job = { id: "a", ticket: 1578, state: "blocked", summary: "External action needs receipt inspection: gh: Merge already in progress (HTTP 405)", repository: "AHDGame",
    effects: { "merge:4281:d9bbd7f1a2bc0eecf6f03e3e9893ef71976942e3": { state: "started", at: 0, error: "405" } } };
  const calls = [];
  const r = createEffectReconciler({ ledger: ledgerOf([job]), now: () => 10 * 60000, readPull: async (repo, n) => { calls.push([repo, n]); return { number: n, merged: true, merged_at: "2026-10-16T05:14:39Z", merge_commit_sha: "2355a0db1a", state: "closed" }; } });
  const out = await r.tick();
  assert.deepEqual(calls, [["lakesidegamedev/AHDGame", 4281]]);
  assert.equal(out[0].merged, true);
  assert.equal(job.effects["merge:4281:d9bbd7f1a2bc0eecf6f03e3e9893ef71976942e3"].state, "done");
  assert.equal(job.state, "queued"); assert.match(job.inbox[0].content, /merged/);
});

test("an unmerged PR clears the effect for retry; a fresh or unreadable one is left alone", async () => {
  const fresh = { id: "f", state: "blocked", effects: { "merge:1:abcdef1": { state: "started", at: 9 * 60000 } } };
  const open = { id: "o", state: "blocked", summary: "External action needs receipt inspection: x", effects: { "merge:2:abcdef2": { state: "started", at: 0 } } };
  const broken = { id: "b", state: "blocked", effects: { "merge:3:abcdef3": { state: "started", at: 0 } } };
  const r = createEffectReconciler({ ledger: ledgerOf([fresh, open, broken]), now: () => 10 * 60000,
    readPull: async (repo, n) => { if (n === 3) throw new Error("gh down"); return { number: n, merged: false, state: "open" }; } });
  await r.tick();
  assert.equal(fresh.effects["merge:1:abcdef1"].state, "started");
  assert.equal(open.effects["merge:2:abcdef2"], undefined); assert.equal(open.state, "queued");
  assert.equal(broken.effects["merge:3:abcdef3"].state, "started");
});

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
