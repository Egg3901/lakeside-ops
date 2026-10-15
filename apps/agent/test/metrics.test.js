"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { computeMetrics, parseUsage, percentile } = require("../lib/operator/metrics");

const NOW = 1000000;
function fixture() {
  return {
    seen: { "ticket:5": "t5" },
    jobs: {
      t5: { id: "t5", kind: "ticket", ticket: 5, channelId: "ch5", state: "waiting", at: 1000, updatedAt: 2000, lastPublishedAt: 3000 },
      q1: { id: "q1", kind: "conversation", state: "queued", at: NOW - 40000, updatedAt: NOW - 40000 },
      done1: { id: "done1", kind: "command", state: "done", at: 500, updatedAt: 900 },
    },
    outbox: { "ack:t5": { destination: "channel:t5", deliveredAt: 11000 } },
    channels: { ch5: {} },
    actions: {}, decisions: {},
  };
}

test("percentile and usage parsing tolerate torn lines", () => {
  assert.equal(percentile([3, 1, 2], 0.5), 2);
  assert.equal(parseUsage('{"kind":"ticket","durationMs":5}\n{"torn":').length, 1);
});

test("ack latency falls back to job creation when the message time is missing, and says so", () => {
  const m = computeMetrics(fixture(), [], { now: NOW });
  assert.equal(m.ackLatencyMs.n, 1);
  assert.equal(m.ackLatencyMs.p50, 10000);
  assert.equal(m.budgets.ackP95.verdict, "within");
  assert.equal(m.ackBreakdownMs.fallbackToJobCreation, 1);
});

test("silence is record-level and staff-claimed tickets are excluded", () => {
  const data = fixture();
  const m = computeMetrics(data, [], { now: NOW });
  assert.equal(m.silence.overBudget, 1); // last public activity at 3000, far past 10 minutes
  data.channels.ch5.claimedBy = "staff1";
  assert.equal(computeMetrics(data, [], { now: NOW }).silence.overBudget, 0);
});

test("conversation activations are a labelled proxy and can bust the budget", () => {
  const usage = [{ kind: "conversation", durationMs: 81000 }, { kind: "ticket", durationMs: 38000 }];
  const m = computeMetrics(fixture(), usage, { now: NOW });
  assert.equal(m.activationsMs.conversation.max, 81000);
  assert.equal(m.budgets.simpleReplyP95Proxy.verdict, "exceeds");
});

test("queue age separates the conversation lane from workers", () => {
  const m = computeMetrics(fixture(), [], { now: NOW });
  assert.equal(m.queue.oldestConversationMs, 40000);
  assert.equal(m.queue.oldestWorkerMs, 0);
});

test("ack latency runs from the message timestamp and reports the ingest share", () => {
  const data = fixture();
  data.jobs.t5.source = { at: new Date(-14000).toISOString() }; // sent 15s before the job existed
  const m = computeMetrics(data, [], { now: NOW });
  assert.equal(m.ackLatencyMs.p50, 25000);
  assert.equal(m.ackBreakdownMs.fromJobCreation.p50, 10000);
  assert.equal(m.ackBreakdownMs.ingest.p50, 15000);
  assert.equal(m.ackBreakdownMs.fallbackToJobCreation, 0);
  assert.equal(m.budgets.ackP95.verdict, "exceeds");
});
