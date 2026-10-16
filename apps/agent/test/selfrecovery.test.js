"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { createRecovery, SPIN_ROUNDS, STARVE_MS, HOLD_MS } = require("../lib/operator/selfrecovery");

function world(jobs, t0 = 1_000_000_000) {
  let t = t0; const audits = [];
  const ledger = { data: { jobs: Object.fromEntries(jobs.map((j) => [j.id, j])) }, audit: (k, v) => audits.push([k, v]), save() {} };
  const r = createRecovery({ ledger, now: () => t });
  return { ledger, r, audits, advance: (ms) => { t += ms; }, now: () => t };
}
const slot = (job, startedAt, aborted = { v: false }) => ({ job, startedAt, controller: { abort: () => { aborted.v = true; } }, aborted });

test("a spinning ticket is nudged once, then parked and its lane released", () => {
  const job = { id: "a", kind: "ticket", ticket: 1560, state: "running", rounds: 10 };
  const w = world([job]); const s = slot(job, 0); const active = { investigation: s };
  w.r.tick(active);
  job.rounds += SPIN_ROUNDS; w.r.tick(active);
  assert.equal(job.inbox.at(-1).authorId, "self-recovery");
  assert.equal(job.state, "running");
  job.rounds += SPIN_ROUNDS; w.r.tick(active);
  assert.equal(job.state, "waiting"); assert.match(job.summary, /^Self-recovery:/); assert.equal(s.aborted.v, true);
  assert.deepEqual(w.ledger.data.recoveries.map((x) => x.action), ["nudged", "parked"]);
});

test("progress resets the spin count; a spinning side task is stopped", () => {
  const ticket = { id: "t", kind: "ticket", ticket: 1, state: "running", rounds: 0 };
  const cmd = { id: "c", kind: "command", state: "running", rounds: 0 };
  const w = world([ticket, cmd]);
  w.r.tick({});
  ticket.rounds += SPIN_ROUNDS; ticket.lastPublishedAt = 5; w.r.tick({});
  assert.equal(ticket.inbox, undefined);
  cmd.rounds += SPIN_ROUNDS; w.r.tick({}); cmd.rounds += SPIN_ROUNDS; w.r.tick({});
  assert.equal(cmd.state, "cancelled");
});

test("a starving ticket preempts non-ticket work first, never an effect in flight", () => {
  const w = world([]);
  const starving = { id: "s", kind: "ticket", ticket: 1577, state: "queued", wakeAt: w.now() - STARVE_MS - 1 };
  const busyTicket = { id: "b", kind: "ticket", ticket: 2, state: "running" };
  const cmd = { id: "c", kind: "command", state: "running" };
  const writing = { id: "e", kind: "command", state: "running", effects: { x: { state: "executing" } } };
  Object.assign(w.ledger.data.jobs, { s: starving, b: busyTicket, c: cmd, e: writing });
  const active = { investigation: slot(busyTicket, w.now() - HOLD_MS - 1), investigation2: slot(cmd, w.now()), investigation3: slot(writing, 0), coding: slot(busyTicket, w.now()), coding2: slot(cmd, w.now()), coding3: slot(writing, 0) };
  w.r.tick(active);
  assert.equal(cmd.state, "queued"); assert.equal(writing.state, "running");
  assert.equal(w.ledger.data.recoveries.at(-1).forTicket, 1577);
});

test("no preemption while a usable lane is free", () => {
  const w = world([]);
  const starving = { id: "s", kind: "ticket", ticket: 9, state: "queued", wakeAt: w.now() - STARVE_MS - 1 };
  const cmd = { id: "c", kind: "command", state: "running" };
  Object.assign(w.ledger.data.jobs, { s: starving, c: cmd });
  w.r.tick({ investigation: slot(cmd, 0), investigation2: null });
  assert.equal(cmd.state, "running");
});

test("owner-requested work that spins is blocked for review, never cancelled", () => {
  const job = { id: "o", kind: "command", role: "owner", state: "running", rounds: 0 };
  const w = world([job]); const s = slot(job, 0); const active = { investigation: s };
  w.r.tick(active); job.rounds += SPIN_ROUNDS; w.r.tick(active); job.rounds += SPIN_ROUNDS; w.r.tick(active);
  assert.equal(job.state, "blocked");
  assert.match(job.summary, /^Self-recovery: .*retry it from the app/);
  assert.equal(s.aborted.v, true);
  assert.equal(w.ledger.data.recoveries.at(-1).action, "blocked");
});
