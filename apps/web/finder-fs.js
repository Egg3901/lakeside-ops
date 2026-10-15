// finder-fs.js — path sandbox + listing/read/write helpers for the Lakeside Finder.
// Admin-only file explorer. Never escapes allowlisted roots. Blocks secret-like files on write
// and redacts them on read when possible.
"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileAsync = promisify(execFile);
const { loadConfig } = require("./src/core/config");
const { listFinderRoots } = require("./src/services/projectRegistry");

loadConfig();

// ── Roots the Finder may touch ─────────────────────────────────────────
// Configured via config/dashboard.yaml finder.roots or FINDER_ROOTS env.
// No box-specific absolute paths are hardcoded here.
function configuredRoots() {
  return listFinderRoots();
}
/** @deprecated use configuredRoots() — kept for callers that read finderFs.ROOTS */
const ROOTS = configuredRoots();

const SKIP_DIR_NAMES = new Set([
  "node_modules", ".next", ".turbo", "dist", "build", "coverage",
  ".cache", "__pycache__", ".pytest_cache", ".mypy_cache", ".venv", "venv",
  ".git", // still detect git; don't recurse into object store by default
  "Pods", "DerivedData",
]);

// Still show these as entries, but never open/read contents via API
const BLOCKED_NAME_RE = /^\.env(\.|$)|credentials|\.pem$|\.key$|id_rsa|id_ed25519|\.p12$|\.pfx$|secret|passwd|password/i;
const BLOCKED_PATH_PARTS = [
  "/.ssh/",
  "/.gnupg/",
  "/.aws/",
  "/.hermes/config.yaml",
  "/.xurl",
];

const TEXT_EXT = new Set([
  ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".json", ".md", ".mdx", ".txt", ".css", ".scss",
  ".html", ".htm", ".svg", ".xml", ".yml", ".yaml", ".toml", ".ini", ".cfg", ".conf", ".env.example",
  ".sh", ".bash", ".zsh", ".py", ".rb", ".go", ".rs", ".java", ".kt", ".swift", ".sql", ".graphql",
  ".vue", ".svelte", ".astro", ".prisma", ".dockerfile", ".gitignore", ".gitattributes", ".editorconfig",
  ".npmrc", ".prettierrc", ".eslintrc", ".babelrc", ".map", ".csv", ".tsv", ".log", ".lock",
]);

const MAX_LIST = 800;
const MAX_READ_BYTES = 1_500_000;
const MAX_WRITE_BYTES = 1_500_000;

function expandRoots() {
  return configuredRoots().filter((r) => {
    try { return fs.existsSync(r.path) && fs.statSync(r.path).isDirectory(); } catch { return false; }
  }).map((r) => ({ ...r, path: path.resolve(r.path) }));
}

function isBlockedPath(abs) {
  const n = path.basename(abs);
  if (BLOCKED_NAME_RE.test(n)) return true;
  const lower = abs.toLowerCase();
  for (const part of BLOCKED_PATH_PARTS) {
    if (lower.includes(part.toLowerCase())) return true;
  }
  // Explicit env files
  if (n === ".env" || n.startsWith(".env.")) return true;
  return false;
}

function resolveSafe(rawPath) {
  if (rawPath == null || rawPath === "") {
    return { ok: true, abs: null, root: null, rel: "" };
  }
  const input = String(rawPath);
  // Reject null bytes / obvious traversal tricks before resolve
  if (input.includes("\0")) return { ok: false, error: "invalid path" };

  let abs;
  try {
    abs = path.resolve(input);
  } catch {
    return { ok: false, error: "invalid path" };
  }

  const roots = expandRoots();
  const root = roots.find((r) => abs === r.path || abs.startsWith(r.path + path.sep));
  if (!root) return { ok: false, error: "path outside allowlist" };

  // Resolve symlinks carefully: final realpath must still be under a root
  let real = abs;
  try {
    if (fs.existsSync(abs)) real = fs.realpathSync(abs);
  } catch {
    // dangling is ok for parent checks; still require under root
  }
  const realRoot = roots.find((r) => real === r.path || real.startsWith(r.path + path.sep));
  if (!realRoot) return { ok: false, error: "symlink escapes allowlist" };

  return {
    ok: true,
    abs,
    real,
    root: realRoot,
    rel: path.relative(realRoot.path, abs),
  };
}

function isProbablyText(filePath, size) {
  const ext = path.extname(filePath).toLowerCase();
  const base = path.basename(filePath).toLowerCase();
  if (TEXT_EXT.has(ext)) return true;
  if (!ext && ["makefile", "dockerfile", "procfile", "license", "readme", "authors", "changelog"].includes(base)) return true;
  if (base.startsWith(".")) {
    // dotfiles often text
    if ([".gitignore", ".gitattributes", ".editorconfig", ".nvmrc", ".node-version"].includes(base)) return true;
  }
  // small unknown files — try
  if (size <= 256 * 1024 && !ext) return true;
  return false;
}

function formatBytes(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + " MB";
  return (n / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

async function detectGit(dirAbs) {
  // Walk up until root boundary looking for .git
  let cur = dirAbs;
  const roots = expandRoots().map((r) => r.path);
  for (let i = 0; i < 40; i++) {
    const gitPath = path.join(cur, ".git");
    try {
      const st = await fsp.stat(gitPath);
      if (st.isDirectory() || st.isFile()) {
        // collect branch + remote + dirty (best-effort, fast)
        let branch = null;
        let remote = null;
        let dirty = null;
        let shortHead = null;
        try {
          const { stdout: b } = await execFileAsync("git", ["-C", cur, "rev-parse", "--abbrev-ref", "HEAD"], { timeout: 2500 });
          branch = b.trim();
        } catch { /* */ }
        try {
          const { stdout: h } = await execFileAsync("git", ["-C", cur, "rev-parse", "--short", "HEAD"], { timeout: 2500 });
          shortHead = h.trim();
        } catch { /* */ }
        try {
          const { stdout: r } = await execFileAsync("git", ["-C", cur, "remote", "get-url", "origin"], { timeout: 2500 });
          remote = r.trim();
        } catch { /* */ }
        try {
          const { stdout: d } = await execFileAsync("git", ["-C", cur, "status", "--porcelain"], { timeout: 4000 });
          dirty = d.trim().length > 0;
        } catch { /* */ }
        return {
          isRepo: true,
          root: cur,
          isRepoRoot: path.resolve(cur) === path.resolve(dirAbs),
          branch,
          shortHead,
          remote,
          dirty,
        };
      }
    } catch { /* no .git here */ }

    const parent = path.dirname(cur);
    if (parent === cur) break;
    // stop at allowlist root boundary
    if (roots.includes(cur)) break;
    cur = parent;
  }
  return { isRepo: false };
}

async function listDir(rawPath, { showHidden = true, includeGit = true } = {}) {
  const roots = expandRoots();
  if (!rawPath) {
    // Virtual top: roots + quick project scan under /root
    const items = [];
    for (const r of roots) {
      let git = null;
      if (includeGit) {
        try { git = await detectGit(r.path); } catch { git = null; }
      }
      items.push({
        name: r.label,
        path: r.path,
        type: "dir",
        isRoot: true,
        rootId: r.id,
        kind: r.kind,
        git: git && git.isRepo ? git : null,
      });
    }
    // Project shortcuts under /root (depth 1), git-tagged
    try {
      const rootHome = roots.find((r) => r.id === "root");
      if (rootHome) {
        const ents = await fsp.readdir(rootHome.path, { withFileTypes: true });
        const projects = [];
        for (const ent of ents) {
          if (!ent.isDirectory()) continue;
          if (ent.name.startsWith(".")) continue;
          if (SKIP_DIR_NAMES.has(ent.name)) continue;
          const abs = path.join(rootHome.path, ent.name);
          let git = null;
          if (includeGit) {
            try { git = await detectGit(abs); } catch { /* */ }
          }
          // Only promote dirs that are git repos or known project-ish
          const promote = (git && git.isRepo) || /^(a-house|ahd|lsgd|metro|grand|corp|fores|lakeside|personal|rialto|savant|ticket|hermes)/i.test(ent.name);
          if (!promote) continue;
          let st;
          try { st = await fsp.stat(abs); } catch { continue; }
          projects.push({
            name: ent.name,
            path: abs,
            type: "dir",
            isProject: true,
            mtime: st.mtimeMs,
            git: git && git.isRepo ? git : null,
          });
        }
        projects.sort((a, b) => {
          const ag = a.git ? 0 : 1;
          const bg = b.git ? 0 : 1;
          if (ag !== bg) return ag - bg;
          return a.name.localeCompare(b.name);
        });
        return {
          path: null,
          virtual: "projects",
          breadcrumbs: [{ name: "Lakeside", path: null }],
          items: items.concat([{ type: "separator", name: "Projects on this box" }], projects),
        };
      }
    } catch { /* */ }
    return {
      path: null,
      virtual: "roots",
      breadcrumbs: [{ name: "Lakeside", path: null }],
      items,
    };
  }

  const resolved = resolveSafe(rawPath);
  if (!resolved.ok) return { error: resolved.error, status: 400 };
  if (isBlockedPath(resolved.abs)) return { error: "blocked path", status: 403 };

  let st;
  try {
    st = await fsp.stat(resolved.abs);
  } catch (e) {
    return { error: "not found", status: 404 };
  }
  if (!st.isDirectory()) return { error: "not a directory", status: 400 };

  let ents;
  try {
    ents = await fsp.readdir(resolved.abs, { withFileTypes: true });
  } catch (e) {
    return { error: e.message || "readdir failed", status: 500 };
  }

  const dirGit = includeGit ? await detectGit(resolved.abs).catch(() => ({ isRepo: false })) : { isRepo: false };

  const items = [];
  for (const ent of ents) {
    if (!showHidden && ent.name.startsWith(".")) continue;
    // Always hide .git contents listing as a normal folder entry but mark repo
    const abs = path.join(resolved.abs, ent.name);
    if (isBlockedPath(abs) && !ent.isDirectory()) {
      items.push({
        name: ent.name,
        path: abs,
        type: "file",
        blocked: true,
        size: null,
        mtime: null,
      });
      continue;
    }
    let est;
    try { est = await fsp.lstat(abs); } catch { continue; }
    const isDir = est.isDirectory();
    const isLink = est.isSymbolicLink();
    if (isDir && SKIP_DIR_NAMES.has(ent.name) && ent.name !== ".git") {
      // show collapsed stub so user knows it exists
      items.push({
        name: ent.name,
        path: abs,
        type: "dir",
        skipped: true,
        isSymlink: isLink,
        size: null,
        mtime: est.mtimeMs,
        git: ent.name === ".git" ? { isRepo: true, isRepoRoot: true } : null,
      });
      continue;
    }
    let childGit = null;
    if (includeGit && isDir && ent.name !== ".git") {
      // cheap: only check if this dir itself is a repo root
      try {
        await fsp.access(path.join(abs, ".git"));
        childGit = await detectGit(abs);
      } catch {
        childGit = null;
      }
    }
    items.push({
      name: ent.name,
      path: abs,
      type: isDir ? "dir" : "file",
      isSymlink: isLink,
      size: isDir ? null : est.size,
      sizeLabel: isDir ? null : formatBytes(est.size),
      mtime: est.mtimeMs,
      ext: isDir ? null : path.extname(ent.name).toLowerCase(),
      git: childGit && childGit.isRepo ? childGit : null,
      texty: !isDir && isProbablyText(abs, est.size || 0),
    });
    if (items.length >= MAX_LIST) break;
  }

  items.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  // breadcrumbs
  const crumbs = [{ name: "Lakeside", path: null }];
  const root = resolved.root;
  crumbs.push({ name: root.label || path.basename(root.path), path: root.path });
  if (resolved.rel) {
    const parts = resolved.rel.split(path.sep).filter(Boolean);
    let acc = root.path;
    for (const p of parts) {
      acc = path.join(acc, p);
      crumbs.push({ name: p, path: acc });
    }
  }

  return {
    path: resolved.abs,
    rootId: root.id,
    breadcrumbs: crumbs,
    git: dirGit && dirGit.isRepo ? dirGit : null,
    count: items.length,
    truncated: ents.length > items.length,
    items,
  };
}

async function readFileSafe(rawPath) {
  const resolved = resolveSafe(rawPath);
  if (!resolved.ok) return { error: resolved.error, status: 400 };
  if (isBlockedPath(resolved.abs)) return { error: "blocked path (secret-like)", status: 403 };

  let st;
  try { st = await fsp.stat(resolved.abs); } catch { return { error: "not found", status: 404 }; }
  if (!st.isFile()) return { error: "not a file", status: 400 };
  if (st.size > MAX_READ_BYTES) {
    return { error: `file too large (${formatBytes(st.size)}; max ${formatBytes(MAX_READ_BYTES)})`, status: 413 };
  }
  if (!isProbablyText(resolved.abs, st.size)) {
    return {
      error: "binary or unsupported type",
      status: 415,
      meta: {
        path: resolved.abs,
        size: st.size,
        sizeLabel: formatBytes(st.size),
        mtime: st.mtimeMs,
        ext: path.extname(resolved.abs).toLowerCase(),
      },
    };
  }

  const buf = await fsp.readFile(resolved.abs);
  // reject if lots of nulls
  let nul = 0;
  for (let i = 0; i < Math.min(buf.length, 8000); i++) if (buf[i] === 0) nul++;
  if (nul > 8) return { error: "binary file", status: 415 };

  const content = buf.toString("utf8");
  const git = await detectGit(path.dirname(resolved.abs)).catch(() => ({ isRepo: false }));

  return {
    path: resolved.abs,
    name: path.basename(resolved.abs),
    size: st.size,
    sizeLabel: formatBytes(st.size),
    mtime: st.mtimeMs,
    ext: path.extname(resolved.abs).toLowerCase(),
    content,
    writable: !isBlockedPath(resolved.abs),
    git: git && git.isRepo ? git : null,
  };
}

async function writeFileSafe(rawPath, content) {
  const resolved = resolveSafe(rawPath);
  if (!resolved.ok) return { error: resolved.error, status: 400 };
  if (isBlockedPath(resolved.abs)) return { error: "blocked path (secret-like)", status: 403 };

  if (typeof content !== "string") return { error: "content must be string", status: 400 };
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > MAX_WRITE_BYTES) return { error: "content too large", status: 413 };

  // Must exist as file already (no create-new for safety v1) OR parent exists and name looks like text
  let exists = false;
  try {
    const st = await fsp.stat(resolved.abs);
    if (!st.isFile()) return { error: "not a file", status: 400 };
    exists = true;
  } catch {
    exists = false;
  }

  if (!exists) {
    // allow create only if parent is under allowlist and not blocked
    const parent = path.dirname(resolved.abs);
    const pre = resolveSafe(parent);
    if (!pre.ok) return { error: "parent outside allowlist", status: 400 };
    let pst;
    try { pst = await fsp.stat(parent); } catch { return { error: "parent missing", status: 404 }; }
    if (!pst.isDirectory()) return { error: "parent not directory", status: 400 };
  }

  // backup existing
  let backup = null;
  if (exists) {
    backup = resolved.abs + ".finder-bak";
    try { await fsp.copyFile(resolved.abs, backup); } catch { backup = null; }
  }

  await fsp.writeFile(resolved.abs, content, "utf8");
  const st = await fsp.stat(resolved.abs);
  return {
    ok: true,
    path: resolved.abs,
    size: st.size,
    sizeLabel: formatBytes(st.size),
    mtime: st.mtimeMs,
    backup,
  };
}

async function gitSummary(rawPath) {
  const resolved = resolveSafe(rawPath);
  if (!resolved.ok) return { error: resolved.error, status: 400 };
  const target = resolved.abs;
  let st;
  try { st = await fsp.stat(target); } catch { return { error: "not found", status: 404 }; }
  const dir = st.isDirectory() ? target : path.dirname(target);
  const git = await detectGit(dir);
  if (!git.isRepo) return { isRepo: false, path: target };
  // recent log
  let log = [];
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", git.root, "log", "-8", "--pretty=format:%h|%ad|%an|%s", "--date=short"],
      { timeout: 4000 }
    );
    log = stdout.split("\n").filter(Boolean).map((line) => {
      const [hash, date, author, ...rest] = line.split("|");
      return { hash, date, author, subject: rest.join("|") };
    });
  } catch { /* */ }
  return { ...git, path: target, log };
}

module.exports = {
  ROOTS,
  expandRoots,
  resolveSafe,
  listDir,
  readFileSafe,
  writeFileSafe,
  gitSummary,
  detectGit,
  formatBytes,
};
