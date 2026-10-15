#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

function isGeneratedNoise(file) {
  const normalized = file.replaceAll("\\", "/").replace(/^\.\//, "");
  const parts = normalized.split("/");
  const base = parts.at(-1) || "";
  if (parts.some(part => ["node_modules", "target-local", "__pycache__", ".muse-tmp", ".test-tmp"].includes(part))) return true;
  return /^(?:muse(?:-[a-z0-9-]+)?|phase\d+-run(?:\.old)?)\.log$/i.test(base) || /^muse.*\.log$/i.test(base);
}

function untrackedEntries(worktree) {
  const output = execFileSync("git", ["status", "--porcelain=v1", "-z"], {
    cwd: worktree,
    encoding: "utf8",
    timeout: 20_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  return output.split("\0").filter(Boolean).map(entry => ({ status: entry.slice(0, 2), file: entry.slice(3) }));
}

function cleanReport(report, { apply = false } = {}) {
  const actions = [];
  for (const repository of report.repositories || []) {
    for (const tree of repository.worktrees || []) {
      if (tree.primary || !fs.existsSync(tree.path)) continue;
      let entries;
      try { entries = untrackedEntries(tree.path); } catch (error) {
        actions.push({ path: tree.path, eligible: false, error: error.message });
        continue;
      }
      if (!entries.length || entries.some(entry => entry.status !== "??" || !isGeneratedNoise(entry.file))) continue;
      const targets = entries.map(entry => {
        const target = path.resolve(tree.path, entry.file);
        if (target !== tree.path && !target.startsWith(`${path.resolve(tree.path)}${path.sep}`)) {
          throw new Error(`Refusing path outside worktree: ${entry.file}`);
        }
        return { file: entry.file, target };
      });
      if (apply) {
        for (const { target } of targets) fs.rmSync(target, { recursive: true, force: false });
      }
      actions.push({ repository: repository.repository, path: tree.path, branch: tree.branch, eligible: true, applied: apply, files: targets.map(item => item.file) });
    }
  }
  return actions;
}

function main() {
  const reportArg = process.argv.find(arg => arg.startsWith("--report="));
  const reportPath = path.resolve(reportArg ? reportArg.slice("--report=".length) : path.join(__dirname, "..", "data", "worktree-fleet-latest.json"));
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const actions = cleanReport(report, { apply: process.argv.includes("--apply") });
  console.log(JSON.stringify({ report: reportPath, eligible: actions.filter(action => action.eligible).length, actions }, null, 2));
}

if (require.main === module) main();

module.exports = { cleanReport, isGeneratedNoise };
