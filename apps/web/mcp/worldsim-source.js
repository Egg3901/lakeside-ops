// Pinned AHDGame source identity for sim_run_world / sim_run_election (#136,
// mirrors AHDGame#1966 contract in scripts/sim/simSource.ts).
//
// Shape-only check at enqueue time: an optional sourceWorktree leaf name plus
// a full 40-hex sourceCommit, both or neither, persisted to simJobs unchanged.
// Existence, HEAD equality, and cleanliness are the AHDGame worker's job at
// claim and pre-spawn time — this MCP never resolves git, accepts paths, or
// mutates worktrees.

// Single registered worktree LEAF name only. No slashes (never a path),
// no dot segments, no whitespace — same token shape as every other
// job-derived value (mirrors scripts/sim/worker.ts assertSafeToken).
const SOURCE_WORKTREE_RE = /^[a-zA-Z0-9_-]{1,64}$/;
// Full lowercase commit SHA only. Short SHAs, branch names, tags, HEAD, and
// uppercase hex all fail — aligned with AHDGame simSource FULL_SHA.
const SOURCE_COMMIT_RE = /^[0-9a-f]{40}$/;

function sourceWorktreeSchema(z) {
  return z
    .string()
    .regex(SOURCE_WORKTREE_RE)
    .optional()
    .describe(
      "Pinned source (#136): registered AHDGame worktree leaf name to execute instead of the worker default. Requires sourceCommit."
    );
}

function sourceCommitSchema(z) {
  return z
    .string()
    .regex(SOURCE_COMMIT_RE)
    .optional()
    .describe(
      "Pinned source (#136): full 40-hex commit SHA that must equal the worktree HEAD. Requires sourceWorktree."
    );
}

// Shape-only check for enqueue time. Returns null when unpinned (legacy
// worker-default behavior). Throws on a half pin or malformed values —
// fail closed, the handler reports the error and enqueues nothing.
function assertSimSourcePin(sourceWorktree, sourceCommit) {
  if (sourceWorktree === undefined && sourceCommit === undefined) return null;
  if (!sourceWorktree || !sourceCommit) {
    throw new Error("sourceWorktree and sourceCommit must both be set (got only one)");
  }
  if (!SOURCE_WORKTREE_RE.test(sourceWorktree)) {
    throw new Error(
      `sourceWorktree must be a single registered worktree leaf name (${SOURCE_WORKTREE_RE}) (got ${JSON.stringify(sourceWorktree)})`
    );
  }
  if (!SOURCE_COMMIT_RE.test(sourceCommit)) {
    throw new Error(
      `sourceCommit must be a full 40-hex commit SHA (got ${JSON.stringify(sourceCommit)})`
    );
  }
  return { sourceWorktree, sourceCommit };
}

function assertCampaignPriceRun(enabled, pin, startPolicy) {
  if (enabled === undefined) return;
  if (typeof enabled !== "boolean") {
    throw new Error("campaignEraPriceLevelEnabled must be boolean");
  }
  if (!pin || startPolicy !== "window") {
    throw new Error("campaignEraPriceLevelEnabled requires a pinned source and startPolicy=window");
  }
}

module.exports = {
  SOURCE_WORKTREE_RE,
  SOURCE_COMMIT_RE,
  sourceWorktreeSchema,
  sourceCommitSchema,
  assertSimSourcePin,
  assertCampaignPriceRun,
};
