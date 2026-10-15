const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { inspectRepository, pruneSafe, archiveCandidates, quarantineStaleDirty } = require("./worktree-lifecycle");

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

describe("worktree lifecycle", () => {
  it("classifies and prunes only clean branches already contained by the base", () => {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "worktree-lifecycle-"));
    const repo = path.join(sandbox, "repo");
    fs.mkdirSync(repo);
    try {
      git(repo, ["init", "-b", "main"]);
      git(repo, ["config", "user.name", "Lifecycle Test"]);
      git(repo, ["config", "user.email", "lifecycle@example.test"]);
      fs.writeFileSync(path.join(repo, "file.txt"), "base\n");
      git(repo, ["add", "."]);
      git(repo, ["commit", "-m", "base"]);

      const safe = path.join(sandbox, "safe");
      const dirty = path.join(sandbox, "dirty");
      const staleDirty = path.join(sandbox, "stale-dirty");
      const unlanded = path.join(sandbox, "unlanded");
      git(repo, ["worktree", "add", "-b", "safe", safe, "main"]);
      git(repo, ["worktree", "add", "-b", "dirty", dirty, "main"]);
      git(repo, ["worktree", "add", "-b", "stale-dirty", staleDirty, "main"]);
      git(repo, ["worktree", "add", "-b", "unlanded", unlanded, "main"]);
      fs.writeFileSync(path.join(dirty, "file.txt"), "dirty\n");
      fs.writeFileSync(path.join(staleDirty, "file.txt"), "stale dirty\n");
      fs.utimesSync(path.join(staleDirty, "file.txt"), new Date("2020-01-01T00:00:00Z"), new Date("2020-01-01T00:00:00Z"));
      fs.writeFileSync(path.join(unlanded, "file.txt"), "committed\n");
      git(unlanded, ["add", "."]);
      git(unlanded, ["commit", "-m", "unlanded"]);

      const report = inspectRepository(repo);
      assert.equal(report.worktrees.find(tree => tree.path === safe).classification, "safe-prune");
      assert.equal(report.worktrees.find(tree => tree.path === dirty).classification, "dirty");
      assert.equal(report.worktrees.find(tree => tree.path === staleDirty).classification, "stale-dirty");
      assert.equal(report.worktrees.find(tree => tree.path === unlanded).classification, "unlanded");

      const actions = pruneSafe([report]);
      assert.equal(actions.length, 1);
      assert.equal(fs.existsSync(safe), false);
      assert.equal(fs.existsSync(dirty), true);
      assert.equal(fs.existsSync(unlanded), true);
    } finally {
      fs.rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it("archives old clean unlanded work before removing its checkout", () => {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "worktree-archive-"));
    const repo = path.join(sandbox, "repo");
    fs.mkdirSync(repo);
    try {
      git(repo, ["init", "-b", "main"]);
      git(repo, ["config", "user.name", "Lifecycle Test"]);
      git(repo, ["config", "user.email", "lifecycle@example.test"]);
      fs.writeFileSync(path.join(repo, "file.txt"), "base\n");
      git(repo, ["add", "."]);
      git(repo, ["commit", "-m", "base"]);
      const worktree = path.join(sandbox, "old-work");
      git(repo, ["worktree", "add", "-b", "old-work", worktree, "main"]);
      fs.writeFileSync(path.join(worktree, "file.txt"), "preserved\n");
      git(worktree, ["add", "."]);
      git(worktree, ["commit", "-m", "preserved work"]);
      execFileSync("git", ["commit", "--amend", "--no-edit", "--date=2020-01-01T00:00:00Z"], {
        cwd: worktree,
        encoding: "utf8",
        env: { ...process.env, GIT_COMMITTER_DATE: "2020-01-01T00:00:00Z" },
      });
      const report = inspectRepository(repo);
      const candidate = report.worktrees.find(tree => tree.path === worktree);
      assert.equal(candidate.classification, "archive-candidate");
      const actions = archiveCandidates([report], { archiveRoot: path.join(sandbox, "archive"), generatedAt: "2026-09-22T00:00:00.000Z" });
      assert.equal(actions[0].ok, true);
      assert.equal(fs.existsSync(worktree), false);
      assert.equal(fs.existsSync(actions[0].bundle), true);
      assert.match(git(repo, ["bundle", "verify", actions[0].bundle]), /old-work/);
      assert.equal(git(repo, ["rev-parse", "refs/heads/old-work"]).trim(), candidate.head);
    } finally {
      fs.rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it("archives old post-merge follow-up work using the same verified path", () => {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "worktree-postmerge-archive-"));
    const repo = path.join(sandbox, "repo");
    fs.mkdirSync(repo);
    try {
      git(repo, ["init", "-b", "main"]);
      git(repo, ["config", "user.name", "Lifecycle Test"]);
      git(repo, ["config", "user.email", "lifecycle@example.test"]);
      fs.writeFileSync(path.join(repo, "file.txt"), "base\n");
      git(repo, ["add", "."]);
      git(repo, ["commit", "-m", "base"]);
      const worktree = path.join(sandbox, "follow-up");
      git(repo, ["worktree", "add", "-b", "follow-up", worktree, "main"]);
      fs.writeFileSync(path.join(worktree, "file.txt"), "follow-up\n");
      git(worktree, ["add", "."]);
      git(worktree, ["commit", "-m", "follow-up"]);
      const report = inspectRepository(repo);
      const candidate = report.worktrees.find(tree => tree.path === worktree);
      candidate.classification = "post-merge-archive-candidate";
      const actions = archiveCandidates([report], { archiveRoot: path.join(sandbox, "archive"), generatedAt: "2026-09-22T00:00:00.000Z" });
      assert.equal(actions[0].ok, true);
      assert.equal(fs.existsSync(worktree), false);
      assert.equal(fs.existsSync(actions[0].bundle), true);
    } finally {
      fs.rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it("quarantines stale dirty tracked and untracked work before forced removal", () => {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "worktree-dirty-quarantine-"));
    const repo = path.join(sandbox, "repo");
    fs.mkdirSync(repo);
    try {
      git(repo, ["init", "-b", "main"]);
      git(repo, ["config", "user.name", "Lifecycle Test"]);
      git(repo, ["config", "user.email", "lifecycle@example.test"]);
      fs.writeFileSync(path.join(repo, "file.txt"), "base\n");
      git(repo, ["add", "."]);
      git(repo, ["commit", "-m", "base"]);
      const worktree = path.join(sandbox, "stale-dirty");
      git(repo, ["worktree", "add", "-b", "stale-dirty", worktree, "main"]);
      fs.writeFileSync(path.join(worktree, "file.txt"), "unfinished\n");
      fs.writeFileSync(path.join(worktree, "notes.txt"), "untracked\n");
      for (const file of ["file.txt", "notes.txt"]) fs.utimesSync(path.join(worktree, file), new Date("2020-01-01T00:00:00Z"), new Date("2020-01-01T00:00:00Z"));
      const report = inspectRepository(repo);
      assert.equal(report.worktrees.find(tree => tree.path === worktree).classification, "stale-dirty");
      const actions = quarantineStaleDirty([report], { archiveRoot: path.join(sandbox, "archive"), generatedAt: "2026-09-22T00:00:00.000Z" });
      assert.equal(actions[0].ok, true);
      assert.equal(fs.existsSync(worktree), false);
      const manifest = JSON.parse(fs.readFileSync(actions[0].manifest, "utf8"));
      assert.ok(manifest.trackedPatch.bytes > 0);
      assert.equal(manifest.untracked.files, 1);
      assert.match(fs.readFileSync(manifest.trackedPatch.file, "utf8"), /unfinished/);
      assert.match(execFileSync("tar", ["-xOzf", manifest.untracked.file, "notes.txt"], { encoding: "utf8" }), /untracked/);
      assert.equal(git(repo, ["rev-parse", "refs/heads/stale-dirty"]).trim(), manifest.head);
    } finally {
      fs.rmSync(sandbox, { recursive: true, force: true });
    }
  });
});
