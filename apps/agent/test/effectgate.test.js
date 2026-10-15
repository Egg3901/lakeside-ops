"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createEffectGate, effectIdentity, healKind } = require("../lib/operator/effectgate");
const { createPrincipals } = require("../lib/operator/principals");

const config = { ownerId: "owner1", botId: "bot1", staffIds: ["delegate1", "dev1"] };
const principals = createPrincipals(config);
const as = (authorId, via = "decision-button") => principals.fromAuthenticated({ authorId, via, messageId: `m-${authorId}` });
const merge = (digest = "head-A") => ({ kind: "pr-merge", target: "lakesidegamedev/AHDGame#9", environment: "development", contentDigest: digest });

test("the review-then-execute double ask is structurally impossible", () => {
  const g = createEffectGate({});
  const first = g.propose(merge());
  g.approve(first.identity, as("owner1"));
  const again = g.propose(merge()); // same identity presented for execution
  assert.equal(again.reusedApproval, true);
  assert.equal(again.needsApproval, false);
  assert.equal(g.authorizeExecution(merge()).allowed, true);
});

test("any material change mints a new identity that must be approved again", () => {
  const g = createEffectGate({});
  g.approve(g.propose(merge()).identity, as("owner1"));
  const changed = g.propose(merge("head-B"));
  assert.equal(changed.needsApproval, true);
  assert.equal(g.authorizeExecution(merge("head-B")).allowed, false);
  assert.notEqual(effectIdentity(merge()), effectIdentity(merge("head-B")));
});

test("players and insufficient roles cannot approve, unknown kinds fail closed", () => {
  const g = createEffectGate({});
  const p = g.propose({ kind: "money-move", target: "ticket:9", contentDigest: "amt1" });
  assert.throws(() => g.approve(p.identity, as("player1")), /cannot approve/);
  assert.throws(() => g.approve(p.identity, as("dev1")), /cannot approve/);
  assert.throws(() => g.propose({ kind: "wipe-everything", target: "x" }), /unknown effect kind/);
});

test("a forged principal object is refused even when it claims owner", () => {
  const g = createEffectGate({});
  const p = g.propose({ kind: "promotion", target: "main", contentDigest: "sha1" });
  assert.throws(() => g.approve(p.identity, { actor: "owner1", roles: ["owner"], via: "message" }), /authenticated principal/);
  assert.throws(() => g.approve(p.identity, { actor: "owner1", role: "owner" }), /authenticated principal/);
});

test("an executing or done effect can never be blindly retried", () => {
  const g = createEffectGate({});
  const p = g.propose(merge());
  g.approve(p.identity, as("owner1"));
  g.beginExecution(p.identity);
  assert.match(g.authorizeExecution(merge()).reason, /uncertain/);
  g.recordReceipt(p.identity, { merged: true });
  const again = g.authorizeExecution(merge());
  assert.equal(again.allowed, false);
  assert.equal(again.receipt.merged, true);
});

test("expired approval refuses at the execution recheck and at beginExecution", () => {
  let clock = 0;
  const g = createEffectGate({}, { now: () => clock, defaultTtlMs: 100 });
  const p = g.propose(merge());
  g.approve(p.identity, as("owner1"));
  clock = 200;
  assert.equal(g.authorizeExecution(merge()).allowed, false);
  assert.throws(() => g.beginExecution(p.identity), /expired/);
});

test("a broader promotion retires only exactly subsumed pending promotions", () => {
  const g = createEffectGate({});
  const narrow = g.propose({ kind: "promotion", target: "staging", environment: "prod", contentDigest: "sha-narrow" });
  const other = g.propose({ kind: "promotion", target: "staging", environment: "prod", contentDigest: "sha-other" });
  const heal = g.propose({ kind: "heal-prod-high", target: "ticket:3", contentDigest: "h1" });
  const retired = g.reconcilePromotion({ environment: "prod", containedDigests: ["sha-narrow", "sha-broad"] });
  assert.deepEqual(retired, [narrow.identity]);
  assert.equal(g.get(other.identity).state, "proposed");
  assert.equal(g.get(heal.identity).state, "proposed");
});

test("auto-tier effects need no approval but still get identities and receipts", () => {
  const g = createEffectGate({});
  const p = g.propose({ kind: "public-status", target: "ticket:5", contentDigest: "status1" });
  assert.equal(p.needsApproval, false);
  assert.equal(g.authorizeExecution({ kind: "public-status", target: "ticket:5", contentDigest: "status1" }).allowed, true);
});

// Review 2026-10-13 (#68): carry the live 2.x approval rules.
test("opening a development PR needs no approval, as in 2.x publishPatch", () => {
  const g = createEffectGate({});
  const spec = { kind: "patch-publish", target: "lakesidegamedev/AHDGame@base1", contentDigest: "patch-A" };
  assert.equal(g.propose(spec).needsApproval, false);
  assert.equal(g.authorizeExecution(spec).allowed, true);
});

test("the owner's own request authorizes a standing effect once, with the message as receipt", () => {
  const g = createEffectGate({});
  const request = principals.fromAuthenticated({ authorId: "owner1", via: "message", messageId: "req-1" });
  const spec = { kind: "heal-prod", target: "ticket:4", contentDigest: "h-small", workId: "ticket:4" };
  const p = g.propose(spec, { requester: request });
  assert.equal(p.needsApproval, false);
  assert.equal(p.standing, true);
  assert.equal(g.authorizeExecution(spec).approval.messageId, "req-1");
  // the same work requested by a player or a ticket job is not standing
  const other = g.propose({ ...spec, contentDigest: "h-2" }, { requester: as("player1", "message") });
  assert.equal(other.needsApproval, true);
});

test("high-impact heals are their own explicit yes even inside owner work", () => {
  assert.equal(healKind({ env: "prod", touchesMoney: true }), "heal-prod-high");
  assert.equal(healKind({ env: "prod", kind: "compensation" }), "heal-prod-high");
  assert.equal(healKind({ env: "prod", collection: "gameConfig" }), "heal-prod-high");
  assert.equal(healKind({ env: "prod", expectedMax: 26 }), "heal-prod-high");
  assert.equal(healKind({ env: "prod", expectedMax: 3 }), "heal-prod");
  assert.equal(healKind({ env: "dev" }), "heal-nonprod");
  const g = createEffectGate({});
  const request = principals.fromAuthenticated({ authorId: "owner1", via: "message", messageId: "req-2" });
  const p = g.propose({ kind: "heal-prod-high", target: "ticket:4", contentDigest: "pay" }, { requester: request });
  assert.equal(p.needsApproval, true);
});

test("heal approvals live nine minutes, as in 2.x", () => {
  let clock = 0;
  const g = createEffectGate({}, { now: () => clock });
  const spec = { kind: "heal-prod", target: "ticket:4", contentDigest: "h" };
  g.approve(g.propose(spec).identity, as("owner1"));
  clock = 8 * 60000; assert.equal(g.authorizeExecution(spec).allowed, true);
  clock = 10 * 60000; assert.equal(g.authorizeExecution(spec).allowed, false);
});

test("the delegate approves only escalated effects, recorded on the owner's behalf", () => {
  const g = createEffectGate({});
  const p = g.propose({ kind: "promotion", target: "main", contentDigest: "sha1" });
  assert.throws(() => g.approve(p.identity, as("delegate1")), /cannot approve/);
  g.escalate(p.identity);
  const approval = g.approve(p.identity, as("delegate1"));
  assert.equal(approval.role, "delegate");
  assert.equal(approval.onBehalfOf, "owner");
});

test("a developer may approve a minor heal only when they requested it", () => {
  const g = createEffectGate({});
  const mine = g.propose({ kind: "heal-prod", target: "ticket:8", contentDigest: "h1" },
    { requester: principals.fromAuthenticated({ authorId: "dev1", via: "message" }) });
  assert.equal(g.approve(mine.identity, as("dev1", "message")).role, "requester");
  const theirs = g.propose({ kind: "heal-prod", target: "ticket:8", contentDigest: "h2" });
  assert.throws(() => g.approve(theirs.identity, as("dev1", "message")), /cannot approve/);
});

test("an approval stops working when the approver loses the role", () => {
  let staff = ["delegate1", "dev1"];
  const live = createPrincipals({ ...config, get staffIds() { return staff; } });
  const g = createEffectGate({}, { rolesOf: live.rolesOf });
  const spec = { kind: "promotion", target: "main", contentDigest: "sha1" };
  const p = g.propose(spec);
  g.escalate(p.identity);
  g.approve(p.identity, live.fromAuthenticated({ authorId: "delegate1", via: "decision-button" }));
  assert.equal(g.authorizeExecution(spec).allowed, true);
  staff = ["dev1"]; // delegate removed
  assert.match(g.authorizeExecution(spec).reason, /no longer holds/);
});

test("a candidate without a ticket cannot request privileged execution", () => {
  const g = createEffectGate({});
  assert.throws(() => g.propose({ kind: "heal-prod", target: "x", contentDigest: "h" }, { origin: { kind: "candidate" } }), /finish intake/);
  assert.equal(g.propose({ kind: "investigate-read", target: "x" }, { origin: { kind: "candidate" } }).needsApproval, false);
});

test("a heal the tool rejected cannot be re-planned into the same rejection", () => {
  const g = createEffectGate({});
  const spec = { kind: "heal-prod", target: "ticket:2", contentDigest: "h1", workId: "ticket:2" };
  const p = g.propose(spec);
  g.approve(p.identity, as("owner1"));
  g.beginExecution(p.identity);
  g.recordFailure(p.identity, { definite: true, toolRejected: true, error: "token shape" });
  assert.throws(() => g.propose({ ...spec, contentDigest: "h2" }), /re-planning repeats/);
  g.clearToolRejection("ticket:2");
  assert.equal(g.propose({ ...spec, contentDigest: "h2" }).needsApproval, true);
});

test("failures are definite (retryable) or uncertain (receipt first), and a crash leaves uncertain", () => {
  const g = createEffectGate({});
  const p = g.propose(merge());
  g.approve(p.identity, as("owner1"));
  g.beginExecution(p.identity);
  g.recordFailure(p.identity, { definite: true, error: "422 not mergeable" });
  assert.equal(g.authorizeExecution(merge()).allowed, true); // nothing happened; approval still live
  g.beginExecution(p.identity);
  assert.deepEqual(g.recoverInFlight(), [p.identity]); // process died mid-merge
  assert.equal(g.authorizeExecution(merge()).allowed, false);
  assert.throws(() => g.approve(p.identity, as("owner1")), /uncertain/);
  g.resolveUncertain(p.identity, { receipt: { merged: true, sha: "m1" } });
  assert.equal(g.get(p.identity).state, "done");
});
