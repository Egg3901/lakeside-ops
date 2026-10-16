"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

test("owner direction releases the owner's own claim and requeues the deferred ticket, never a staff claim", () => {
  const src = fs.readFileSync(path.join(__dirname, "../lib/operator/gateway.js"), "utf8");
  assert.match(src, /actor === config\.ownerId && d\.channels\[channel\.id\]\?\.claimedBy === config\.ownerId/);
  assert.match(src, /held\.state === "deferred"\) \{ held\.state = "queued"/);
  const dir = fs.readFileSync(path.join(__dirname, "../lib/operator/supportdirective.js"), "utf8");
  assert.match(dir, /claimant && claimant === config\.ownerId/);
  assert.match(dir, /claimReleasedAt: now\(\)/);
});

test("an owner hold with no decision becomes a real owner question, and approval releases it", () => {
  const { createRecovery } = require("../lib/operator/selfrecovery");
  const j = { id: "h", kind: "ticket", ticket: 1584, state: "blocked", ownerDecisionPending: true, summary: "Awaiting the owner's decision on releasing both corrections." };
  const ledger = { data: { jobs: { h: j }, decisions: {}, outbox: {} }, audit() {}, save() {}, notify() {} };
  const r = createRecovery({ ledger, config: { ownerId: "o" }, now: () => 1e12 });
  r.tick({});
  const x = Object.values(ledger.data.decisions).find((y) => y.selfRecovery?.kind === "orphan-hold");
  assert.ok(x); assert.match(x.question, /no question was ever sent/);
  r.tick({}); assert.equal(Object.values(ledger.data.decisions).length, 1);
  x.state = "approve"; r.tick({});
  assert.equal(j.ownerDecisionPending, undefined); assert.equal(j.state, "queued"); assert.match(j.inbox.at(-1).content, /owner approved/);
});
