"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { createCiWatch, MAX_WATCH_MS } = require("../lib/operator/ciwatch");

function setup(runs, pr = { merged: false, state: "open", head: { sha: "s1" } }) {
  const data = { jobs: { j1: { id: "j1", state: "waiting", ciWatch: { 42: { since: 1000 } } } }, audit: [] };
  const ledger = { data, save() {}, audit(kind, x) { data.audit.push({ kind, ...x }); } };
  let clock = 2000;
  const api = async (args) => args[0].includes("check-runs") ? { check_runs: runs() } : pr;
  return { data, watch: createCiWatch({ ledger, api, now: () => clock }), tick: (ms) => { clock += ms; } };
}

test("a watched PR wakes its task only when every check has finished", async () => {
  let runs = [{ name: "verify", status: "in_progress" }];
  const t = setup(() => runs);
  await t.watch.tick();
  assert.equal(t.data.jobs.j1.state, "waiting");
  runs = [{ name: "verify", status: "completed", conclusion: "success" }, { name: "lint", status: "completed", conclusion: "success" }];
  await t.watch.tick();
  assert.equal(t.data.jobs.j1.state, "queued");
  assert.match(t.data.jobs.j1.inbox[0].content, /all 2 checks green/);
  assert.equal(t.data.jobs.j1.ciWatch, undefined);
});

test("red checks are named, and a stuck watch gives up after three hours", async () => {
  const red = setup(() => [{ name: "verify", status: "completed", conclusion: "failure" }]);
  await red.watch.tick();
  assert.match(red.data.jobs.j1.inbox[0].content, /failed \(verify\)/);
  const stuck = setup(() => [{ name: "verify", status: "queued" }]);
  stuck.tick(MAX_WATCH_MS);
  await stuck.watch.tick();
  assert.match(stuck.data.jobs.j1.inbox[0].content, /still running after 3 hours/);
});

test("desktop watches poll the recorded repository rather than an unrelated game PR", async () => {
  const data = { jobs: { j: { id: "j", state: "waiting", ciWatch: { 12: { since: 1000, repository: "lakesidegamedev/AHDClient" } } } } };
  const calls = [], ledger = { data, save() {}, audit() {} };
  const w = createCiWatch({ ledger, api: async args => { calls.push(args[0]);return args[0].includes("check-runs") ? { check_runs: [{ name: "verify", status: "completed", conclusion: "success" }] } : { state: "open", head: { sha: "desktop" } }; }, now: () => 2000 });
  await w.tick();assert.equal(data.jobs.j.state, "queued");assert.ok(calls.every(p => p.startsWith("repos/lakesidegamedev/AHDClient/")));
});

test("long CI waits produce a status callback while normal short waits stay quiet", async () => {
  let clock = 2000; const calls = [];
  const data = { jobs: { j: { id: "j", state: "waiting", ciWatch: { 12: { since: 1000 } } } } };
  const ledger = { data, save() {}, audit() {} };
  const w = createCiWatch({ ledger, api: async args => args[0].includes("check-runs") ? { check_runs: [{ name: "test", status: "queued" }] } : { state: "open", head: { sha: "abc" } }, now: () => clock, onWaiting: async (job, info) => calls.push({ id: job.id, ...info }) });
  await w.tick();assert.equal(calls.length, 0);
  clock = 11 * 60000;await w.tick();assert.equal(calls.length, 1);assert.equal(calls[0].queued, 1);assert.equal(data.jobs.j.state, "waiting");
});

// Review 2026-10-13: ticket 1514 sat behind a watch on a PR number in the
// wrong repository; every read failed and the watch never ended.
test("a watch that cannot read its PR ends after repeated failures and wakes the task", async () => {
  const data = { jobs: { j1: { id: "j1", state: "waiting", ciWatch: { 4046: { since: 1000, repository: "lakesidegamedev/AHDClient" } } } }, audit: [] };
  const ledger = { data, save() {}, audit(kind, x) { data.audit.push({ kind, ...x }); } };
  const { MAX_WATCH_ERRORS } = require("../lib/operator/ciwatch");
  const w = createCiWatch({ ledger, api: async () => { throw new Error("HTTP 404"); }, now: () => 2000 });
  for (let i = 1; i < MAX_WATCH_ERRORS; i++) { await w.tick(); assert.equal(data.jobs.j1.state, "waiting"); }
  await w.tick();
  assert.equal(data.jobs.j1.state, "queued");
  assert.match(data.jobs.j1.inbox[0].content, /could not read the PR 5 times.*repository/);
  assert.equal(data.jobs.j1.ciWatch, undefined);
});

test("shared PR watches perform one GitHub read pair per tick and wake every subscriber", async () => {
  const jobs = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`j${i}`, { id: `j${i}`, state: "waiting", ciWatch: { 42: { since: 1000 } } }]));
  let reads = 0;
  const watch = createCiWatch({ ledger: { data: { jobs }, save() {}, audit() {} }, now: () => 2000,
    api: async args => { reads++; return args[0].includes("check-runs") ? { check_runs: [{ name: "verify", status: "completed", conclusion: "success" }] } : { state: "open", head: { sha: "same-head" } }; } });
  await watch.tick();
  assert.equal(reads, 2, "poll by repository/PR rather than once per ticket");
  assert.ok(Object.values(jobs).every(j => j.state === "queued" && j.inbox.length === 1));
});

test("a failed check wakes its subscriber without waiting on unrelated checks", async () => {
  const f = setup(() => [{ name: "test", status: "completed", conclusion: "failure" }, { name: "analysis", status: "in_progress" }]);
  await f.watch.tick(); assert.equal(f.data.jobs.j1.state, "queued");
  assert.match(f.data.jobs.j1.inbox[0].content, /failed.*test/);
});

test("a proven identical staging promotion wakes without waiting on duplicate analysis", async () => {
  const f = require("./fixtures/promotion-qualification").fixture();
  const job = { id: "j", state: "waiting", ciWatch: { 42: { since: 1000 } } };
  const watch = createCiWatch({ ledger: { data: { jobs: { j: job } }, save() {}, audit() {} }, api: f.api, now: () => 2000 });
  await watch.tick(); assert.equal(job.state, "queued");
  assert.match(job.inbox[0].content, /qualification|qualified/);
});

for (const repository of ["AHDGame", "AHDClient"]) test(`legacy ${repository} watch reads the org path`, async () => {
  const calls = [], job = { id: "j", state: "waiting", ciWatch: { 12: { since: 1000, repository: `Egg3901/${repository}` } } };
  const watch = createCiWatch({ ledger: { data: { jobs: { j: job } }, save() {}, audit() {} }, now: () => 2000,
    api: async ([path]) => { calls.push(path); return { state: "closed", merged: true }; } });
  await watch.tick();
  assert.deepEqual(calls, [`repos/lakesidegamedev/${repository}/pulls/12`]);
  assert.equal(job.state, "queued");
});
