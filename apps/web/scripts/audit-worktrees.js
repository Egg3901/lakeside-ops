#!/usr/bin/env node

// Inventory linked worktrees without mutating them. Strict mode exits non-zero
// when any secondary checkout contains uncommitted or unlanded work.

const { execFileSync } = require("child_process");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");

function git(args, cwd = repoRoot) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  }).trim();
}

function parseWorktrees(raw) {
  return raw.split("\n\n").filter(Boolean).map(block => {
    const fields = {};
    for (const line of block.split("\n")) {
      const space = line.indexOf(" ");
      fields[space === -1 ? line : line.slice(0, space)] = space === -1 ? true : line.slice(space + 1);
    }
    return fields;
  });
}

function remoteBase() {
  for (const candidate of ["origin/main", "origin/development", "main", "development"]) {
    try {
      git(["rev-parse", "--verify", "--quiet", candidate]);
      return candidate;
    } catch {}
  }
  throw new Error("No main or development base branch found");
}

const base = remoteBase();
const primary = path.resolve(git(["rev-parse", "--show-toplevel"]));
const rows = parseWorktrees(git(["worktree", "list", "--porcelain"])).map(item => {
  const checkout = path.resolve(item.worktree);
  const dirty = git(["status", "--porcelain"], checkout).split("\n").filter(Boolean);
  const cherry = git(["cherry", base, item.HEAD], checkout).split("\n").filter(Boolean);
  const unlanded = cherry.filter(line => line.startsWith("+ "));
  return {
    path: checkout,
    branch: String(item.branch || "detached").replace("refs/heads/", ""),
    primary: checkout === primary,
    dirty: dirty.length,
    untracked: dirty.filter(line => line.startsWith("??")).length,
    unlanded: unlanded.length,
    patchEquivalent: cherry.length - unlanded.length,
    head: item.HEAD.slice(0, 10),
  };
});

console.table(rows);
const secondary = rows.filter(row => !row.primary);
const unsafe = secondary.filter(row => row.dirty > 0 || row.unlanded > 0);
const safelyPrunable = secondary.filter(row => row.dirty === 0 && row.unlanded === 0);
console.log(JSON.stringify({
  base,
  registered: rows.length,
  unsafe: unsafe.length,
  dirty: secondary.filter(row => row.dirty > 0).length,
  unlanded: secondary.filter(row => row.unlanded > 0).length,
  safelyPrunable: safelyPrunable.length,
}, null, 2));

if (process.argv.includes("--strict") && unsafe.length > 0) process.exit(1);
