"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { projectWorkRecords, integrityReport, workIdForJob } = require("../lib/operator/workrecord");

// Synthetic fixtures replay the observed failure shapes without any live
// ledger content: coordinator plus owner command on one ticket, a Luna child
// finishing after its parent, a CI watch stranded on a finished job, and a
// freeform review followed by an exact-action approval on the same job.
function fixture() {
  return {
    version: 1,
    seen: { "ticket:42": "coord", "discord:m1": "coord", "discord:m2": "ownercmd" },
    jobs: {
      coord: { id: "coord", kind: "ticket", role: "support", ticket: 42, channelId: "ch42",
        state: "waiting", at: 1000, updatedAt: 5000, lastPublishedAt: 4000, wakeAt: 9000,
        ciWatch: { 7: { since: 2000, repository: "lakesidegamedev/AHDGame" } }, pullRequests: ["https://example.invalid/pr/7"] },
      ownercmd: { id: "ownercmd", kind: "command", role: "owner", ticket: 42, channelId: "ch42",
        state: "running", at: 3000, updatedAt: 8000, lastPublishedAt: 7000,
        source: { channelId: "ch42", channelName: "ticket-support-42" } },
      luna: { id: "luna", kind: "coding", role: "owner", codingParent: "ownercmd",
        state: "done", at: 3500, updatedAt: 6000 },
      chat: { id: "chat", kind: "conversation", role: "owner", state: "queued", at: 8500, updatedAt: 8500,
        source: { channelId: "dm1" } },
      old: { id: "old", kind: "ticket", role: "support", ticket: 9, channelId: "ch9",
        state: "done", at: 500, updatedAt: 900, ciWatch: { 3: { since: 600 } } },
    },
    actions: {
      a1: { id: "a1", jobId: "ownercmd", kind: "github", digest: "d1", state: "pending", expiresAt: 99999 },
      a2: { id: "a2", jobId: "ghost", kind: "heal", digest: "d2", state: "pending" },
    },
    decisions: {
      x1: { id: "x1", jobId: "ownercmd", actionId: null, state: "approve" },
      x2: { id: "x2", jobId: "ownercmd", actionId: "a1", state: "pending" },
    },
    outbox: {
      "ack:coord": { destination: "channel:coord", deliveredAt: 4500 },
      "finish:ownercmd": { destination: "channel:ownercmd", deliveredAt: 7500 },
    },
    channels: { ch42: {}, ch9: { claimedBy: "staff1" } },
    ticketRecords: { 42: { facts: [{ id: "f1" }], ruledOut: [], promises: [{ id: "p1" }], questions: [{ id: "q1", closedAt: "t" }] } },
    ticketPosts: { 42: [{ jobId: "coord", at: 4000, text: "update" }] },
  };
}

test("coordinator, owner command and Luna child share one ticket record", () => {
  const { records } = projectWorkRecords(fixture());
  const rec = records["ticket:42"];
  assert.deepEqual(rec.attempts, ["coord", "ownercmd", "luna"]);
  assert.equal(rec.coordinatorAttemptId, "coord");
  assert.equal(rec.state, "active");
  assert.equal(rec.nextAction, "awaiting-approval");
  assert.deepEqual(rec.pullRequests, ["https://example.invalid/pr/7"]);
  assert.deepEqual(rec.knowledge, { facts: 1, ruledOut: 0, openPromises: 1, openQuestions: 0 });
});

test("public activity is the latest receipt across attempts, not job-local", () => {
  const { records } = projectWorkRecords(fixture());
  assert.equal(records["ticket:42"].lastPublicActivityAt, 7500);
});

test("non-ticket work gets a request record keyed by its root job", () => {
  const data = fixture();
  const { records, attemptWork } = projectWorkRecords(data);
  assert.equal(attemptWork.chat, "request:chat");
  assert.equal(records["request:chat"].kind, "request");
  assert.equal(workIdForJob(data.jobs.luna, data.jobs), "ticket:42");
});

test("waits are correlation-keyed and stranded CI watches are flagged", () => {
  const data = fixture();
  const { records } = projectWorkRecords(data);
  const ci = records["ticket:42"].waits.find((w) => w.kind === "ci");
  assert.equal(ci.correlation, "lakesidegamedev/AHDGame#7");
  assert.equal(ci.orphaned, false);
  assert.ok(ci.deadline > ci.since);
  assert.equal(records["ticket:9"].waits[0].orphaned, true);
  assert.deepEqual(integrityReport(data).orphanedCiWatches, ["old"]);
});

test("every job maps to exactly one record and dangling references surface", () => {
  const report = integrityReport(fixture());
  assert.equal(report.jobs, 5);
  assert.deepEqual(report.unmappedJobs, []);
  assert.deepEqual(report.problems, []);
  assert.deepEqual(report.danglingActions, ["a2"]);
  assert.equal(report.multiAttemptTickets, 1);
  assert.equal(report.maxAttemptsPerTicket, 3);
});

test("a job with freeform and exact-action decisions is a double-ask risk", () => {
  const data = fixture();
  assert.deepEqual(integrityReport(data).doubleAskJobs, ["ownercmd"]);
  const { records } = projectWorkRecords(data);
  assert.equal(records["ticket:42"].pendingApprovals[0].actionId, "a1");
  assert.equal(records["ticket:42"].pendingDecisions[0].freeform, false);
});

test("projection is deterministic, pure and cycle-safe", () => {
  const data = fixture();
  data.jobs.luna.codingParent = "luna"; // corrupt self-parent must not hang
  const before = JSON.stringify(data);
  const first = projectWorkRecords(data);
  const second = projectWorkRecords(data);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(data), before);
});

test("staff claim is carried on the record, terminal records need no action", () => {
  const { records } = projectWorkRecords(fixture());
  assert.equal(records["ticket:9"].staffClaimedBy, "staff1");
  assert.equal(records["ticket:9"].state, "terminal");
  assert.equal(records["ticket:9"].nextAction, "none");
});
