const test = require("node:test");
const assert = require("node:assert/strict");
const { makeWorktreeBody } = require("./worktree-page");

test("worktree page renders lifecycle evidence and escapes repository data", () => {
  const result = makeWorktreeBody({
    generatedAt: "2026-09-22T00:00:00Z",
    before: { classifications: { dirty: 1 } },
    repositories: [{
      repository: "/root/projects/<unsafe>",
      base: "origin/main",
      worktrees: [{ path: "/root/projects/<unsafe>/worktrees/a", branch: "feat/a", primary: false, dirty: 2, patchUnique: 1, classification: "dirty" }],
    }],
  });
  assert.match(result.body, /Worktree lifecycle/);
  assert.match(result.body, /2 dirty, 1 unlanded/);
  assert.doesNotMatch(result.body, /<unsafe>/);
  assert.match(result.body, /&lt;unsafe&gt;/);
});
