"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createEffectRecovery, SETTLE_MS } = require("../lib/operator/effectrecovery");
const HEAD = "d9bbd7f1a2bc0eecf6f03e3e9893ef71976942e3";
const NOW = 10 * SETTLE_MS;

function world(job, prs, running = () => false) {
  const audits = [];
  const ledger = { data: { jobs: { [job.id]: job } }, audit: (k, v) => audits.push([k, v]), save() {} };
  const api = async (endpoint) => { const pr = prs[endpoint]; if (!pr) throw new Error("404"); return pr; };
  return { r: createEffectRecovery({ ledger, api, now: () => NOW, running }), audits };
}
const key = `merge:4281:${HEAD}`;

test("a merge GitHub completed settles as done and the held task resumes", async () => {
  const job = { id: "j", state: "blocked", effects: { [key]: { state: "started", at: 0, error: "gh: Merge already in progress (HTTP 405)" } } };
  const w = world(job, { "repos/lakesidegamedev/AHDGame/pulls/4281": { merged: true, state: "closed", head: { sha: HEAD }, merge_commit_sha: "abc" } });
  await w.r.tick();
  assert.equal(job.effects[key].state, "done");
  assert.equal(job.effects[key].result.reconciled, true);
  assert.equal(job.state, "queued");
  assert.match(job.inbox.at(-1).content, /do not repeat a merge/);
  assert.equal(w.audits[0][1].outcome, "merged");
});

test("an open PR at the same head was not merged and may be retried", async () => {
  const job = { id: "j", state: "waiting", effects: { [key]: { state: "started", at: 0 } } };
  const w = world(job, { "repos/lakesidegamedev/AHDGame/pulls/4281": { merged: false, state: "open", head: { sha: HEAD } } });
  await w.r.tick();
  assert.equal(job.effects[key].state, "rejected");
  assert.equal(job.state, "waiting");
});

test("a moved head, a fresh write or a running task stays held", async () => {
  const moved = { id: "j", state: "blocked", effects: { [key]: { state: "started", at: 0 } } };
  await world(moved, { "repos/lakesidegamedev/AHDGame/pulls/4281": { merged: true, head: { sha: "f".repeat(40) } } }).r.tick();
  assert.equal(moved.effects[key].state, "started"); assert.equal(moved.state, "blocked");
  const fresh = { id: "j", state: "blocked", effects: { [key]: { state: "started", at: NOW - 1000 } } };
  await world(fresh, { "repos/lakesidegamedev/AHDGame/pulls/4281": { merged: true, head: { sha: HEAD } } }).r.tick();
  assert.equal(fresh.effects[key].state, "started");
  const live = { id: "j", state: "running", effects: { [key]: { state: "started", at: 0 } } };
  await world(live, { "repos/lakesidegamedev/AHDGame/pulls/4281": { merged: true, head: { sha: HEAD } } }, () => true).r.tick();
  assert.equal(live.effects[key].state, "started");
});

test("non-merge uncertain writes are never touched", async () => {
  const job = { id: "j", state: "blocked", effects: { "ticket-update:x": { state: "started", at: 0 } } };
  await world(job, {}).r.tick();
  assert.equal(job.effects["ticket-update:x"].state, "started"); assert.equal(job.state, "blocked");
});

test("the right repository is found by the PR's exact head", async () => {
  const job = { id: "j", state: "blocked", effects: { [key]: { state: "started", at: 0 } } };
  const w = world(job, { "repos/lakesidegamedev/AHDGame/pulls/4281": { merged: false, state: "open", head: { sha: "e".repeat(40) } },
    "repos/lakesidegamedev/AHDClient/pulls/4281": { merged: true, head: { sha: HEAD }, merge_commit_sha: "c" } });
  await w.r.tick();
  assert.equal(job.effects[key].state, "done");
});
