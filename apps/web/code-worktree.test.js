const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  inspectWorktree,
  commitWorktree,
  parseStatus,
  validateCommitMessage,
} = require("./code-worktree");

describe("code worktree Git harness", () => {
  let repo;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "code-worktree-"));
    execFileSync("git", ["init", "-b", "development"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "Code Agent Test"], { cwd: repo });
    execFileSync("git", ["config", "user.email", "code-agent@example.test"], { cwd: repo });
    fs.writeFileSync(path.join(repo, "tracked.txt"), "first\n");
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["commit", "-m", "initial"], { cwd: repo });
    execFileSync("git", ["switch", "-c", "code-agent/test"], { cwd: repo });
  });

  afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

  it("reports branch, divergence, commit, and each dirty state", () => {
    fs.writeFileSync(path.join(repo, "tracked.txt"), "changed\n");
    fs.writeFileSync(path.join(repo, "new.txt"), "new\n");
    execFileSync("git", ["add", "tracked.txt"], { cwd: repo });

    const snapshot = inspectWorktree(repo, "development");
    assert.equal(snapshot.available, true);
    assert.equal(snapshot.branch, "code-agent/test");
    assert.equal(snapshot.dirty, true);
    assert.equal(snapshot.staged, 1);
    assert.equal(snapshot.untracked, 1);
    assert.equal(snapshot.ahead, 0);
    assert.equal(snapshot.behind, 0);
    assert.equal(snapshot.lastCommit.subject, "initial");
    assert.deepEqual(snapshot.changedFiles.map(file => file.path).sort(), ["new.txt", "tracked.txt"]);
  });

  it("commits all changes and returns the clean, ahead snapshot", () => {
    fs.writeFileSync(path.join(repo, "tracked.txt"), "changed\n");
    fs.writeFileSync(path.join(repo, "new.txt"), "new\n");

    const snapshot = commitWorktree(repo, "feat: save agent result", { baseBranch: "development" });
    assert.equal(snapshot.dirty, false);
    assert.equal(snapshot.ahead, 1);
    assert.equal(snapshot.lastCommit.subject, "feat: save agent result");
  });

  it("rejects empty, multiline, and needless commits", () => {
    assert.throws(() => validateCommitMessage("  "), /required/);
    assert.throws(() => validateCommitMessage("one\ntwo"), /single line/);
    assert.throws(
      () => commitWorktree(repo, "chore: no changes", { baseBranch: "development" }),
      /no uncommitted changes/
    );
  });

  it("surfaces commit-hook failures instead of pretending the commit succeeded", () => {
    fs.writeFileSync(path.join(repo, "tracked.txt"), "changed\n");
    const hook = path.join(repo, ".git", "hooks", "pre-commit");
    fs.writeFileSync(hook, "#!/bin/sh\necho 'verification failed' >&2\nexit 1\n");
    fs.chmodSync(hook, 0o755);

    assert.throws(
      () => commitWorktree(repo, "feat: should fail", { baseBranch: "development" }),
      /verification failed/
    );
    const snapshot = inspectWorktree(repo, "development");
    assert.equal(snapshot.dirty, true);
    assert.equal(snapshot.ahead, 0);
  });

  it("parses rename records without leaking the second status record", () => {
    assert.deepEqual(parseStatus("R  new.js\0old.js\0"), [{
      path: "old.js → new.js",
      index: "R",
      worktree: " ",
      status: "R",
    }]);
  });
});
