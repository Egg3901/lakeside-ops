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
