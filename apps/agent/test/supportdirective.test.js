"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { createLedger } = require("../lib/operator/store");
const { createBroker } = require("../lib/operator/broker");
const { createAppChannel } = require("../lib/operator/appchannel");
// Persisted pre-policy receipts are fixtures, not new consent. New owner Muse
// transfers are unsupported until derived actions can carry exact provenance.
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keir-directive-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ledger = createLedger(path.join(dir, "ledger.json"));
  const config = { ownerId: "owner", staffIds: [], stateDir: dir, repositories: {}, taskLifetimeMs: 86400000, supportDeferred: () => false };
  const app = createAppChannel({ ledger, config });
  const source = ledger.data.jobs[app.authenticatedPost("Inspect the saved support handoff", undefined, "main", { mode: "new" }).jobId]; source.state = "running";
  const job = ledger.createJob("ticket:1564", { kind: "ticket", role: "support", ticket: 1564, channelId: "channel", source: {}, deadline: Date.now() + 86400000 }); job.state = "waiting";
  const row = { directiveId: "saved-directive", sourceTaskId: source.id, sourceMessageId: source.source.messageId, content: "Historical exact owner context", at: new Date().toISOString() };
  job.inbox = [row];
  const receipt = { id: row.directiveId, sourceTaskId: source.id, sourceMessageId: row.sourceMessageId, ticket: 1564, coordinatorTaskId: job.id, outcome: "held", remainingBlockers: ["staff-owned"] };
  ledger.data.channels.channel = { claimedBy: "staff", category: "mechanics" };
  ledger.data.supportDirectives = { [receipt.id]: receipt };
  source.effects[`support-directive:${receipt.id}`] = { state: "done", result: receipt };
  let calls = 0;
  const broker = createBroker({ ledger, config, mcp: { servers: () => [], call: async () => { calls++; throw new Error("No external call expected"); } }, discord: async () => { calls++; }, sandbox: {} });
  return { ledger, config, app, source, job, receipt, broker, calls: () => calls };
}

test("new owner transfers and legacy note compatibility refuse before adoption, wake or record mutation", async t => {
  const f = fixture(t), before = structuredClone(f.receipt);
  for (const input of [{ ticket: 1564 }, { ticket: 1564, sourceMessageId: "forged" }, { ticket: 1564, approvals: [{ kind: "action", id: "not-consent", digest: "forged" }] }]) {
    await assert.rejects(f.broker.tool(f.source, "support_directive", input), /Unsupported support handoff/);
    assert.throws(() => f.broker.supportDirective(f.source, input), /Unsupported support handoff/);
  }
  await assert.rejects(f.broker.tool(f.source, "ticket_record", { ticket: 1564, op: "add", kind: "promise", text: "Support will act" }), /Unsupported support handoff/);
  assert.equal(f.job.state, "waiting"); assert.equal(f.job.inbox.length, 1); assert.equal(f.calls(), 0);
  assert.deepEqual(f.receipt, before); assert.equal(f.ledger.data.ticketRecords, undefined);
  assert.match(f.app.view().tasks[0].status, /Nothing was delivered or woken/);
});

test("legacy unproven origins are not backfilled by source role or saved message", async t => {
  const f = fixture(t); delete f.ledger.data.ownerMuseOrigins[f.source.id];
  await assert.rejects(f.broker.tool(f.source, "support_directive", { ticket: 1564 }), /Start a new authenticated app task/);
  assert.equal(f.calls(), 0); assert.equal(f.job.state, "waiting");
  assert.equal(f.ledger.data.ownerMuseOrigins[f.source.id], undefined);
});

test("saved receipts remain readable and consumption does not copy consent or lift pending approval", async t => {
  const f = fixture(t); f.job.state = "running";
  f.ledger.data.actions.a = { id: "a", jobId: f.job.id, state: "pending", digest: "exact-existing" };
  const before = JSON.stringify(f.ledger.data.actions);
  const rows = await f.broker.tool(f.job, "support_updates", {});
  assert.equal(rows[0].directiveId, f.receipt.id); assert.ok(f.receipt.incorporatedAt);
  assert.equal(JSON.stringify(f.ledger.data.actions), before);
  assert.equal(f.broker.supportDirectiveHeld(f.job), true);
  await assert.rejects(f.broker.tool(f.job, "calculate", { expression: "1+1" }), /held/);
  delete f.ledger.data.channels.channel.claimedBy;
  f.ledger.data.actions.a.state = "approved";
  f.broker.supportDirectiveTick(); assert.equal(f.receipt.outcome, "pending");
  assert.equal((await f.broker.tool(f.job, "calculate", { expression: "1+1" })).value, 2);
  assert.equal(f.calls(), 0);
});

for (const mode of ["staff", "paused", "category", "action", "uncertain", "player-wait"]) test(`saved held receipt retains ${mode} fence`, t => {
  const f = fixture(t); delete f.ledger.data.channels.channel.claimedBy;
  if (mode === "staff") f.ledger.data.channels.channel.claimedBy = "staff";
  if (mode === "paused") f.ledger.data.paused = true;
  if (mode === "category") f.ledger.data.channels.channel.category = "moderation";
  if (mode === "action") f.ledger.data.actions.a = { jobId: f.job.id, state: "pending" };
  if (mode === "uncertain") f.job.effects.write = { state: "started" };
  if (mode === "player-wait") f.job.waitingFor = { kind: "player_reply" };
  f.broker.supportDirectiveTick();
  assert.equal(f.job.state, "waiting"); assert.equal(f.receipt.outcome, "held"); assert.ok(f.receipt.remainingBlockers.length);
});

test("saved held directive wakes once after an existing hold clears and keeps exact approvals", t => {
  const f = fixture(t);
  f.ledger.data.actions.a = { id: "a", jobId: f.job.id, state: "approved", digest: "unchanged", approvedBy: "owner" };
  const before = JSON.stringify(f.ledger.data.actions);
  f.broker.supportDirectiveTick(); assert.equal(f.job.state, "waiting");
  delete f.ledger.data.channels.channel.claimedBy;
  f.broker.supportDirectiveTick(); f.broker.supportDirectiveTick();
  assert.equal(f.job.state, "queued"); assert.equal(f.receipt.outcome, "woken"); assert.equal(f.job.inbox.length, 1);
  assert.equal(JSON.stringify(f.ledger.data.actions), before);
});

test("source receipt mirror stays synchronized with canonical incorporation after restart", async t => {
  const f = fixture(t); f.ledger.save();
  const ledger = createLedger(path.join(f.config.stateDir, "ledger.json"));
  const broker = createBroker({ ledger, config: f.config, mcp: { servers: () => [] }, discord: async () => {}, sandbox: {} });
  const job = ledger.data.jobs[f.job.id]; job.state = "running";
  await broker.tool(job, "support_updates", {});
  const canonical = ledger.data.supportDirectives[f.receipt.id];
  const mirrored = ledger.data.jobs[f.source.id].effects[`support-directive:${f.receipt.id}`].result;
  assert.ok(canonical.incorporatedAt); assert.equal(mirrored.incorporatedAt, canonical.incorporatedAt);
  broker.supportDirectiveTick(); assert.equal(job.inbox.length, 0);
});
