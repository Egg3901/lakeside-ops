"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createWatch } = require("../lib/operator/watch");

function harness(anomalies) {
  let id = 0;
  const ledger = {
    data: { jobs: {} }, save() {}, audit() {},
    createJob(key, fields) {
      const job = { id: `job${++id}`, state: "queued", ...fields };
      this.data.jobs[job.id] = job;
      return job;
    },
  };
  const watch = createWatch({ ledger, now: () => 1_000_000,
    mcp: { call: async () => ({ anomalies }) } });
  const sweep = async () => { await watch.sensors.turns(); return watch.promote(); };
  return { ledger, watch, sweep, jobs: () => Object.values(ledger.data.jobs) };
}
const failure = (turn, phase, reason = "other") => ({ turn, phase, reason, kind: "phase-failed" });
const warning = (turn, phase, cause) => ({ turn, kind: "warning", detail: `${phase}: ${cause}` });

test("a recurring phase failure spends one finding budget, retaining each failed turn", async () => {
  const rows = [failure(196, "bankingTurn"), failure(195, "bankingTurn")];
  const h = harness(rows);
  await h.sweep();
  assert.equal(h.jobs().length, 1);
  rows.unshift(failure(197, "bankingTurn"));
  await h.sweep();
  assert.equal(h.jobs().length, 1);
  assert.equal(h.ledger.data.watch.spawned.length, 1);
  const finding = Object.values(h.ledger.data.watch.findings)[0];
  assert.match(finding.evidence, /195/);
  assert.match(finding.evidence, /196/);
  assert.match(finding.evidence, /197/);
});

test("one exact cause correlated to both failed phases creates one repair investigation", async () => {
  const cause = "Unbalanced original LOC cash flows in USD";
  const h = harness([failure(196, "bankingTurn"), failure(196, "lineOfCreditTurn"), failure(195, "bankingTurn"),
    warning(196, "bankingTurn", cause), warning(196, "lineOfCreditTurn", cause), warning(195, "bankingTurn", cause)]);
  await h.sweep();
  assert.equal(h.jobs().length, 1);
  assert.match(h.jobs()[0].source.content, /bankingTurn/);
  assert.match(h.jobs()[0].source.content, /lineOfCreditTurn/);
  assert.match(h.jobs()[0].source.content, /Unbalanced original LOC cash flows in USD/);
  await h.sweep();
  assert.equal(h.jobs().length, 1, "correlated warning rows must not spawn another soft finding");
});

test("generic classifications never group unrelated phases", async () => {
  const h = harness([failure(196, "bankingTurn"), failure(196, "lineOfCreditTurn"),
    warning(196, "bankingTurn", "other"), warning(196, "lineOfCreditTurn", "other")]);
  await h.sweep();
  assert.equal(h.jobs().length, 2);
});

test("warnings from another phase or turn cannot establish a shared cause", async () => {
  const cause = "Unbalanced original LOC cash flows in USD";
  const h = harness([failure(196, "bankingTurn"), failure(196, "lineOfCreditTurn"),
    warning(195, "bankingTurn", cause), warning(196, "unrelatedTurn", cause)]);
  await h.sweep();
  assert.equal(h.jobs().length, 2);
  const failures = Object.values(h.ledger.data.watch.findings).filter((f) => f.hard);
  assert.equal(failures.every((f) => !f.phaseFailure.cause), true);
});

test("different substantive errors remain different investigations", async () => {
  const h = harness([failure(196, "bankingTurn"), failure(196, "lineOfCreditTurn"),
    warning(196, "bankingTurn", "Unbalanced original LOC cash flows in USD"),
    warning(196, "lineOfCreditTurn", "Missing interest settlement receipt")]);
  await h.sweep();
  assert.equal(h.jobs().length, 2);
});

test("upgrade coalesces persisted per-turn findings into the active primary, retaining all receipts", async () => {
  const cause = "Unbalanced original LOC cash flows in USD";
  const h = harness([failure(196, "bankingTurn"), failure(196, "lineOfCreditTurn"), failure(195, "bankingTurn"),
    warning(196, "bankingTurn", cause), warning(196, "lineOfCreditTurn", cause), warning(195, "bankingTurn", cause)]);
  h.ledger.data.jobs = { bank196: { id: "bank196", state: "done" }, loc196: { id: "loc196", state: "waiting" }, bank195: { id: "bank195", state: "done" } };
  const findings = {};
  for (const [turn, phase, job, issue] of [[196, "bankingTurn", "bank196", 42], [196, "lineOfCreditTurn", "loc196", 40], [195, "bankingTurn", "bank195", 42]]) {
    const fp = `turn:${turn}:phase-failed:${phase}`;
    findings[fp] = { fp, sensor: "turns", state: "raised", jobId: job, issue, firstSeen: 1, lastSeen: 1, seen: 2 };
  }
  h.ledger.data.watch = { findings, spawned: [1, 2, 3] };
  await h.sweep();
  await h.sweep();
  await h.watch.sensors.turns();
  assert.equal(h.jobs().length, 3, "no replacement investigation on deployment");
  const primary = findings["turn:196:phase-failed:lineOfCreditTurn"];
  assert.equal(primary.jobId, "loc196");
  assert.equal(primary.issue, 40);
  for (const key of ["turn:196:phase-failed:bankingTurn", "turn:195:phase-failed:bankingTurn"]) {
    assert.equal(findings[key].correlatedWith, primary.fp);
    assert.equal(findings[key].issue, 42);
    assert.equal(findings[key].state, "raised");
  }
  assert.match(primary.evidence, /bankingTurn/);
  assert.match(primary.evidence, /lineOfCreditTurn/);
  assert.equal(h.watch.score().openFindings, 1);
  assert.deepEqual(h.ledger.data.watch.spawned, [1, 2, 3], "do not erase historical budget use");
  assert.equal(h.ledger.data.jobs.loc196.state, "waiting", "correlation neither wakes nor cancels ongoing work");
});

test("new exact error after an earlier diagnosis is a new finding", async () => {
  const rows = [failure(196, "bankingTurn"), warning(196, "bankingTurn", "Unbalanced original LOC cash flows in USD")];
  const h = harness(rows);
  await h.sweep();
  rows.splice(0, rows.length, failure(197, "bankingTurn"), warning(197, "bankingTurn", "Missing interest settlement receipt"));
  await h.sweep();
  assert.equal(h.jobs().length, 2);
});


test("a later generic failure cannot merge two already distinct causes", async () => {
  const rows = [failure(195, "bankingTurn", "Missing interest settlement receipt"),
    failure(196, "bankingTurn", "Unbalanced original LOC cash flows in USD")];
  const h = harness(rows);
  await h.sweep();
  rows.splice(0, rows.length, failure(197, "bankingTurn"));
  await h.sweep();
  const known = Object.values(h.ledger.data.watch.findings).filter((f) => f.phaseFailure?.cause);
  assert.equal(known.length, 2);
  assert.equal(known.every((f) => !f.correlatedWith), true);
  assert.equal(h.jobs().length, 3);
});

test("conflicting warnings remain separate signals rather than an inferred shared cause", async () => {
  const h = harness([failure(196, "bankingTurn"),
    warning(196, "bankingTurn", "Missing interest settlement receipt"),
    warning(196, "bankingTurn", "Unbalanced original LOC cash flows in USD")]);
  await h.sweep();
  const findings = Object.values(h.ledger.data.watch.findings);
  assert.equal(findings.length, 3);
  assert.equal(findings.filter((f) => !f.hard).length, 2);
  assert.equal(findings.every((f) => !f.correlatedWith), true);
  assert.equal(findings.find((f) => f.hard).phaseFailure.cause, undefined);
});
