// code-worktree.js — Safe, structured Git operations for code-agent worktrees.

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

class WorktreeError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "WorktreeError";
    this.statusCode = statusCode;
  }
}

function git(cwd, args, options = {}) {
  try {
    const output = execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      timeout: options.timeout || 10000,
      env: options.env || process.env,
      maxBuffer: options.maxBuffer || 2 * 1024 * 1024,
    });
    return options.trim === false ? output : output.trim();
  } catch (error) {
    const detail = String(error.stderr || error.stdout || error.message || "").trim();
    throw new WorktreeError(detail || `git ${args[0]} failed`, options.statusCode || 500);
  }
}

function parseStatus(raw) {
  if (!raw) return [];
  const records = raw.split("\0");
  const files = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record) continue;
    const index = record[0];
    const worktree = record[1];
    let filePath = record.slice(3);
    if ((index === "R" || index === "C") && records[i + 1]) {
      filePath = `${records[++i]} → ${filePath}`;
    }
    files.push({
      path: filePath,
      index,
      worktree,
      status: index === "?" && worktree === "?" ? "untracked" : `${index}${worktree}`.trim(),
    });
  }
  return files;
}

function inspectWorktree(worktreePath, baseBranch = "development") {
  if (!worktreePath || !fs.existsSync(worktreePath)) {
    return {
      available: false,
      path: worktreePath || null,
      baseBranch,
      dirty: false,
      changedFiles: [],
      error: "Worktree is not initialized",
    };
  }

  try {
    const branch = git(worktreePath, ["branch", "--show-current"]);
    const changedFiles = parseStatus(
      git(worktreePath, ["status", "--porcelain=v1", "-z"], {
        maxBuffer: 8 * 1024 * 1024,
        trim: false,
      })
    );
    // Compare against the remote-tracking ref when it exists. The local base
    // branch can lag origin (e.g. it is checked out in a long-lived worktree
    // that never pulls), which would report a spurious "behind" of every
    // unpulled commit and bloat the PR diff. The `baseBranch` label is kept for
    // display; only the comparison ref is normalized.
    let compareBase = baseBranch;
    if (!baseBranch.includes("/")) {
      try {
        git(worktreePath, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${baseBranch}`]);
        compareBase = `origin/${baseBranch}`;
      } catch {
        // No remote-tracking ref; compare against the local branch.
      }
    }
    let counts = [0, 0];
    let divergenceError = null;
    try {
      counts = git(worktreePath, [
        "rev-list",
        "--left-right",
        "--count",
        `${compareBase}...HEAD`,
      ]).split(/\s+/).map(Number);
    } catch (error) {
      divergenceError = error.message;
    }
    const lastCommitRaw = git(worktreePath, ["log", "-1", "--format=%H%x00%h%x00%s"]);
    const [sha = "", shortSha = "", subject = ""] = lastCommitRaw.split("\0");
    const staged = changedFiles.filter(file => file.index !== " " && file.index !== "?").length;
    const unstaged = changedFiles.filter(file => file.worktree !== " " && file.worktree !== "?").length;
    const untracked = changedFiles.filter(file => file.index === "?" && file.worktree === "?").length;

    return {
      available: true,
      path: path.resolve(worktreePath),
      name: path.basename(worktreePath),
      branch: branch || "detached HEAD",
      baseBranch,
      dirty: changedFiles.length > 0,
      staged,
      unstaged,
      untracked,
      changedFiles,
      behind: Number.isFinite(counts[0]) ? counts[0] : 0,
      ahead: Number.isFinite(counts[1]) ? counts[1] : 0,
      divergenceError,
      lastCommit: { sha, shortSha, subject },
    };
  } catch (error) {
    return {
      available: false,
      path: path.resolve(worktreePath),
      baseBranch,
      dirty: false,
      changedFiles: [],
      error: error.message,
    };
  }
}

function validateCommitMessage(message) {
  const clean = String(message || "").trim();
  if (!clean) throw new WorktreeError("Commit message is required", 400);
  if (clean.length > 240) throw new WorktreeError("Commit message must be 240 characters or fewer", 400);
  if (/[\r\n]/.test(clean)) throw new WorktreeError("Commit message must be a single line", 400);
  return clean;
}

function commitWorktree(worktreePath, message, options = {}) {
  const before = inspectWorktree(worktreePath, options.baseBranch);
  if (!before.available) throw new WorktreeError(before.error || "Worktree is unavailable", 409);
  if (!before.dirty) throw new WorktreeError("There are no uncommitted changes", 409);

  const cleanMessage = validateCommitMessage(message);
  git(worktreePath, ["add", "--all"], { env: options.env, timeout: 15000 });
  git(worktreePath, ["commit", "-m", cleanMessage], {
    env: options.env,
    timeout: options.timeout || 60000,
    statusCode: 422,
  });
  return inspectWorktree(worktreePath, options.baseBranch);
}

module.exports = {
  WorktreeError,
  git,
  inspectWorktree,
  commitWorktree,
  parseStatus,
  validateCommitMessage,
};
