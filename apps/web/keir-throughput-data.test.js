"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { buildThroughput } = require("./keir-throughput-data");
const NOW = Date.parse("2026-10-14T19:00:00Z"), HOUR = 3600000;
const job = (id, extra = {}) => ({ id, kind: "ticket", ticket: 1500 + Number(id.replace(/\D/g, "") || 1), state: "waiting", at: NOW - HOUR, updatedAt: NOW - 600000, ...extra });

test("root ticket counts exclude coding children, historic tasks and probes", () => {
  const jobs = Object.fromEntries(Array.from({ length: 4 }, (_, i) => ["r" + i, job("r" + i)]));
  for (let i = 0; i < 16; i++) jobs["c" + i] = job("c" + i, { kind: "coding", codingParent: "r" + (i % 4), ticket: null, state: i === 0 ? "running" : i < 5 ? "queued" : "done", investigation: i % 2 === 0 });
  jobs.old = job("old", { state: "done" }); jobs.probe = job("probe", { internalProbe: true, state: "running" });
  jobs.probeChild = job("probeChild", { codingParent: "probe", kind: "coding", state: "running" });
  const s = buildThroughput({ jobs }, [], { now: NOW, supportTickets: [{ number: 1500, status: "resolved" }, { number: 1501, status: "open" }] });
  assert.equal(s.counts.ticketRoots, 4); assert.equal(s.counts.rootJobs, 4); assert.equal(s.counts.childJobs, 5); assert.equal(s.counts.executing, 1);
  assert.equal(s.counts.actionableTicketRoots, 3); assert.equal(s.counts.monitoringTicketRoots, 1);
  assert.equal(s.supportSample.count, 2); assert.match(s.supportSample.label, /not the whole/);
  const r0 = s.work.find((r) => r.id === "r0"); assert.equal(r0.category, "executing"); assert.equal(r0.children, 2);
  assert.ok(!s.work.some((r) => /probe/.test(r.id)));
});

test("structured CI, owner, dependency and turn waits differ from queue and execution", () => {
  const jobs = { ci: job("ci", { ciWatch: { 12: { since: NOW - 1800000, repository: "Egg3901/AHDGame" } } }), owner: job("owner"), dependency: job("dependency"), child: job("child", { kind: "coding", codingParent: "dependency", state: "queued" }), turn: job("turn", { turnWatch: { at: NOW - 600000 } }), queue: job("queue", { state: "queued" }), running: job("running", { state: "running", startedAt: NOW - 300000 }) };
  const s = buildThroughput({ jobs, decisions: { d: { jobId: "owner", state: "pending", at: NOW - HOUR } } }, [], { now: NOW });
  assert.deepEqual([s.counts.ci, s.counts.owner, s.counts.dependency, s.counts.turn, s.counts.executing, s.counts.queued], [1, 1, 1, 1, 1, 2]);
  assert.equal(s.work.find((r) => r.id === "ci").ageMs, 1800000);
  assert.equal(s.work.find((r) => r.id === "ci").prs[0].url, "https://github.com/Egg3901/AHDGame/pull/12");
  assert.equal(s.work.find((r) => r.id === "dependency").waitSince, null);
  assert.equal(s.work.find((r) => r.id === "queue").ageBasis, "last-job-update");
  assert.equal(s.work.find((r) => r.id === "running").ageMs, null);
  assert.equal(s.longestStalls[0].id, "owner");
});

test("exhaustion is counted once per activation, grouped to root and measured separately from waits", () => {
  const jobs = { r1: job("r1"), c1: job("c1", { kind: "coding", codingParent: "r1", exhaustedActivations: 7, history: [{ kind: "turn-limit", at: NOW - 60000 }] }) };
  const usage = [{ job: "c1", at: NOW - 60000, durationMs: 60000, outcome: "error_max_turns" }, { job: "c1", at: NOW - 30000, durationMs: 15000, outcome: "ok" }, { job: "c1", at: NOW - HOUR, durationMs: 90000, outcome: "error_max_turns" }, { job: "r1", at: NOW - 7 * HOUR, durationMs: 50000, outcome: "error_max_turns" }, { job: "unknown", at: NOW - 120000, durationMs: 30000, outcome: "timeout" }];
  const s = buildThroughput({ jobs }, usage, { now: NOW });
  assert.equal(s.cost.exhausted, 2, "a nearby successful activation does not become exhausted"); assert.equal(s.cost.activations, 4); assert.equal(s.cost.modelMs, 195000);
  assert.equal(s.cost.unattributedModelMs, 30000); assert.equal(s.cost.timedOut, 1); assert.equal(s.cost.lifetimeExhausted, 7);
  assert.equal(s.work[0].exhausted, 2); assert.equal(s.work[0].repeatedExhaustion, true); assert.equal(s.work[0].modelMs, 165000);
});

test("historical exhaustion without usage remains visible but has unknown model duration", () => {
  const jobs = { r1: job("r1", { history: [{ kind: "turn-limit", at: NOW - HOUR }] }) };
  const s = buildThroughput({ jobs }, [], { now: NOW });
  assert.equal(s.cost.exhausted, 1); assert.equal(s.cost.exhaustionHistoryOnly, 1); assert.equal(s.cost.modelMs, 0); assert.equal(s.cost.durationKnown, 0);
});

test("output is bounded and excludes source text, summaries, secrets and raw dependency payloads", () => {
  const jobs = Object.fromEntries(Array.from({ length: 80 }, (_, i) => ["r" + i, job("r" + i, { source: { content: "PRIVATE SOURCE token=private" }, summary: "PRIVATE SUMMARY", ciWatch: { 12: { since: NOW - HOUR, token: "private" } } })]));
  const s = buildThroughput({ jobs }, [], { now: NOW, limit: 10 });
  assert.equal(s.work.length, 10); assert.equal(s.hiddenWork, 70); assert.equal(s.longestStalls.length, 8);
  assert.doesNotMatch(JSON.stringify(s), /PRIVATE|token|private/); assert.equal(s.supportSample.available, false);
});

test("returned blocked children do not keep their parent in dependency wait and roots deduplicate", () => {
  const jobs = { a: job("a", { ticket: 1553 }), duplicate: job("duplicate", { ticket: 1553 }), child: job("child", { kind: "coding", codingParent: "a", state: "blocked" }), owner: job("owner", { ownerDecisionPending: true, ticket: 1554 }), ci: job("ci", { ticket: 1555, ciWatch: { 1: {} } }) };
  const s = buildThroughput({ jobs }, [], { now: NOW });
  assert.equal(s.counts.ticketRoots, 3); assert.equal(s.counts.actionableTicketRoots, 3);
  assert.equal(s.work.find((r) => r.id === "a").category, "other"); assert.equal(s.work.find((r) => r.id === "a").blockedChildren, 1);
  assert.equal(s.work.find((r) => r.id === "owner").waitSince, null); assert.equal(s.work.find((r) => r.id === "ci").waitSince, null);
  assert.doesNotMatch(JSON.stringify(s), /Infinity/);
});

test("visual stages follow observed work and do not treat an old deployment receipt as current release work", () => {
  const jobs = { r1: job("r1", { releaseEvidence: { previous: { main: true } } }), child: job("child", { kind: "coding", codingParent: "r1", state: "running" }), hold: job("hold", { promotionHoldUntil: NOW + HOUR }), old: job("old", { releaseEvidence: { previous: { main: true } } }) };
  const s = buildThroughput({ jobs }, [], { now: NOW });
  assert.equal(s.work.find((r) => r.id === "r1").stage, "coding");
  assert.equal(s.work.find((r) => r.id === "hold").stage, "release");
  assert.equal(s.work.find((r) => r.id === "old").stage, "unknown");
});

test("CI watch links accept transferred repositories and preserve historical links", () => {
  for (const repository of ["lakesidegamedev/AHDGame", "lakesidegamedev/AHDClient", "Egg3901/AHDGame", undefined]) {
    const s = buildThroughput({ jobs: { ci: job("ci", { ciWatch: { 12: { since: NOW - 1000, repository } } }) } }, [], { now: NOW });
    assert.equal(s.work[0].prs[0].url, `https://github.com/${repository || "lakesidegamedev/AHDGame"}/pull/12`);
  }
  const s = buildThroughput({ jobs: { ci: job("ci", { ciWatch: { 12: { repository: "unrelated/AHDGame" } } }) } }, [], { now: NOW });
  assert.equal(s.work[0].prs[0].url, null);
});
