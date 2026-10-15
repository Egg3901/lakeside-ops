// code-session-manager.js — Session lifecycle, worktree management, PR creation, MongoDB persistence
// Exports: createSessionManager(db, opts)

const { execFileSync } = require("child_process");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const { git, inspectWorktree, commitWorktree, WorktreeError } = require("./code-worktree");
const { worktreeBase } = require("./src/core/paths");

const WORKTREE_BASE = worktreeBase();

function createSessionManager(db, opts) {
  const { repoDir, llmProvider, llmModel, llmApiUrl, llmApiKey } = opts;
  const sessions = db.collection("code_sessions");
  const workspaceCache = new Map();
  const WORKSPACE_CACHE_MS = 1500;

  // Ensure worktree base dir exists
  if (!fs.existsSync(WORKTREE_BASE)) {
    fs.mkdirSync(WORKTREE_BASE, { recursive: true });
  }

  // ── Session CRUD ──────────────────────────────────────────

  function slugify(text, maxLen) {
    maxLen = maxLen || 40;
    if (!text) return '';
    return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, maxLen).replace(/-+$/, '');
  }

  // Create stub session (no worktree — initialized on first message)
  async function createSessionStub({ model, provider, baseBranch } = {}) {
    const id = "cs_" + crypto.randomBytes(4).toString("hex");
    const session = {
      sessionId: id,
      title: "New session",
      branchName: null,
      baseBranch: baseBranch || null,
      worktreePath: null,
      status: "stub",
      hermesSessionId: null,
      prUrl: null,
      prNumber: null,
      messages: [],
      model: model || llmModel,
      provider: provider || llmProvider,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: "admin",
    };
    await sessions.insertOne(session);
    return session;
  }

  // Initialize worktree on first message — branch name from prompt
  async function initializeWorktree(sessionId, promptText) {
    const session = await sessions.findOne({ sessionId });
    if (!session) throw new Error("Session not found");
    if (session.worktreePath) return session; // already initialized

    const id = session.sessionId;
    const slug = slugify(promptText, 30);
    const branchName = slug ? `code-agent/${slug}` : `code-agent/${id}`;
    const worktreePath = path.join(WORKTREE_BASE, id);
    const baseBranch = session.baseBranch || "development";
    if (!/^[a-zA-Z0-9/_.-]+$/.test(baseBranch) || baseBranch.startsWith("-")) {
      throw new WorktreeError("Invalid base branch", 400);
    }
    // Branch from the up-to-date REMOTE ref, not the local branch. The local
    // `refs/heads/<base>` can be stale — e.g. it is checked out in a long-lived
    // worktree that nobody ever pulls — which silently cuts every session off
    // old code. Fetch first, then branch from `origin/<base>`; only fall back to
    // the local ref if there is no remote-tracking ref (or the fetch failed and
    // one was never fetched).
    try {
      execFileSync("git", ["fetch", "origin", baseBranch, "--quiet"], {
        cwd: repoDir, encoding: "utf8", timeout: 30000,
      });
    } catch {
      // Offline / transient: fall through and branch from whatever ref resolves.
    }

    let safeBase = `refs/remotes/origin/${baseBranch}`;
    try {
      execFileSync("git", ["rev-parse", "--verify", "--quiet", safeBase], {
        cwd: repoDir, encoding: "utf8", timeout: 10000,
      });
    } catch {
      safeBase = `refs/heads/${baseBranch}`; // no remote-tracking ref; use local
    }

    try {
      execFileSync("git", ["worktree", "add", "--lock", "--reason", `active Ops session ${id}`, "-b", branchName, worktreePath, safeBase], {
        cwd: repoDir, encoding: "utf8", timeout: 15000,
      });
    } catch (e) {
      throw new Error(`Failed to create worktree: ${e.message}`);
    }

    const title = slug.split('-').slice(0, 6).join(' ').replace(/\b\w/g, c => c.toUpperCase()) || "New session";
    await sessions.updateOne(
      { sessionId },
      { $set: { branchName, worktreePath, status: "idle", title, updatedAt: new Date() } }
    );
    return { ...session, branchName, worktreePath, status: "idle", title };
  }

  async function getSession(sessionId) {
    const session = await sessions.findOne({ sessionId });
    if (session) {
      if (session.messages) session.messages = dedupeMessages(session.messages);
      return checkPRStatus(session);
    }
    return session;
  }

  async function listSessions() {
    const results = await sessions
      .find({})
      .sort({ updatedAt: -1 })
      .limit(50)
      .project({ messages: 0 })
      .toArray();
    // PR probes can stall on dead GitHub numbers — never block the lander more than ~1.2s.
    try {
      return await Promise.race([
        refreshPRStatuses(results),
        new Promise((resolve) => setTimeout(() => resolve(results), 1200)),
      ]);
    } catch {
      return results;
    }
  }

  async function updateSessionStatus(sessionId, status) {
    await sessions.updateOne(
      { sessionId },
      { $set: { status, updatedAt: new Date() } }
    );
  }

  async function setHermesSessionId(sessionId, hermesSessionId) {
    await sessions.updateOne(
      { sessionId },
      { $set: { hermesSessionId, updatedAt: new Date() } }
    );
  }

  async function updatePermissionMode(sessionId, permissionMode) {
    await sessions.updateOne(
      { sessionId },
      { $set: { permissionMode, updatedAt: new Date() } }
    );
  }

  async function saveMessages(sessionId, messages) {
    await sessions.updateOne(
      { sessionId },
      { $set: { messages, updatedAt: new Date() } }
    );
  }

  const MAX_MESSAGES = 200;
  const MAX_EVENTS = 1000;

  // Append a UI event to the durable session event log (capped). This is the
  // append-only transcript replayed on reload so an agent's work survives the
  // bridge dying / a server restart (cloud-Claude-Code-style persistence).
  async function appendEvent(sessionId, event) {
    await sessions.updateOne(
      { sessionId },
      { $push: { events: { $each: [event], $slice: -MAX_EVENTS } }, $set: { updatedAt: new Date() } }
    );
  }

  async function appendMessage(sessionId, message) {
    // Cap messages array to prevent unbounded growth
    await sessions.updateOne(
      { sessionId },
      {
        $push: {
          messages: {
            $each: [message],
            $slice: -MAX_MESSAGES,
          },
        },
        $set: { updatedAt: new Date() },
      }
    );
  }

  function dedupeMessages(messages) {
    if (!messages || messages.length <= 1) return messages;
    // Only remove truly consecutive duplicate messages (same role + exact same content)
    // This prevents accidental double-clicks without breaking follow-up questions
    var deduped = [];
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      var prev = deduped[deduped.length - 1];
      if (prev && prev.role === m.role && prev.content === m.content) {
        continue; // skip exact consecutive duplicate
      }
      deduped.push(m);
    }
    return deduped;
  }

  async function updateTitle(sessionId, title) {
    await sessions.updateOne(
      { sessionId },
      { $set: { title, updatedAt: new Date() } }
    );
  }

  async function deleteSession(sessionId) {
    const session = await sessions.findOne({ sessionId });
    if (!session) return false;

    // Deleting a session must never discard work. Prove both cleanliness and
    // delivery before removing its checkout or branch.
    if (session.worktreePath) {
      const worktreePath = session.worktreePath;
      if (fs.existsSync(worktreePath)) {
        const snapshot = inspectWorktree(worktreePath, session.baseBranch || "development");
        if (!snapshot.available) {
          throw new WorktreeError(`Cannot verify worktree safety: ${snapshot.error}`, 409);
        }
        if (snapshot.dirty) {
          throw new WorktreeError(
            `Session has ${snapshot.changedFiles.length} uncommitted change(s). Commit or explicitly archive the work before deleting it.`,
            409
          );
        }

        let compareBase = session.baseBranch || "development";
        if (!compareBase.includes("/")) {
          try {
            git(repoDir, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${compareBase}`]);
            compareBase = `origin/${compareBase}`;
          } catch {
            // Repositories without a remote use the local base branch.
          }
        }
        const unlanded = git(worktreePath, ["cherry", compareBase, "HEAD"])
          .split("\n")
          .filter(line => line.startsWith("+ "));
        if (unlanded.length > 0) {
          throw new WorktreeError(
            `Session has ${unlanded.length} commit(s) whose patches have not landed on ${compareBase}. Push and merge them before deleting the session.`,
            409
          );
        }
        try {
          git(worktreePath, ["merge-base", "--is-ancestor", "HEAD", compareBase]);
        } catch {
          throw new WorktreeError(
            `Session patches appear equivalent to ${compareBase}, but the branch is not its ancestor. Archive this squash-merged branch explicitly instead of deleting it automatically.`,
            409
          );
        }
        try {
          execFileSync("git", ["worktree", "unlock", worktreePath], { cwd: repoDir, encoding: "utf8", timeout: 10_000, stdio: "ignore" });
        } catch {
          // Legacy sessions predate active-checkout locks.
        }
        try {
          git(repoDir, ["worktree", "remove", worktreePath], { timeout: 15000 });
        } catch (error) {
          // A failed removal must not leave an active checkout eligible for a
          // concurrent fleet pruner.
          try {
            execFileSync("git", ["worktree", "lock", "--reason", `failed Ops session cleanup ${sessionId}`, worktreePath], {
              cwd: repoDir, encoding: "utf8", timeout: 10_000,
            });
          } catch { /* retain the original removal error */ }
          throw error;
        }
      }

      if (session.branchName) {
        git(repoDir, ["branch", "-d", "--", session.branchName]);
      }
    }

    // Remove MongoDB doc
    for (const key of workspaceCache.keys()) {
      if (key.startsWith(`${session.worktreePath || ""}\0`)) workspaceCache.delete(key);
    }
    await sessions.deleteOne({ sessionId });
    return true;
  }

  // ── PR creation ───────────────────────────────────────────

  function getWorkspaceSnapshot(session, { fresh = false } = {}) {
    if (!session) return inspectWorktree(null);
    const cacheKey = `${session.worktreePath || ""}\0${session.baseBranch || "development"}`;
    const cached = workspaceCache.get(cacheKey);
    if (!fresh && cached && Date.now() - cached.at < WORKSPACE_CACHE_MS) return cached.snapshot;
    const snapshot = inspectWorktree(session.worktreePath, session.baseBranch || "development");
    workspaceCache.set(cacheKey, { at: Date.now(), snapshot });
    return snapshot;
  }

  async function commitChanges(sessionId, message) {
    const session = await sessions.findOne({ sessionId });
    if (!session) throw new WorktreeError("Session not found", 404);
    const workspace = commitWorktree(session.worktreePath, message, {
      baseBranch: session.baseBranch || "development",
      env: { ...process.env },
    });
    const cacheKey = `${session.worktreePath || ""}\0${session.baseBranch || "development"}`;
    workspaceCache.set(cacheKey, { at: Date.now(), snapshot: workspace });
    if (workspace.branch && workspace.branch !== session.branchName) {
      await sessions.updateOne(
        { sessionId },
        { $set: { branchName: workspace.branch, updatedAt: new Date() } }
      );
    }
    return { workspace, commit: workspace.lastCommit };
  }

  async function createPR(sessionId, { title, body, commitMessage } = {}) {
    const session = await sessions.findOne({ sessionId });
    if (!session) throw new WorktreeError("Session not found", 404);
    if (session.prUrl) return { prUrl: session.prUrl, prNumber: session.prNumber };

    const worktreePath = session.worktreePath;
    if (!worktreePath || !fs.existsSync(worktreePath)) {
      throw new WorktreeError("Worktree path missing", 409);
    }

    const baseBranch = session.baseBranch || "development";
    if (!/^[a-zA-Z0-9/_.-]+$/.test(baseBranch) || baseBranch.startsWith("-")) {
      throw new WorktreeError("Invalid base branch", 400);
    }

    // The agent may have checked out a different local branch than the one the
    // worktree/session started on (e.g. the seed prompt suggests a branch name
    // like `fix/ticket-123` and the agent takes it literally with `git checkout
    // -b`), leaving `session.branchName` stale. Always push/PR from whatever is
    // actually checked out in the worktree.
    let workspace = getWorkspaceSnapshot(session, { fresh: true });
    if (!workspace.available) throw new WorktreeError(workspace.error || "Worktree unavailable", 409);
    let branchName = workspace.branch;
    if (!branchName || branchName === "detached HEAD") {
      throw new WorktreeError("Create a branch before opening a pull request", 409);
    }
    if (!/^[a-zA-Z0-9/_.-]+$/.test(branchName) || branchName.startsWith("-")) {
      throw new WorktreeError("Invalid worktree branch", 409);
    }
    if (branchName !== session.branchName) {
      await sessions.updateOne({ sessionId }, { $set: { branchName, updatedAt: new Date() } });
    }

    const ghEnv = { ...process.env, GH_TOKEN: process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "" };
    let committed = null;
    if (workspace.dirty) {
      if (!commitMessage) {
        throw new WorktreeError("Commit the worktree changes before creating a pull request", 409);
      }
      const result = await commitChanges(sessionId, commitMessage);
      workspace = result.workspace;
      committed = result.commit;
    }

    if (workspace.divergenceError) {
      throw new WorktreeError(`Cannot compare this branch with ${baseBranch}: ${workspace.divergenceError}`, 409);
    }
    if (workspace.ahead === 0) {
      throw new WorktreeError("No commits to create a PR from — the branch is not ahead of its base", 409);
    }

    // Push branch
    try {
      git(worktreePath, ["push", "--set-upstream", "origin", branchName], {
        timeout: 30000,
        env: ghEnv,
      });
    } catch (e) {
      throw new WorktreeError(`git push failed: ${e.message}`, 502);
    }

    // Create PR via gh CLI
    const prTitle = title || `Code Agent: ${session.title}`;

    // Generate PR body from git diff and log
    let prBody = body;
    if (!prBody) {
      const bodyParts = [`## Code Agent Session`, ``];
      if (session.title) bodyParts.push(`**Task:** ${session.title}`, ``);
      // Compare against origin/<base> when it exists, matching how the worktree
      // was cut, so the body reflects only this session's commits rather than
      // any drift of the local base ref.
      let compareBase = baseBranch;
      if (!baseBranch.includes("/")) {
        try {
          git(worktreePath, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${baseBranch}`]);
          compareBase = `origin/${baseBranch}`;
        } catch {}
      }
      // Files changed
      try {
        const diffStat = git(worktreePath, ["diff", "--stat", `${compareBase}..HEAD`]);
        if (diffStat) bodyParts.push(`### Files changed`, ``, '```', diffStat, '```', ``);
      } catch {}
      // Commit messages
      try {
        const commits = git(worktreePath, ["log", "--oneline", `${compareBase}..HEAD`]);
        if (commits) bodyParts.push(`### Commits`, ``, commits.split('\n').map(c => '- ' + c).join('\n'), ``);
      } catch {}
      bodyParts.push(`Session: \`${sessionId}\` · Branch: \`${branchName}\``);
      prBody = bodyParts.join('\n');
    }
    let prUrl, prNumber;
    try {
      const output = execFileSync(
        "gh",
        ["pr", "create", "--base", baseBranch, "--head", branchName, "--title", prTitle, "--body", prBody],
        { cwd: repoDir, encoding: "utf8", timeout: 30000, env: ghEnv }
      ).trim();
      prUrl = output;
      // Extract PR number from URL
      const match = output.match(/\/pull\/(\d+)/);
      prNumber = match ? parseInt(match[1]) : null;
    } catch (e) {
      throw new WorktreeError(`gh pr create failed: ${e.stderr || e.message}`, 502);
    }

    // Update session
    await sessions.updateOne(
      { sessionId },
      {
        $set: {
          prUrl,
          prNumber,
          prState: "OPEN",
          prStateCheckedAt: new Date(),
          status: "completed",
          updatedAt: new Date(),
        },
      }
    );

    return {
      prUrl,
      prNumber,
      committed,
      workspace: getWorkspaceSnapshot({ ...session, branchName }, { fresh: true }),
    };
  }

  // ── PR status checking ────────────────────────────────────
  const PR_STATUS_TTL = 5 * 60 * 1000; // 5 minutes

  async function checkPRStatus(session) {
    if (!session.prNumber || !session.prUrl) return session;
    // Skip if checked recently
    if (session.prStateCheckedAt && (Date.now() - new Date(session.prStateCheckedAt).getTime()) < PR_STATUS_TTL) {
      return session;
    }
    const ghEnv = { ...process.env, GH_TOKEN: process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "" };
    try {
      const output = execFileSync(
        "gh",
        ["pr", "view", String(session.prNumber), "--json", "state"],
        { cwd: repoDir, encoding: "utf8", timeout: 2500, env: ghEnv }
      ).trim();
      const data = JSON.parse(output);
      const prState = data.state || "UNKNOWN"; // OPEN, MERGED, CLOSED
      await sessions.updateOne(
        { sessionId: session.sessionId },
        { $set: { prState, prStateCheckedAt: new Date() } }
      );
      return { ...session, prState, prStateCheckedAt: new Date() };
    } catch {
      return session;
    }
  }

  async function refreshPRStatuses(sessionList) {
    // Check all sessions with PRs in parallel (only stale ones)
    const checks = sessionList
      .filter(s => s.prNumber && s.prUrl)
      .map(s => checkPRStatus(s));
    const results = await Promise.all(checks);
    // Merge results back into the list
    const updated = new Map(results.map(s => [s.sessionId, s]));
    return sessionList.map(s => updated.get(s.sessionId) || s);
  }

  // ── Git info helpers ──────────────────────────────────────

  function getBranchInfo(worktreePath) {
    const snapshot = inspectWorktree(worktreePath);
    return {
      branch: snapshot.branch || "unknown",
      status: snapshot.dirty ? `${snapshot.changedFiles.length} changed file(s)` : "clean",
      log: snapshot.lastCommit
        ? `${snapshot.lastCommit.shortSha} ${snapshot.lastCommit.subject}`
        : "",
    };
  }

  // ── Cleanup old sessions ──────────────────────────────────

  async function cleanupOldSessions(maxAgeDays = 7) {
    const cutoff = new Date(Date.now() - maxAgeDays * 86400000);
    const old = await sessions
      .find({ updatedAt: { $lt: cutoff }, status: { $in: ["idle", "completed", "error"] } })
      .toArray();
    let cleaned = 0;
    for (const s of old) {
      try {
        await deleteSession(s.sessionId);
        cleaned++;
      } catch (e) {
        console.error(`[code-sessions] Cleanup failed for ${s.sessionId}:`, e.message);
      }
    }
    return cleaned;
  }

  return {
    // createSession removed — use createSessionStub + initializeWorktree
    createSessionStub,
    initializeWorktree,
    getSession,
    listSessions,
    updateSessionStatus,
    setHermesSessionId,
    updatePermissionMode,
    saveMessages,
    appendMessage,
    appendEvent,
    updateTitle,
    deleteSession,
    getWorkspaceSnapshot,
    commitChanges,
    createPR,
    getBranchInfo,
    cleanupOldSessions,
  };
}

module.exports = { createSessionManager, WORKTREE_BASE };
