#!/usr/bin/env node

// Run only tests owned by this checkout. A broad filesystem glob also enters
// linked worktrees stored below the repository and executes stale dependencies.

const { execFileSync, spawnSync } = require("child_process");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const files = execFileSync("git", ["ls-files", "--full-name", "-z", "--", "."], {
  cwd: repoRoot,
  encoding: "utf8",
}).split("\0").filter((file) => file.endsWith(".test.js"))
  .map((file) => path.relative(repoRoot, path.join(execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: repoRoot, encoding: "utf8" }).trim(), file)));

if (files.length === 0) {
  console.error("No tracked tests found.");
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...files], {
  cwd: repoRoot,
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exit(result.status === null ? 1 : result.status);
