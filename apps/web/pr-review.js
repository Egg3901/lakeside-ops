// ─── AUTOMATED PR REVIEW ─────────────────────────────────────────────
// On a GitHub `pull_request` webhook (opened/synchronize/reopened), fetch the
// diff, ask the configured LLM (Kimi by default) for a concise review, and post
// it as a PR comment. GitHub auth reuses the `gh` CLI's stored credentials (the
// same mechanism the code agent uses), so no token lives in this code.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { notifyDiscord, COLORS } = require("./ops-discord");
const { callChat } = require("./llm");
const { primaryRepoDir } = require("./src/core/paths");

const REVIEWED_FILE = path.join(__dirname, "data", "pr-reviewed.json");
const MAX_DIFF_CHARS = 40000; // keep the prompt bounded
const GAME_REPO = process.env.AHD_GAME_REPO || primaryRepoDir();
const MAX_CONTEXT_CHARS = 6000; // cap on appended "other usages" context
const MAX_SYMBOLS = 8; // cap on how many changed exports we bother grepping for
const MAX_LINES_PER_SYMBOL = 12;

function ghToken() {
  return process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "";
}

// Verify the X-Hub-Signature-256 header (HMAC-SHA256 of the raw body).
function verifySignature(rawBody, signature, secret) {
  if (!secret || !signature) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// GitHub REST API via fetch + token (no dependency on the gh CLI's env/config,
// which isn't available to the systemd service).
async function fetchPrDiff(repo, prNumber) {
  const r = await fetch(`https://api.github.com/repos/${repo}/pulls/${prNumber}`, {
    headers: {
      Authorization: "Bearer " + ghToken(),
      Accept: "application/vnd.github.v3.diff",
      "User-Agent": "ahd-ops-pr-review",
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`diff fetch ${r.status}`);
  return await r.text();
}

async function postComment(repo, prNumber, body) {
  const r = await fetch(`https://api.github.com/repos/${repo}/issues/${prNumber}/comments`, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + ghToken(),
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "ahd-ops-pr-review",
    },
    body: JSON.stringify({ body }),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`comment post ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

// Changed file paths ("b/" side — the post-change path) from a unified diff.
function extractChangedFiles(diff) {
  const files = new Set();
  const re = /^diff --git a\/(.+?) b\/(.+?)$/gm;
  let m;
  while ((m = re.exec(diff))) files.add(m[2]);
  return [...files];
}

// Exported symbol names touched by the diff (function/const/interface/type/class).
// Deliberately broad — a false-positive symbol just means one extra harmless grep.
function extractChangedSymbols(diff) {
  const symbols = new Set();
  const re = /^[+-]\s*export\s+(?:default\s+)?(?:async\s+)?(?:function|const|class|interface|type)\s+([A-Za-z0-9_]+)/gm;
  let m;
  while ((m = re.exec(diff))) symbols.add(m[1]);
  return [...symbols];
}

// For each changed exported symbol, grep the base branch for other references
// outside the files this diff already touches. This is what lets the reviewer
// check "does anything else in the codebase depend on this" instead of
// guessing from the diff alone — the actual gap that produced a false-positive
// finding on PR #2519 (a claim about cross-file usage the model had no way to see).
//
// Fetches and greps `origin/<baseRef>` directly (`git grep <pattern> <ref> --`)
// rather than the working tree: the on-disk checkout this box uses for other
// jobs can be stale or mid-checkout, and grepping a ref is read-only — it can
// never disturb whatever the working tree currently has checked out.
function findOtherUsages(repoDir, diff, baseRef) {
  const ref = baseRef || "development";
  const changedFiles = extractChangedFiles(diff);
  const symbols = extractChangedSymbols(diff).slice(0, MAX_SYMBOLS);
  if (!symbols.length) return "";
  if (!fs.existsSync(path.join(repoDir, ".git"))) return "";

  try {
    execFileSync("git", ["fetch", "--quiet", "origin", ref], {
      cwd: repoDir,
      timeout: 15000,
      stdio: ["ignore", "ignore", "ignore"], // failure is expected/handled — don't spam server logs
    });
  } catch {
    return ""; // offline, bad ref, etc. — context is best-effort, never block the review
  }

  const sections = [];
  let total = 0;
  for (const sym of symbols) {
    let out;
    try {
      out = execFileSync(
        "git",
        ["grep", "-n", "-F", "--", sym, `origin/${ref}`, "--", "*.ts", "*.tsx"],
        {
          cwd: repoDir,
          encoding: "utf8",
          timeout: 5000,
          maxBuffer: 2 * 1024 * 1024,
          stdio: ["ignore", "pipe", "ignore"], // exit 1 on no-match is normal — don't spam server logs
        }
      );
    } catch {
      continue; // `git grep` exits 1 on no matches — normal, skip this symbol
    }
    const otherLines = out
      .split("\n")
      .filter(Boolean)
      // git grep <ref> prefixes each line with "<ref>:<path>:<line>:..." — strip the ref prefix for readability.
      .map((line) => line.replace(`origin/${ref}:`, ""))
      .filter((line) => !changedFiles.some((f) => line.startsWith(f + ":")));
    if (!otherLines.length) continue;
    // Cap per-FILE, not per-line: a flat line cap can silently drop an entire
    // calling file if another file sorts earlier and has more matching lines
    // (caught in testing — a 3rd real caller vanished behind a 2-line-per-file
    // budget). Every distinct file that references the symbol gets a slot.
    const linesByFile = new Map();
    for (const line of otherLines) {
      const file = line.slice(0, line.indexOf(":"));
      const forFile = linesByFile.get(file) ?? [];
      if (forFile.length < 2) forFile.push(line);
      linesByFile.set(file, forFile);
    }
    const lines = [...linesByFile.values()].flat().slice(0, MAX_LINES_PER_SYMBOL);
    if (!lines.length) continue;
    const section = `Other references to \`${sym}\` elsewhere in the repo (base branch \`${ref}\`, pre-PR):\n${lines.join("\n")}`;
    if (total + section.length > MAX_CONTEXT_CHARS) break;
    sections.push(section);
    total += section.length;
  }
  return sections.join("\n\n");
}

const MAX_VERIFY_TARGETS = 6; // cap on distinct backtick tokens we'll try to resolve
const MAX_VERIFY_CONTEXT_CHARS = 14000; // cap on total fetched verification context
const MAX_FILE_FETCH_CHARS = 6000; // cap per fetched file/snippet

// Backtick-quoted tokens on lines that contain "UNVERIFIED" — these are the
// reviewer's own pointers to what it couldn't check ("Does `formatCountry`
// accept a third argument?", "confirm `COUNTRY_CURRENCY_MAP` is imported").
// A usable verification target names something (a file, a symbol) — not a
// bare operator or punctuation. Requires at least 3 consecutive letters, so
// backtick spans like `>=`, `$or`, `exists:false`-the-symbol-part-only get
// filtered before they turn into noisy, irrelevant greps.
const GENERIC_TOKEN_STOPLIST = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
  "null",
  "undefined",
  "true",
  "false",
]);

function looksLikeIdentifier(token) {
  // Must look like a single symbol or path — no spaces/operators, which rules
  // out the model wrapping a whole descriptive phrase in backticks (e.g.
  // `expiresAtTurn > currentTurn` isn't a token that exists in any file; it's
  // prose, and grepping for it verbatim either finds nothing or, worse, a
  // coincidental unrelated match).
  if (!/^[A-Za-z0-9_$./-]+$/.test(token)) return false;
  if (!/[a-zA-Z]{3,}/.test(token)) return false;
  // Too generic to carry any signal on its own — every route file matches.
  if (GENERIC_TOKEN_STOPLIST.has(token)) return false;
  // Bare short words (no path/extension) are too likely to collide with an
  // unrelated feature reusing the same common name elsewhere in a large repo.
  if (token.length < 5 && !token.includes(".") && !token.includes("/")) return false;
  return true;
}

function extractVerificationTargets(reviewText) {
  const targets = new Set();
  // The model formats "unverified" two ways: a per-bullet "UNVERIFIED:" prefix,
  // or a section header ("## UNVERIFIED" / "**UNVERIFIED**") with unlabeled
  // bullets below it — track heading state so both are caught.
  let inUnverifiedSection = false;
  for (const line of reviewText.split("\n")) {
    const heading = line.match(/^\s*#{1,6}\s+(.+)$/) || line.match(/^\s*\*\*([^*]+)\*\*\s*$/);
    if (heading) {
      inUnverifiedSection = /unverified/i.test(heading[1]);
      continue;
    }
    if (!inUnverifiedSection && !/unverified/i.test(line)) continue;
    const matches = line.match(/`([^`]+)`/g) || [];
    for (const m of matches) {
      const token = m.slice(1, -1).trim();
      if (token && token.length < 80 && looksLikeIdentifier(token)) targets.add(token);
    }
  }
  return [...targets].slice(0, MAX_VERIFY_TARGETS);
}

// Directories the diff actually touched — used to scope identifier greps so
// a common field/function name (e.g. `expiresAtTurn`, reused by an unrelated
// feature elsewhere in a large repo) resolves to the file this PR is really
// about instead of the first alphabetical false-positive match repo-wide.
function deriveScopeDirs(changedFiles) {
  const dirs = new Set();
  for (const f of changedFiles) {
    const parts = f.split("/");
    if (parts.length > 2) dirs.add(parts.slice(0, -1).join("/"));
    if (parts.length > 3) dirs.add(parts.slice(0, -2).join("/"));
  }
  return [...dirs];
}

// Resolve a bare filename (no slash) to a repo-relative path by basename match
// against the ref's tree. A generic filename (e.g. every Next.js API route is
// named `route.ts`) can match hundreds of files repo-wide — prefer a match
// inside the diff's own directories (`scopeDirs`) before falling back to the
// first repo-wide match, same reasoning as the identifier-lookup scoping.
function resolveFileByBasename(repoDir, ref, basename, scopeDirs) {
  let out;
  try {
    out = execFileSync("git", ["ls-tree", "-r", "--name-only", ref], {
      cwd: repoDir,
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 4 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
  const candidates = out.split("\n").filter((p) => p.endsWith("/" + basename) || p === basename);
  if (!candidates.length) return null;
  if (scopeDirs && scopeDirs.length) {
    // Try each scope dir in order (deriveScopeDirs puts the immediate parent
    // before the broader grandparent) — a flat "matches any scope dir" check
    // let a sibling feature's same-named file (e.g. a neighboring route.ts)
    // outrank the file actually in the diff's own directory.
    for (const dir of scopeDirs) {
      const scoped = candidates.find((p) => p.startsWith(dir + "/"));
      if (scoped) return scoped;
    }
  }
  return candidates[0];
}

// Grep for `token` within `pathspecs` (or repo-wide if empty), returning the
// first "<ref>:<path>:<lineNo>:..." match line, or null on no match/error.
function grepFirstMatch(repoDir, ref, token, pathspecs) {
  try {
    const args = ["grep", "-n", "-F", "--", token, ref];
    if (pathspecs && pathspecs.length) args.push("--", ...pathspecs);
    else args.push("--", "*.ts", "*.tsx");
    const out = execFileSync("git", args, {
      cwd: repoDir,
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 2 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split("\n").find(Boolean) || null;
  } catch {
    return null;
  }
}

// Fetch bounded, relevant file content for one backtick token — a full file
// for a path/filename reference, or a windowed snippet around the first
// definition/usage site for a bare identifier. `scopeDirs` (directories the
// diff itself touched) are tried before a repo-wide search, so a generic
// field/function name reused by an unrelated feature elsewhere in the repo
// doesn't win over the file this PR is actually about. Never throws.
function fetchVerificationSnippet(repoDir, ref, token, scopeDirs) {
  try {
    const looksLikeFile = /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(token);
    if (looksLikeFile) {
      const repoPath = token.includes("/")
        ? token
        : resolveFileByBasename(repoDir, ref, token, scopeDirs);
      if (!repoPath) return null;
      const content = execFileSync("git", ["show", `${ref}:${repoPath}`], {
        cwd: repoDir,
        encoding: "utf8",
        timeout: 5000,
        maxBuffer: 2 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      });
      return { label: repoPath, content: content.slice(0, MAX_FILE_FETCH_CHARS) };
    }

    // Bare identifier — prefer a match inside the diff's own directories,
    // falling back to a repo-wide search if the scoped one comes up empty.
    const firstLine =
      grepFirstMatch(repoDir, ref, token, scopeDirs) ?? grepFirstMatch(repoDir, ref, token, null);
    if (!firstLine) return null;
    const rest = firstLine.slice(`${ref}:`.length);
    const sep = rest.indexOf(":");
    const repoPath = rest.slice(0, sep);
    const lineNo = parseInt(rest.slice(sep + 1), 10);
    if (!repoPath || !Number.isFinite(lineNo)) return null;
    const content = execFileSync("git", ["show", `${ref}:${repoPath}`], {
      cwd: repoDir,
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 2 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const lines = content.split("\n");
    const window = lines.slice(Math.max(0, lineNo - 16), lineNo + 15).join("\n");
    return { label: `${repoPath} (around line ${lineNo})`, content: window.slice(0, MAX_FILE_FETCH_CHARS) };
  } catch {
    return null;
  }
}

// Fetch bounded verification context for every UNVERIFIED claim's backtick
// tokens. Returns "" when there's nothing to verify or nothing resolvable —
// callers should skip the verify pass entirely in that case, not re-ask the
// same model the same question with no new information.
function buildVerificationContext(repoDir, ref, reviewText, diff) {
  const targets = extractVerificationTargets(reviewText);
  if (!targets.length) return "";
  const scopeDirs = diff ? deriveScopeDirs(extractChangedFiles(diff)) : [];
  const sections = [];
  let total = 0;
  for (const token of targets) {
    const snippet = fetchVerificationSnippet(repoDir, ref, token, scopeDirs);
    if (!snippet) continue;
    const section = `\`${token}\` — ${snippet.label}:\n\`\`\`\n${snippet.content}\n\`\`\``;
    if (total + section.length > MAX_VERIFY_CONTEXT_CHARS) break;
    sections.push(section);
    total += section.length;
  }
  return sections.join("\n\n");
}

// Second pass: fetch the actual code behind every UNVERIFIED claim and ask
// the model to resolve each one against it, instead of leaving "I can't see
// this" as the final answer. Falls back to the first-pass review untouched
// if there's nothing to fetch or the second call fails for any reason.
async function verifyReview(diff, initialReview, title, baseRef) {
  if (!/unverified/i.test(initialReview)) return initialReview;

  let verifyContext = "";
  try {
    verifyContext = buildVerificationContext(GAME_REPO, baseRef || "development", initialReview, diff);
  } catch {
    verifyContext = "";
  }
  if (!verifyContext) return initialReview;

  const prompt =
    `You are re-checking your own PR review below. You previously marked some items "UNVERIFIED:" because ` +
    `you couldn't see the code they depended on. Below that, under "Verification context", is the actual ` +
    `code for those items, fetched from the repo.\n\n` +
    `For every UNVERIFIED item: if the code confirms it's a real bug, rewrite it under "Bugs" as a confirmed ` +
    `finding, quoting the specific line(s) that prove it (drop the "UNVERIFIED:" prefix). If the code shows ` +
    `there's no issue, remove that item entirely from your output — do not mention it again, do not still ` +
    `call it unverified. If the fetched context genuinely doesn't cover what the claim needs, keep it prefixed ` +
    `"UNVERIFIED:" and say exactly what you'd still need to check.\n\n` +
    `Output your complete, revised review (keep any parts that didn't need verification unchanged).\n\n` +
    `PR title: ${title}\n\nYour previous review:\n${initialReview}\n\n` +
    `Verification context (fetched from base branch \`${baseRef || "development"}\`):\n${verifyContext}`;

  try {
    const { content } = await callChat({
      messages: [{ role: "user", content: prompt }],
      maxTokens: 24000,
      temperature: 1,
    });
    const revised = (content || "").trim();
    return revised || initialReview;
  } catch {
    return initialReview; // never let the verify pass turn a good review into no review
  }
}

async function callLlmReview(diff, title, baseRef) {
  const truncated = diff.length > MAX_DIFF_CHARS;
  let repoContext = "";
  try {
    repoContext = findOtherUsages(GAME_REPO, diff, baseRef);
  } catch {
    repoContext = ""; // best-effort — never let context-gathering block the review
  }

  const prompt =
    `You are a senior engineer reviewing a pull request for "A House Divided", a Next.js + TypeScript + MongoDB web game. ` +
    `Review the unified diff below and give a concise, specific review. Prioritise correctness bugs, security issues, and clear simplifications; ` +
    `skip nitpicks. Use short markdown sections (e.g. "Bugs", "Suggestions"). If it looks good, say so briefly.\n\n` +
    `You only see this diff, plus (if provided below) a grep of other places in the repo that reference symbols this diff changed — ` +
    `you cannot browse the rest of the codebase. Only state a claim as a confirmed bug if you can point to the specific line(s), ` +
    `in the diff or in the provided repo-context, that prove it. If a concern depends on code you cannot see (e.g. "this might break ` +
    `other callers", "this map could collide if used across multiple X"), prefix that item with "UNVERIFIED:" and phrase it as a ` +
    `question to check rather than an assertion — do not state it with the same confidence as something you actually observed.` +
    (truncated ? " NOTE: the diff was truncated; review what is shown." : "") +
    `\n\nPR title: ${title}\n\nDiff:\n\`\`\`diff\n${diff.slice(0, MAX_DIFF_CHARS)}\n\`\`\`` +
    (repoContext ? `\n\nRepo context (grepped from the base branch, not part of the diff):\n${repoContext}` : "");

  // kimi-for-coding is a reasoning model — it spends tokens on reasoning_content
  // first, so the budget must cover thinking + the answer. temperature=1 because
  // kimi-for-coding only accepts 1. Provider fallback is handled inside callChat.
  //
  // 9000 was too tight: diagnosed a run where reasoning_content alone hit ~9000
  // tokens and finish_reason came back "length" with content empty — the model
  // never got to write an answer. Raised well above what's been observed so a
  // longer diff (this repo-context addition makes prompts bigger) doesn't
  // silently produce empty reviews.
  const { content } = await callChat({
    messages: [{ role: "user", content: prompt }],
    maxTokens: 24000,
    temperature: 1,
  });
  const firstPass = (content || "").trim();
  if (!firstPass) return firstPass;
  return verifyReview(diff, firstPass, title, baseRef);
}

function loadReviewed() {
  try {
    return new Set(JSON.parse(fs.readFileSync(REVIEWED_FILE, "utf8")));
  } catch {
    return new Set();
  }
}
function saveReviewed(set) {
  try {
    fs.mkdirSync(path.dirname(REVIEWED_FILE), { recursive: true });
    fs.writeFileSync(REVIEWED_FILE, JSON.stringify([...set].slice(-1000)));
  } catch {
    /* best-effort */
  }
}

// Review a single PR head. Deduped by `${prNumber}:${headSha}` so re-deliveries
// and unrelated events don't repost. `dryRun` skips the GitHub comment.
async function reviewPullRequest({
  repo,
  prNumber,
  headSha,
  title,
  baseRef,
  dryRun = false,
  force = false,
}) {
  // PR auto-review service NUKED (ops decision, 2026-07-05). This is the single
  // choke point for both entry paths — the GitHub `pull_request` webhook (now
  // also deleted from the a-house-divided repo) and the manual "re-review"
  // button on the dashboard. Both go inert here. Re-enable with PR_REVIEW_ENABLED=1.
  if (process.env.PR_REVIEW_ENABLED !== "1") {
    return { skipped: "service disabled", key: `${prNumber}:${headSha}` };
  }
  const reviewed = loadReviewed();
  const key = `${prNumber}:${headSha}`;
  // `force` (e.g. a manual re-review from the portal) bypasses the per-sha dedupe
  // so the review always runs and re-posts.
  if (!force && reviewed.has(key)) return { skipped: "already reviewed", key };

  const diff = await fetchPrDiff(repo, prNumber);
  if (!diff || diff.trim().length < 5) return { skipped: "empty diff", key };

  const review = await callLlmReview(diff, title || `PR #${prNumber}`, baseRef);
  if (!review) return { skipped: "empty review", key };

  const body =
    `### 🤖 Automated review (${(process.env.LLM_PROVIDER || "kimi")})\n\n${review}\n\n` +
    `<sub>Reviewed \`${(headSha || "").slice(0, 7)}\` · automated, not a substitute for human review.</sub>`;

  if (!dryRun) {
    await postComment(repo, prNumber, body);
    reviewed.add(key);
    saveReviewed(reviewed);
    // Surface the review to Discord (best-effort; no-op if no webhook configured).
    const prUrl = `https://github.com/${repo}/pull/${prNumber}`;
    const opsBase = (process.env.PUBLIC_BASE || "https://ops.lakesidegames.net").replace(/\/+$/, "");
    const portalUrl = `${opsBase}/pr-review?repo=${encodeURIComponent(repo)}&pr=${prNumber}`;
    const notify = await notifyDiscord({
      kind: "pr-review",
      title: `🤖 PR #${prNumber} reviewed · ${repo}`,
      description: review,
      url: prUrl,
      color: COLORS.blurple,
      fields: [
        { name: "Pull request", value: title || `#${prNumber}`, inline: false },
        { name: "Commit", value: `\`${(headSha || "").slice(0, 7)}\``, inline: true },
        { name: "Reviewer", value: process.env.LLM_PROVIDER || "kimi", inline: true },
        { name: "Links", value: `[Pull request](${prUrl}) · [Review portal](${portalUrl})`, inline: false },
      ],
      footer: "Automated review · not a substitute for human review",
    });
    return {
      reviewed: true,
      key,
      length: review.length,
      discord: notify,
      // Surfaced for persistence into the `pr_reviews` collection (PR Reviews page).
      repo,
      prNumber,
      headSha,
      title,
      prUrl,
      review,
      model: process.env.LLM_PROVIDER || "kimi",
    };
  }
  return { reviewed: !dryRun, key, length: review.length };
}

module.exports = {
  verifySignature,
  reviewPullRequest,
  // Exported for testing / reuse — not part of the webhook-facing API.
  extractChangedFiles,
  extractChangedSymbols,
  findOtherUsages,
  extractVerificationTargets,
  buildVerificationContext,
  verifyReview,
};
