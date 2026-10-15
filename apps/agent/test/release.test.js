"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildScopeManifest, evaluateGates, evaluateDesktopGates, ticketReleaseState } = require("../lib/operator/release");

// Fixtures replay the shapes from the 2026-10-13 audits with synthetic ids:
// a ticket promotion carrying unrelated gameplay scope, staging evidence
// standing alone, a lagging turn worker, and a desktop tag with no release.

test("unrelated sensitive scope in a promotion is flagged for an owner call", () => {
  const m = buildScopeManifest([
    { id: "pr-fix", tickets: [1530], areas: ["economy"] },
    { id: "pr-autopilot", tickets: [], areas: ["gameplay"] },
    { id: "pr-copy", tickets: [], areas: ["ui"] },
  ]);
  assert.equal(m.verdict, "needs-scope-approval");
  assert.deepEqual(m.flagged, ["pr-autopilot"]);
  assert.deepEqual(m.linkedTickets, [1530]);
  const approved = buildScopeManifest([
    { id: "pr-autopilot", tickets: [], areas: ["gameplay"] },
  ], { approvedExtraIds: ["pr-autopilot"] });
  assert.equal(approved.verdict, "clean");
});

test("staging success never proves production or worker deployment", () => {
  const r = evaluateGates({ promotionHeadSha: "abc", ciHeadSha: "abc", ciGreen: true,
    stagingDeployedSha: "abc" });
  assert.equal(r.gates.staging.status, "pass");
  assert.equal(r.gates.prodWeb.status, "unknown");
  assert.equal(r.gates.worker.status, "unknown");
  assert.equal(r.verdict, "unverified");
});

test("a lagging turn worker blocks verification even with web deployed", () => {
  const r = evaluateGates({ promotionHeadSha: "abc", ciHeadSha: "abc", ciGreen: true,
    stagingDeployedSha: "abc", prodWebSha: "abc", turnWorkerSha: "old" }, { contains: (sha) => sha !== "old" });
  assert.equal(r.gates.worker.status, "fail");
  assert.equal(r.verdict, "blocked");
  const ok = evaluateGates({ promotionHeadSha: "abc", ciHeadSha: "abc", ciGreen: true,
    stagingDeployedSha: "abc", prodWebSha: "abc", turnWorkerSha: "abc" });
  assert.equal(ok.verdict, "verified");
});

test("CI green on a different head does not count", () => {
  const r = evaluateGates({ promotionHeadSha: "new", ciHeadSha: "old", ciGreen: true });
  assert.equal(r.gates.ci.status, "fail");
});

test("a desktop tag alone is neither published nor verified", () => {
  const r = evaluateDesktopGates({ tagExists: true, releasePublished: false });
  assert.equal(r.gates.tagged.status, "pass");
  assert.equal(r.gates.published.status, "fail");
  assert.equal(r.verdict, "blocked");
});

test("ticket state advances only over evidenced stages in order", () => {
  const s = ticketReleaseState({ prepared: true, inPr: true, ciGreen: true, onDevelopment: true });
  assert.equal(s.stage, "development");
  assert.equal(s.playerLabel, "in testing");
  assert.equal(s.canClaimLive, false);
  const full = ticketReleaseState({ prepared: true, inPr: true, ciGreen: true, onDevelopment: true,
    onStaging: true, onMain: true, webDeployed: true, workerDeployed: true, liveVerified: true });
  assert.equal(full.stage, "live-verified");
  assert.equal(full.canClaimLive, true);
});

test("skipping the staging waypoint is surfaced, not papered over", () => {
  const s = ticketReleaseState({ prepared: true, inPr: true, ciGreen: true,
    onDevelopment: true, onMain: true, webDeployed: true });
  assert.equal(s.stage, "development");
  assert.equal(s.nextGate, "staging");
  assert.equal(s.inconsistent, true);
  assert.equal(s.canClaimLive, false);
});

test("merged to development is never described as live", () => {
  const s = ticketReleaseState({ prepared: true, inPr: true, ciGreen: true, onDevelopment: true, onStaging: true, onMain: true });
  assert.equal(s.playerLabel, "being released");
  assert.notEqual(s.playerLabel, "live");
});
