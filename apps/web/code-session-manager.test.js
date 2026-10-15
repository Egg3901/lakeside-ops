const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.CODE_AGENT_WORKTREE_BASE = fs.mkdtempSync(path.join(os.tmpdir(), "code-agent-manager-test-worktrees-"));
const { createSessionManager } = require("./code-session-manager");

function fakeDb(session) {
  const collection = {
    async findOne(query) {
      return query.sessionId === session.sessionId ? { ...session } : null;
    },
    async updateOne(query, update) {
      if (query.sessionId === session.sessionId && update.$set) Object.assign(session, update.$set);
      return { modifiedCount: 1 };
    },
    async deleteOne(query) {
      if (query.sessionId === session.sessionId) session.deleted = true;
      return { deletedCount: 1 };
    },
  };
  return { collection: () => collection };
}

describe("code session Git lifecycle", () => {
  let repo;
  let sandbox;
  let worktree;
  let session;
  let manager;

  beforeEach(() => {
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "code-session-manager-"));
    repo = path.join(sandbox, "repo");
    worktree = path.join(sandbox, "worktree");
    fs.mkdirSync(repo);
    execFileSync("git", ["init", "-b", "development"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "Code Agent Test"], { cwd: repo });
    execFileSync("git", ["config", "user.email", "code-agent@example.test"], { cwd: repo });
    fs.writeFileSync(path.join(repo, "tracked.txt"), "first\n");
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["commit", "-m", "initial"], { cwd: repo });
    execFileSync("git", ["worktree", "add", "-b", "code-agent/test", worktree, "development"], { cwd: repo });
    session = {
      sessionId: "cs_test",
      title: "Improve harness",
      branchName: "code-agent/test",
      baseBranch: "development",
      worktreePath: worktree,
    };
    manager = createSessionManager(fakeDb(session), { repoDir: repo });
  });

  afterEach(() => fs.rmSync(sandbox, { recursive: true, force: true }));

  it("commits through the manager and returns the reusable workspace snapshot", async () => {
    fs.writeFileSync(path.join(worktree, "tracked.txt"), "changed\n");
    const result = await manager.commitChanges(session.sessionId, "feat: improve harness");

    assert.equal(result.commit.subject, "feat: improve harness");
    assert.equal(result.workspace.dirty, false);
    assert.equal(result.workspace.ahead, 1);
    assert.equal(manager.getWorkspaceSnapshot(session).lastCommit.shortSha, result.commit.shortSha);
  });

  it("refuses to create a PR while changes are uncommitted", async () => {
    fs.writeFileSync(path.join(worktree, "tracked.txt"), "changed\n");

    await assert.rejects(
      manager.createPR(session.sessionId),
      error => error.statusCode === 409 && /Commit the worktree changes/.test(error.message)
    );
  });

  it("caches routine snapshots but supports an immediate refresh after agent edits", () => {
    const clean = manager.getWorkspaceSnapshot(session);
    fs.writeFileSync(path.join(worktree, "tracked.txt"), "changed\n");

    assert.equal(manager.getWorkspaceSnapshot(session), clean);
    assert.equal(manager.getWorkspaceSnapshot(session, { fresh: true }).dirty, true);
  });

  it("locks newly created session worktrees while they are active", async () => {
    execFileSync("git", ["worktree", "remove", worktree], { cwd: repo });
    execFileSync("git", ["branch", "-d", "code-agent/test"], { cwd: repo });
    session.worktreePath = null;
    session.branchName = null;

    const created = await manager.initializeWorktree(session.sessionId, "Lease protected task");
    const porcelain = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: repo, encoding: "utf8" });
    const block = porcelain.split("\n\n").find(item => item.includes(`worktree ${created.worktreePath}`));

    assert.match(block || "", /locked active Ops session cs_test/);
  });

  it("preserves a dirty worktree and session when deletion is requested", async () => {
    fs.writeFileSync(path.join(worktree, "tracked.txt"), "valuable uncommitted work\n");

    await assert.rejects(
      manager.deleteSession(session.sessionId),
      error => error.statusCode === 409 && /uncommitted/i.test(error.message)
    );

    assert.equal(fs.existsSync(worktree), true);
    assert.equal(session.deleted, undefined);
    assert.equal(execFileSync("git", ["branch", "--list", session.branchName], { cwd: repo, encoding: "utf8" }).trim() !== "", true);
  });

  it("preserves clean work that has not landed on the base branch", async () => {
    fs.writeFileSync(path.join(worktree, "tracked.txt"), "valuable committed work\n");
    execFileSync("git", ["add", "tracked.txt"], { cwd: worktree });
    execFileSync("git", ["commit", "-m", "feat: valuable work"], { cwd: worktree });

    await assert.rejects(
      manager.deleteSession(session.sessionId),
      error => error.statusCode === 409 && /not landed/i.test(error.message)
    );

    assert.equal(fs.existsSync(worktree), true);
    assert.equal(session.deleted, undefined);
  });

  it("removes a clean worktree only when its branch is already on the base", async () => {
    assert.equal(await manager.deleteSession(session.sessionId), true);

    assert.equal(fs.existsSync(worktree), false);
    assert.equal(session.deleted, true);
    assert.equal(execFileSync("git", ["branch", "--list", session.branchName], { cwd: repo, encoding: "utf8" }).trim(), "");
  });
});
