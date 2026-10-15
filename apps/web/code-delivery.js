"use strict";

const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { primaryRepoDir } = require("./src/core/paths");

const cache = new Map();
const prCache = new Map();
const ancestorCache = new Map();
const CACHE_MS = 5000;
const PR_CACHE_MS = 30000;
const ANCESTOR_CACHE_MS = 30000;

function run(cwd, command, args, timeout = 4000) {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: "utf8",
      timeout,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function checkState(checks) {
  const list = Array.isArray(checks) ? checks : [];
  if (list.some((check) => check.conclusion === "FAILURE" || check.conclusion === "CANCELLED")) return "failed";
  if (list.some((check) => !check.conclusion || check.status !== "COMPLETED")) return "running";
  return list.length ? "passed" : "unknown";
}

function deriveDeliveryState(snapshot) {
  const dirty = snapshot.dirty || 0;
  const ahead = snapshot.ahead || 0;
  const pr = snapshot.pr || null;
  const prMerged = pr?.state === "MERGED";
  const onDevelopment = snapshot.branch === "development";
  const developmentDone = onDevelopment || prMerged;
  const stagingDone = !!snapshot.developmentInStaging;
  const productionDone = !!snapshot.stagingInMaster;
  const checks = checkState(pr?.statusCheckRollup);
  let phase = "clean";
  let headline = "Worktree ready";
  let detail = "No local changes yet.";
  if (dirty) {
    phase = "changes";
    headline = `${dirty} uncommitted change${dirty === 1 ? "" : "s"}`;
    detail = "Checkpoint will verify, commit, and land this work on development.";
  } else if (ahead && !pr) {
    phase = "committed";
    headline = `${ahead} commit${ahead === 1 ? "" : "s"} ready for PR`;
    detail = "The work is committed locally but has not landed on development.";
  } else if (pr && !prMerged) {
    phase = checks === "failed" ? "blocked" : "review";
    headline = `PR #${pr.number} ${pr.isDraft ? "is draft" : checks === "running" ? "is checking" : "is open"}`;
    detail = checks === "failed" ? "A required check failed; fix it before merging." : "Waiting to merge into development.";
  } else if (developmentDone && !productionDone) {
    phase = "release";
    headline = "Checkpoint landed on development";
    detail = stagingDone ? "Staging is synced; production still needs promotion." : "Ready to promote through staging and production.";
  } else if (developmentDone && productionDone) {
    phase = "complete";
    headline = "Release pipeline complete";
    detail = "Development, staging, and production are synchronized.";
  }
  return {
    phase,
    headline,
    detail,
    checks,
    steps: [
      { id: "worktree", label: "Worktree", state: dirty ? "active" : "done" },
      { id: "commit", label: "Commit", state: ahead || developmentDone ? "done" : dirty ? "next" : "idle" },
      { id: "pr", label: pr ? `PR #${pr.number}` : "PR", state: prMerged || onDevelopment ? "done" : pr ? (checks === "failed" ? "failed" : "active") : ahead ? "next" : "idle", url: pr?.url || null },
      { id: "development", label: "Dev", state: developmentDone ? "done" : pr ? "next" : "idle" },
      { id: "staging", label: "Staging", state: stagingDone ? "done" : developmentDone ? "next" : "idle" },
      { id: "master", label: "Production", state: productionDone ? "done" : stagingDone ? "next" : "idle" },
    ],
  };
}

function collectDeliveryStatus(cwd) {
  const requested = String(cwd || "");
  if (!requested) return { eligible: false };
  const cached = cache.get(requested);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const root = run(requested, "git", ["rev-parse", "--show-toplevel"]);
  const common = run(requested, "git", ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const ahdRepo = primaryRepoDir();
  const eligible = root && ahdRepo && (
    root === ahdRepo
    || root.startsWith(`${ahdRepo}${path.sep}`)
    || common === path.join(ahdRepo, ".git")
  );
  if (!eligible) {
    const value = { eligible: false };
    cache.set(requested, { at: Date.now(), value });
    return value;
  }

  // Batch branch + dirty status into a single `git status --porcelain --branch`
  // call instead of two separate forks. The header line `## branch...upstream`
  // gives us the current branch; the rest are dirty entries.
  const porcelainBranch = run(root, "git", ["status", "--porcelain=v1", "--branch"]);
  const statusLines = porcelainBranch ? porcelainBranch.split("\n").filter(Boolean) : [];
  const header = statusLines.length && statusLines[0].startsWith("## ") ? statusLines[0] : "## detached";
  const branch = header.slice(3).split("...")[0].split(" ")[0] || "detached";
  const dirtyLines = statusLines.filter((line) => !line.startsWith("## "));
  const staged = dirtyLines.filter((line) => line[0] && line[0] !== " " && line[0] !== "?").length;
  const untracked = dirtyLines.filter((line) => line.startsWith("??")).length;
  const counts = run(root, "git", ["rev-list", "--left-right", "--count", `development...HEAD`]).split(/\s+/).map(Number);
  const last = run(root, "git", ["log", "-1", "--pretty=format:%h%x09%s"]).split("\t");
  let pr = null;
  if (branch !== "development" && branch !== "master" && branch !== "staging" && branch !== "detached") {
    const prKey = `${root}:${branch}`;
    const cachedPr = prCache.get(prKey);
    if (cachedPr && Date.now() - cachedPr.at < PR_CACHE_MS) {
      pr = cachedPr.value;
    } else {
      const raw = run(root, "gh", [
        "pr", "list", "--head", branch, "--state", "all", "--limit", "1",
        "--json", "number,url,state,isDraft,title,baseRefName,statusCheckRollup",
      ], 4000);
      try { pr = JSON.parse(raw || "[]")[0] || null; } catch {}
      prCache.set(prKey, { at: Date.now(), value: pr });
    }
  }
  // Ancestor checks (development→staging, staging→master) are repo-global, not
  // worktree-specific — cache at module level so a second open session doesn't
  // re-fork the same merge-base probes within 30 s.
  const isAncestor = (older, newer) => {
    const key = `${older}:${newer}`;
    const hit = ancestorCache.get(key);
    if (hit && Date.now() - hit.at < ANCESTOR_CACHE_MS) return hit.value;
    let value = false;
    try {
      execFileSync("git", ["merge-base", "--is-ancestor", older, newer], {
        cwd: root, timeout: 3000, stdio: "ignore",
      });
      value = true;
    } catch {}
    ancestorCache.set(key, { at: Date.now(), value });
    return value;
  };
  const snapshot = {
    branch,
    dirty: dirtyLines.length,
    staged,
    untracked,
    behind: Number.isFinite(counts[0]) ? counts[0] : 0,
    ahead: Number.isFinite(counts[1]) ? counts[1] : 0,
    lastCommit: { sha: last[0] || "", subject: last[1] || "" },
    pr,
    developmentInStaging: isAncestor("development", "staging"),
    stagingInMaster: isAncestor("staging", "master"),
  };
  const value = { eligible: true, ...snapshot, ...deriveDeliveryState(snapshot) };
  cache.set(requested, { at: Date.now(), value });
  return value;
}

module.exports = { checkState, collectDeliveryStatus, deriveDeliveryState };
