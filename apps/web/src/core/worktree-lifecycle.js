const { execFile, execFileSync } = require("child_process");
const { promisify } = require("util");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

class WorktreeLifecycleError extends Error {}
const execFileAsync = promisify(execFile);

function runGit(cwd, args, options = {}) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      timeout: options.timeout || 20000,
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    if (options.allowFailure) return null;
    throw new WorktreeLifecycleError(String(error.stderr || error.message).trim());
  }
}

function discoverRepositories(roots) {
  const repositories = new Map();
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const markers = execFileSync("find", [root, "-maxdepth", "4", "-type", "d", "-name", ".git"], {
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 16 * 1024 * 1024,
    }).trim().split("\n").filter(Boolean);
    for (const marker of markers) {
      const repository = path.dirname(marker);
      if (repository.includes("/node_modules/") || repository.includes("/.cache/")) continue;
      const commonDir = runGit(repository, ["rev-parse", "--path-format=absolute", "--git-common-dir"], { allowFailure: true });
      if (commonDir) repositories.set(commonDir, repository);
    }
  }
  return [...repositories.values()].sort();
}

function chooseBase(repository) {
  const remoteHead = runGit(repository, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"], { allowFailure: true });
  const candidates = [remoteHead?.replace("refs/remotes/", ""), "origin/main", "origin/development", "origin/master", "main", "development", "master"].filter(Boolean);
  for (const candidate of candidates) {
    if (runGit(repository, ["rev-parse", "--verify", "--quiet", candidate], { allowFailure: true })) return candidate;
  }
  return null;
}

function parseWorktreeList(raw) {
  return raw.split("\n\n").filter(Boolean).map(block => Object.fromEntries(block.split("\n").map(line => {
    const at = line.indexOf(" ");
    return at === -1 ? [line, true] : [line.slice(0, at), line.slice(at + 1)];
  })));
}

function commitAgeDays(repository, head, now = Date.now()) {
  if (!head) return null;
  const raw = runGit(repository, ["show", "-s", "--format=%ct", head], { allowFailure: true });
  if (!raw || !/^\d+$/.test(raw)) return null;
  return Math.floor((now - Number(raw) * 1000) / 86400000);
}

function statusPath(entry) {
  const value = String(entry || "");
  const withoutStatus = value.replace(/^[ MADRCU?!]{1,2} /, "");
  const renameTarget = withoutStatus.includes(" -> ") ? withoutStatus.split(" -> ").at(-1) : withoutStatus;
  return renameTarget.replace(/^"|"$/g, "");
}

function dirtyAgeDays(checkout, entries, headAgeDays, now = Date.now()) {
  const mtimes = (entries || []).map(statusPath).filter(Boolean).map(file => {
    try { return fs.statSync(path.resolve(checkout, file)).mtimeMs; } catch { return null; }
  }).filter(value => value !== null);
  if (!mtimes.length) return headAgeDays;
  return Math.max(0, Math.floor((now - Math.max(...mtimes)) / 86400000));
}

async function runGitAsync(cwd, args, options = {}) {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      encoding: "utf8",
      timeout: options.timeout || 20000,
      maxBuffer: 32 * 1024 * 1024,
    });
    return stdout.trim();
  } catch (error) {
    if (options.allowFailure) return null;
    throw new WorktreeLifecycleError(String(error.stderr || error.message).trim());
  }
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function inspectRepository(repository) {
  const primary = path.resolve(runGit(repository, ["rev-parse", "--show-toplevel"]));
  const base = chooseBase(repository);
  const worktrees = parseWorktreeList(runGit(repository, ["worktree", "list", "--porcelain"])).map(item => {
    const checkout = path.resolve(item.worktree);
    const status = runGit(checkout, ["status", "--porcelain=v1"], { allowFailure: true });
    const dirtyEntries = status === null ? null : status.split("\n").filter(Boolean);
    const head = item.HEAD;
    let patchUnique = null;
    let ancestor = null;
    if (base && head) {
      const cherry = runGit(checkout, ["cherry", base, head], { allowFailure: true });
      patchUnique = cherry === null ? null : cherry.split("\n").filter(line => line.startsWith("+ ")).length;
      ancestor = runGit(checkout, ["merge-base", "--is-ancestor", head, base], { allowFailure: true }) !== null;
    }
    const isPrimary = checkout === primary;
    const locked = Object.prototype.hasOwnProperty.call(item, "locked");
    const ageDays = commitAgeDays(repository, head);
    const dirtyAge = dirtyEntries?.length ? dirtyAgeDays(checkout, dirtyEntries, ageDays) : null;
    let classification = "review";
    if (isPrimary) classification = "primary";
    else if (dirtyEntries === null || patchUnique === null || !base) classification = "unverifiable";
    else if (dirtyEntries.length > 0) classification = dirtyAge >= 7 ? "stale-dirty" : "dirty";
    else if (patchUnique > 0) classification = ageDays >= 7 ? "archive-candidate" : "unlanded";
    else if (ancestor) classification = "safe-prune";
    else classification = "patch-equivalent-prune";
    return {
      path: checkout,
      branch: String(item.branch || "").replace("refs/heads/", "") || null,
      head,
      primary: isPrimary,
      locked,
      lockReason: typeof item.locked === "string" ? item.locked : null,
      dirty: dirtyEntries?.length ?? null,
      changes: dirtyEntries?.slice(0, 50) ?? null,
      untracked: dirtyEntries?.filter(line => line.startsWith("??")).length ?? null,
      patchUnique,
      ancestor,
      ageDays,
      dirtyAgeDays: dirtyAge,
      classification,
    };
  });
  return { repository: primary, base, worktrees };
}

async function inspectRepositoryAsync(repository, concurrency = 12) {
  const primary = path.resolve(runGit(repository, ["rev-parse", "--show-toplevel"]));
  const base = chooseBase(repository);
  const items = parseWorktreeList(runGit(repository, ["worktree", "list", "--porcelain"]));
  const worktrees = await mapLimit(items, concurrency, async item => {
    const checkout = path.resolve(item.worktree);
    const status = await runGitAsync(checkout, ["status", "--porcelain=v1"], { allowFailure: true });
    const dirtyEntries = status === null ? null : status.split("\n").filter(Boolean);
    const head = item.HEAD;
    let patchUnique = null;
    let ancestor = null;
    if (base && head) {
      const [cherry, ancestorResult] = await Promise.all([
        runGitAsync(checkout, ["cherry", base, head], { allowFailure: true }),
        runGitAsync(checkout, ["merge-base", "--is-ancestor", head, base], { allowFailure: true }),
      ]);
      patchUnique = cherry === null ? null : cherry.split("\n").filter(line => line.startsWith("+ ")).length;
      ancestor = ancestorResult !== null;
    }
    const isPrimary = checkout === primary;
    const locked = Object.prototype.hasOwnProperty.call(item, "locked");
    const ageDays = commitAgeDays(repository, head);
    const dirtyAge = dirtyEntries?.length ? dirtyAgeDays(checkout, dirtyEntries, ageDays) : null;
    let classification = "review";
    if (isPrimary) classification = "primary";
    else if (dirtyEntries === null || patchUnique === null || !base) classification = "unverifiable";
    else if (dirtyEntries.length > 0) classification = dirtyAge >= 7 ? "stale-dirty" : "dirty";
    else if (patchUnique > 0) classification = ageDays >= 7 ? "archive-candidate" : "unlanded";
    else if (ancestor) classification = "safe-prune";
    else classification = "patch-equivalent-prune";
    return {
      path: checkout,
      branch: String(item.branch || "").replace("refs/heads/", "") || null,
      head,
      primary: isPrimary,
      locked,
      lockReason: typeof item.locked === "string" ? item.locked : null,
      dirty: dirtyEntries?.length ?? null,
      changes: dirtyEntries?.slice(0, 50) ?? null,
      untracked: dirtyEntries?.filter(line => line.startsWith("??")).length ?? null,
      patchUnique,
      ancestor,
      ageDays,
      dirtyAgeDays: dirtyAge,
      classification,
    };
  });
  return { repository: primary, base, worktrees };
}

function inventory({ roots }) {
  return discoverRepositories(roots).map(inspectRepository).filter(repo => repo.worktrees.length > 1);
}

async function inventoryAsync({ roots, concurrency = 12 }) {
  const repositories = discoverRepositories(roots);
  const reports = [];
  for (const repository of repositories) {
    const report = await inspectRepositoryAsync(repository, concurrency);
    if (report.worktrees.length > 1) reports.push(report);
  }
  return reports;
}

function pruneSafe(report) {
  const actions = [];
  for (const repo of report) {
    for (const tree of repo.worktrees.filter(item => !item.locked && ["safe-prune", "delivered-prune", "patch-equivalent-prune", "obsolete-prune"].includes(item.classification))) {
      try {
        runGit(repo.repository, ["worktree", "remove", tree.path], { timeout: 60000 });
        if (tree.branch) {
          runGit(repo.repository, ["update-ref", "-d", `refs/heads/${tree.branch}`, tree.head]);
        }
        actions.push({ repository: repo.repository, path: tree.path, branch: tree.branch, head: tree.head, evidence: tree.classification, ok: true });
      } catch (error) {
        actions.push({ repository: repo.repository, path: tree.path, branch: tree.branch, head: tree.head, evidence: tree.classification, ok: false, error: error.message });
      }
    }
    runGit(repo.repository, ["worktree", "prune"]);
  }
  return actions;
}

function safeArchiveName(value) {
  return String(value || "detached").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "detached";
}

function archiveCandidates(report, { archiveRoot, generatedAt = new Date().toISOString() }) {
  if (!archiveRoot) throw new WorktreeLifecycleError("archiveRoot is required");
  const actions = [];
  const stamp = generatedAt.replace(/[:.]/g, "-");
  for (const repo of report) {
    const candidates = repo.worktrees.filter(tree => !tree.locked && tree.dirty === 0 && ["archive-candidate", "post-merge-archive-candidate"].includes(tree.classification));
    if (!candidates.length) continue;
    const repoName = safeArchiveName(path.basename(repo.repository));
    const destination = path.resolve(archiveRoot, repoName, stamp);
    fs.mkdirSync(destination, { recursive: true });
    const refs = [];
    for (const tree of candidates) {
      if (tree.branch) refs.push(`refs/heads/${tree.branch}`);
      else {
        const ref = `refs/archive/worktrees/${stamp}/${safeArchiveName(path.basename(tree.path))}`;
        runGit(repo.repository, ["update-ref", ref, tree.head]);
        refs.push(ref);
      }
    }
    const bundle = path.join(destination, "worktrees.bundle");
    runGit(repo.repository, ["bundle", "create", bundle, ...refs], { timeout: 120000 });
    const verify = runGit(repo.repository, ["bundle", "verify", bundle], { timeout: 120000 });
    const manifest = { generatedAt, repository: repo.repository, base: repo.base, bundle, verify, worktrees: candidates.map(tree => ({ path: tree.path, branch: tree.branch, head: tree.head, ageDays: tree.ageDays })) };
    fs.writeFileSync(path.join(destination, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
    for (const tree of candidates) {
      try {
        runGit(repo.repository, ["worktree", "remove", tree.path], { timeout: 60000 });
        actions.push({ repository: repo.repository, path: tree.path, branch: tree.branch, head: tree.head, evidence: "verified-bundle", bundle, ok: true });
      } catch (error) {
        actions.push({ repository: repo.repository, path: tree.path, branch: tree.branch, head: tree.head, evidence: "verified-bundle", bundle, ok: false, error: error.message });
      }
    }
    runGit(repo.repository, ["worktree", "prune"]);
  }
  return actions;
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function quarantineStaleDirty(report, { archiveRoot, generatedAt = new Date().toISOString() }) {
  if (!archiveRoot) throw new WorktreeLifecycleError("archiveRoot is required");
  const actions = [];
  const stamp = generatedAt.replace(/[:.]/g, "-");
  for (const repo of report) {
    const candidates = repo.worktrees.filter(tree => !tree.locked && tree.classification === "stale-dirty");
    if (!candidates.length) continue;
    const repositoryDestination = path.resolve(archiveRoot, safeArchiveName(path.basename(repo.repository)), stamp);
    fs.mkdirSync(repositoryDestination, { recursive: true, mode: 0o700 });
    const refs = candidates.map(tree => {
      if (tree.branch) return `refs/heads/${tree.branch}`;
      const ref = `refs/archive/worktrees/${stamp}/${safeArchiveName(path.basename(tree.path))}`;
      runGit(repo.repository, ["update-ref", ref, tree.head]);
      return ref;
    });
    const bundle = path.join(repositoryDestination, "dirty-heads.bundle");
    runGit(repo.repository, ["bundle", "create", bundle, ...refs], { timeout: 120000 });
    runGit(repo.repository, ["bundle", "verify", bundle], { timeout: 120000 });
    fs.chmodSync(bundle, 0o600);

    for (const tree of candidates) {
      const destination = path.join(repositoryDestination, safeArchiveName(path.basename(tree.path)));
      try {
        fs.mkdirSync(destination, { recursive: false, mode: 0o700 });
        const patchFile = path.join(destination, "tracked.patch");
        const patchFd = fs.openSync(patchFile, "wx", 0o600);
        try {
          execFileSync("git", ["diff", "--binary", "HEAD", "--"], { cwd: tree.path, stdio: ["ignore", patchFd, "pipe"], timeout: 120000 });
        } finally {
          fs.closeSync(patchFd);
        }
        if (fs.statSync(patchFile).size > 0) {
          execFileSync("git", ["apply", "--numstat", patchFile], { cwd: tree.path, encoding: "utf8", timeout: 120000 });
        }

        const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
          cwd: tree.path, encoding: "buffer", timeout: 120000, maxBuffer: 256 * 1024 * 1024,
        });
        const untrackedPaths = untracked.toString("utf8").split("\0").filter(Boolean);
        for (const file of untrackedPaths) {
          const target = path.resolve(tree.path, file);
          if (target !== tree.path && !target.startsWith(`${path.resolve(tree.path)}${path.sep}`)) throw new WorktreeLifecycleError(`Refusing untracked path outside worktree: ${file}`);
        }
        let untrackedArchive = null;
        if (untrackedPaths.length) {
          untrackedArchive = path.join(destination, "untracked.tar.gz");
          execFileSync("tar", ["--null", "--files-from=-", "-czf", untrackedArchive], { cwd: tree.path, input: untracked, timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
          fs.chmodSync(untrackedArchive, 0o600);
          execFileSync("tar", ["-tzf", untrackedArchive], { encoding: "utf8", timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
        }
        const manifest = {
          generatedAt, repository: repo.repository, base: repo.base, worktree: tree.path,
          branch: tree.branch, head: tree.head, dirtyAgeDays: tree.dirtyAgeDays, bundle,
          trackedPatch: { file: patchFile, sha256: sha256(patchFile), bytes: fs.statSync(patchFile).size },
          untracked: untrackedArchive ? { file: untrackedArchive, sha256: sha256(untrackedArchive), files: untrackedPaths.length } : null,
          status: tree.changes,
        };
        const manifestFile = path.join(destination, "manifest.json");
        fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
        runGit(repo.repository, ["worktree", "remove", "--force", tree.path], { timeout: 120000 });
        actions.push({ repository: repo.repository, path: tree.path, branch: tree.branch, head: tree.head, evidence: "verified-dirty-quarantine", bundle, manifest: manifestFile, ok: true });
      } catch (error) {
        actions.push({ repository: repo.repository, path: tree.path, branch: tree.branch, head: tree.head, evidence: "verified-dirty-quarantine", bundle, ok: false, error: error.message });
      }
    }
    runGit(repo.repository, ["worktree", "prune"]);
  }
  return actions;
}

function summarize(report) {
  const trees = report.flatMap(repo => repo.worktrees.filter(tree => !tree.primary));
  const classifications = {};
  for (const tree of trees) classifications[tree.classification] = (classifications[tree.classification] || 0) + 1;
  return { repositories: report.length, worktrees: trees.length, classifications };
}

function githubRepository(repository) {
  const remote = runGit(repository, ["remote", "get-url", "origin"], { allowFailure: true });
  if (!remote) return null;
  const match = remote.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/);
  return match ? match[1] : null;
}

function enrichPullRequests(report) {
  for (const repo of report) {
    const github = githubRepository(repo.repository);
    if (!github) continue;
    let pulls;
    try {
      pulls = JSON.parse(execFileSync("gh", ["pr", "list", "--repo", github, "--state", "all", "--limit", "5000", "--json", "number,state,mergedAt,closedAt,headRefName,headRefOid,url,title,baseRefName"], {
        encoding: "utf8", timeout: 60000, maxBuffer: 32 * 1024 * 1024,
      }));
    } catch {
      continue;
    }
    const byBranch = new Map();
    for (const pull of pulls) {
      if (!byBranch.has(pull.headRefName)) byBranch.set(pull.headRefName, []);
      byBranch.get(pull.headRefName).push(pull);
    }
    for (const tree of repo.worktrees) {
      if (tree.primary || !tree.branch || tree.dirty !== 0) continue;
      const candidates = byBranch.get(tree.branch) || [];
      const exact = candidates.find(pull => pull.headRefOid === tree.head);
      const latest = exact || candidates[0] || null;
      tree.pullRequest = latest;
      if (exact?.state === "MERGED") tree.classification = "delivered-prune";
      else if (exact?.state === "OPEN") tree.classification = "open-pr";
      else if (exact?.state === "CLOSED") tree.classification = "obsolete-prune";
      else if (latest?.state === "MERGED" && latest.headRefOid !== tree.head) tree.classification = tree.ageDays >= 7 ? "post-merge-archive-candidate" : "post-merge-review";
    }
  }
  return report;
}

module.exports = { WorktreeLifecycleError, discoverRepositories, inspectRepository, inspectRepositoryAsync, inventory, inventoryAsync, enrichPullRequests, pruneSafe, archiveCandidates, quarantineStaleDirty, summarize };
