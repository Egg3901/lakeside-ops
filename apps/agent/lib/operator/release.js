"use strict";
// Keir 3.0 F1, Release Copilot core. Pure decisions over explicit evidence:
// what is actually in a promotion, which verification gates have really
// passed, and how far each ticket's fix has verifiably travelled.
// Born from the 2026-10-13 release audit, where unrelated gameplay scope
// rode a ticket promotion, a staging check stood in for production deploy
// evidence, and the turn worker lagged main. The rule throughout: no gate
// is ever inferred from another gate. Missing evidence is "unknown",
// never "pass".

const SENSITIVE_AREAS = ["gameplay", "economy", "balance", "money", "moderation", "policy"];

// Ordered. A ticket's fix may only claim a stage when every earlier stage
// is also evidenced; player-facing copy derives from this and nothing else.
const TICKET_STAGES = ["prepared", "in-pr", "ci-green", "development", "staging",
  "main", "deployed-web", "deployed-worker", "live-verified"];
const STAGE_FACTS = ["prepared", "inPr", "ciGreen", "onDevelopment", "onStaging",
  "onMain", "webDeployed", "workerDeployed", "liveVerified"];
const PLAYER_LABELS = {
  prepared: "being prepared", "in-pr": "being prepared", "ci-green": "in testing",
  development: "in testing", staging: "in testing", main: "being released",
  "deployed-web": "being released", "deployed-worker": "being released",
  "live-verified": "live",
};

// items: [{ id, tickets: [n], areas: [..] }] as classified by the caller from
// real PR data. This module judges scope, it does not guess it from titles.
function buildScopeManifest(items, { approvedExtraIds = [] } = {}) {
  const approved = new Set(approvedExtraIds);
  const manifest = items.map((item) => {
    const linked = (item.tickets || []).length > 0;
    const sensitive = (item.areas || []).filter((a) => SENSITIVE_AREAS.includes(a));
    const needsScopeApproval = !linked && sensitive.length > 0 && !approved.has(item.id);
    return { id: item.id, tickets: item.tickets || [], linked, sensitiveAreas: sensitive,
      needsScopeApproval, approvedExtra: approved.has(item.id) };
  });
  const flagged = manifest.filter((m) => m.needsScopeApproval);
  return {
    items: manifest,
    linkedTickets: [...new Set(manifest.flatMap((m) => m.tickets))].sort((a, b) => a - b),
    unrelated: manifest.filter((m) => !m.linked).map((m) => m.id),
    flagged: flagged.map((m) => m.id),
    verdict: flagged.length ? "needs-scope-approval" : "clean",
  };
}

const eq = (a, b) => Boolean(a && b && a === b);
const gate = (status, reason) => ({ status, reason });

// evidence: exact SHAs and receipts observed by adapters. Every gate reads
// only its own evidence field. CI must be green on the exact head. A deploy
// gate passes when the deployed SHA is the promotion head or contains it:
// merge-commit promotes put a new merge SHA on main, and later deploys move
// past the head. contains(deployedSha, headSha) answers ancestry from git;
// without an answer an unequal SHA is unknown, never pass and never fail.
function evaluateGates(e = {}, { contains = () => undefined } = {}) {
  const ci = e.ciHeadSha === undefined && e.ciGreen === undefined
    ? gate("unknown", "no CI evidence supplied")
    : eq(e.ciHeadSha, e.promotionHeadSha) && e.ciGreen === true
      ? gate("pass", "CI green on the exact promotion head")
      : gate("fail", "CI is not green on the exact promotion head");
  const shaGate = (sha, label) => {
    if (sha === undefined || sha === null) return gate("unknown", `no ${label} evidence supplied`);
    if (eq(sha, e.promotionHeadSha)) return gate("pass", `${label} serves the promotion head`);
    if (!e.promotionHeadSha) return gate("unknown", "no promotion head to compare");
    const has = contains(sha, e.promotionHeadSha);
    return has === true ? gate("pass", `${label} serves a commit containing the promotion head`)
      : has === false ? gate("fail", `${label} does not contain the promotion head`)
        : gate("unknown", `${label} serves a different commit; ancestry not established`);
  };
  const staging = shaGate(e.stagingDeployedSha, "staging");
  const prodWeb = shaGate(e.prodWebSha, "production web");
  const worker = shaGate(e.turnWorkerSha, "turn worker");
  const gates = { ci, staging, prodWeb, worker };
  const statuses = Object.values(gates).map((g) => g.status);
  return { gates, verdict: statuses.includes("fail") ? "blocked"
    : statuses.includes("unknown") ? "unverified" : "verified" };
}

// Desktop releases have their own non-inference trap: a git tag is not a
// published release, and a published release is not verified assets.
function evaluateDesktopGates(e = {}) {
  const bool = (v, label) => v === undefined ? gate("unknown", `no ${label} evidence supplied`)
    : v === true ? gate("pass", label) : gate("fail", label);
  const gates = {
    tagged: bool(e.tagExists, "version tag exists"),
    published: bool(e.releasePublished, "release is published"),
    assets: bool(e.assetsVerified, "release assets verified"),
    smoke: bool(e.packagedSmokePassed, "packaged smoke passed (confirm, file pickers, external links)"),
  };
  const statuses = Object.values(gates).map((g) => g.status);
  return { gates, verdict: statuses.includes("fail") ? "blocked"
    : statuses.includes("unknown") ? "unverified" : "verified" };
}

function ticketReleaseState(facts = {}) {
  let stage = null, gap = null;
  for (let i = 0; i < STAGE_FACTS.length; i++) {
    if (facts[STAGE_FACTS[i]] === true) {
      if (gap === null) stage = TICKET_STAGES[i];
    } else if (gap === null) gap = TICKET_STAGES[i];
  }
  // A later fact true across an unevidenced earlier stage is an
  // inconsistency to surface, never a shortcut to the later claim.
  const inconsistent = gap !== null
    && STAGE_FACTS.slice(TICKET_STAGES.indexOf(gap) + 1).some((f) => facts[f] === true);
  return { stage: stage || "none", nextGate: gap, inconsistent,
    playerLabel: stage ? PLAYER_LABELS[stage] : "being looked at",
    canClaimLive: stage === "live-verified" && !inconsistent };
}

module.exports = { SENSITIVE_AREAS, TICKET_STAGES, buildScopeManifest,
  evaluateGates, evaluateDesktopGates, ticketReleaseState };
