// code-agent.js — Agentic coding module for Ops Dashboard
// Provides a full read/write/terminal/git coding agent over WebSocket.
// Admin-only. Operates on the configured project repository.
//
// Exports: setupCodeAgent(server, opts)
//   opts: { repoDir, llmProvider, llmModel, llmApiUrl, llmApiKey }

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync, spawn } = require("child_process");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");
const { getConfig } = require("./src/core/config");

// ── Command risk classification ──────────────────────────────────

const DANGEROUS_PATTERNS = [
  /\brm\s+(-[a-zA-Z]*f|-[a-zA-Z]*r)/,    // rm -f, rm -rf, rm -fr
  /\brm\s+-[a-zA-Z]*[fr][a-zA-Z]*[fr]/,   // rm -rf combinations
  /\bgit\s+(reset\s+--hard|clean\s+-[a-zA-Z]*f|push\s*--force|checkout\s+--\s+\.)/,
  /\bDROP\s+(TABLE|DATABASE|COLLECTION)\b/i,
  /\bchmod\s+(777|000)\b/,
  /\b(mkfs|fdisk|dd\s+if=)\b/,
  /\bkill\s+-9\s+1\b/,
  />\s*\/dev\/sd[a-z]/,
  /\bcurl\b.*\|\s*(bash|sh)\b/,
];

const MODERATE_PATTERNS = [
  /\bnpm\s+(install|ci|uninstall)\b/,
  /\bgit\s+(commit|checkout|merge|rebase|stash|branch\s+-[dD])\b/,
  /\b(tsc|eslint|prettier)\b/,
  /\bnpm\s+run\b/,
  /\bnode\s+(--check|-e)\b/,
];

function classifyCommand(cmd) {
  const trimmed = cmd.trim();
  if (DANGEROUS_PATTERNS.some(p => p.test(trimmed))) return "dangerous";
  if (MODERATE_PATTERNS.some(p => p.test(trimmed))) return "moderate";
  return "safe";
}

// ── Path safety ──────────────────────────────────────────────────

function isInsideRepo(filePath, repoDir) {
  const resolved = path.resolve(repoDir, filePath);
  return resolved.startsWith(repoDir + path.sep) || resolved === repoDir;
}

function safePath(filePath, repoDir) {
  const clean = String(filePath || "").replace(/^\/+/, "");
  const resolved = path.resolve(repoDir, clean);
  if (!resolved.startsWith(repoDir)) return null;
  return resolved;
}

// ── Tool definitions (OpenAI function-calling format) ────────────

const TOOLS = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a file from the codebase. Returns content up to 100K chars. Use relative paths like 'src/lib/economy.ts'.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative file path (e.g. 'src/lib/economy.ts')" },
          offset: { type: "number", description: "Line number to start from (1-indexed, default 1)" },
          limit: { type: "number", description: "Max lines to read (default 500)" }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "read_files",
      description: "Read multiple files in one call (up to 10). Faster than repeated read_file calls.",
      parameters: {
        type: "object",
        properties: {
          paths: {
            type: "array",
            items: { type: "string" },
            description: "Relative file paths (max 10)"
          }
        },
        required: ["paths"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Write content to a file, creating it if needed. Overwrites existing content. Use for new files or full rewrites.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative file path" },
          content: { type: "string", description: "Full file content to write" }
        },
        required: ["path", "content"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "patch",
      description: "Find-and-replace edit in a file. Finds a unique string and replaces it. Preferred for targeted edits.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative file path" },
          old_string: { type: "string", description: "Exact text to find (must be unique in file)" },
          new_string: { type: "string", description: "Replacement text" }
        },
        required: ["path", "old_string", "new_string"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description: "Search file contents with regex. Returns matching lines with line numbers. Searches ALL files by default — only pass `glob` to narrow to specific file types.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Regex pattern to search for" },
          glob: { type: "string", description: "Optional file glob filter (e.g. '*.ts', '*.{ts,tsx}'). Omit to search every file." },
          limit: { type: "number", description: "Max results (default 30)" }
        },
        required: ["pattern"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "find_files",
      description: "Find files by name. Matching is case-insensitive; a bare word (e.g. 'inflation') matches as a substring, and glob metacharacters (* ? []) are honored. Returns matching file paths.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Name or glob (e.g. 'inflation', '*.ts', 'src/lib/*.ts')" },
          limit: { type: "number", description: "Max results (default 30)" }
        },
        required: ["pattern"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "terminal",
      description: "Run a shell command in the repo directory. Returns stdout, stderr, and exit code. Working directory is the repo root.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to execute" },
          timeout: { type: "number", description: "Timeout in seconds (default 60)" }
        },
        required: ["command"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "git_status",
      description: "Show git working tree status (modified, added, deleted files, current branch).",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "git_diff",
      description: "Show git diff. Defaults to unstaged changes. Pass staged=true for staged changes.",
      parameters: {
        type: "object",
        properties: {
          staged: { type: "boolean", description: "Show staged diff instead of unstaged (default false)" },
          file: { type: "string", description: "Diff a specific file only" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "git_log",
      description: "Show recent git log. Returns commit hash, author, date, and message.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of commits (default 10)" },
          file: { type: "string", description: "Log for a specific file only" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "git_commit",
      description: "Stage specified files and commit with a message. Only stages the files you list — does NOT do a blanket 'git add .'.",
      parameters: {
        type: "object",
        properties: {
          files: {
            type: "array",
            items: { type: "string" },
            description: "Relative file paths to stage"
          },
          message: { type: "string", description: "Commit message" }
        },
        required: ["files", "message"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "use_skill",
      description: "Load a project skill by name. Project skills live under PROJECT_SKILLS_DIR (default: the repository's .claude/skills/) and shared skills under HERMES_SKILLS_DIR.",
      parameters: {
        type: "object",
        properties: {
          skill: {
            type: "string",
            description: "Skill name from the project or shared skill directory."
          }
        },
        required: ["skill"]
      }
    }
  }
];

// ── Skills ──────────────────────────────────────────────────────
function projectSkillsDir(repoDir) {
  return process.env.PROJECT_SKILLS_DIR || getConfig().codeAgent?.skillsDir || path.join(repoDir, ".claude", "skills");
}

function getProjectSkillNames(repoDir) {
  const dir = projectSkillsDir(repoDir);
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && /^[a-z0-9-]+$/.test(entry.name))
      .map(entry => entry.name)
      .filter(name => fs.existsSync(path.join(dir, name, "SKILL.md")))
      .sort();
  } catch { return []; }
}

// The broader Hermes skill library — these are general-purpose skills that
// complement project-specific ones. We expose the full union to the LLM
// (minus hermes itself, which is the meta-skill for the runtime).
const HERMES_SKILLS_DIR = (() => {
  if (process.env.HERMES_SKILLS_DIR) return process.env.HERMES_SKILLS_DIR;
  if (process.env.SKILLS_DIR) return process.env.SKILLS_DIR;
  try {
    const { getConfig } = require("./src/core/config");
    return getConfig().paths.hermesSkillsDir || "";
  } catch {
    return "";
  }
})();
const HERMES_SKILL_BLACKLIST = new Set(["hermes"]);
let _hermesSkills = null;
function getHermesSkillNames() {
  if (_hermesSkills) return _hermesSkills;
  if (!HERMES_SKILLS_DIR) {
    _hermesSkills = [];
    return _hermesSkills;
  }
  try {
    _hermesSkills = fs.readdirSync(HERMES_SKILLS_DIR, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith(".") && !HERMES_SKILL_BLACKLIST.has(e.name))
      .map(e => e.name)
      .filter(n => /^[a-z0-9-]+$/.test(n))
      // Only include directories that have a SKILL.md (skip empty/archived ones)
      .filter(n => fs.existsSync(path.join(HERMES_SKILLS_DIR, n, "SKILL.md")))
      .sort();
  } catch {
    _hermesSkills = [];
  }
  return _hermesSkills;
}

// ── Tool execution ───────────────────────────────────────────────

// Run a shell command capturing stdout/stderr/exit code WITHOUT throwing.
// execSync throws on any non-zero exit, but for search tools a non-zero exit
// is usually "no matches" (rg/grep exit 1) rather than a real failure — we
// need to tell those apart instead of silently collapsing both to "(empty)".
function runShell(cmd, repoDir, timeout = 15000) {
  try {
    const stdout = execSync(cmd, { cwd: repoDir, encoding: "utf8", timeout, maxBuffer: 1024 * 1024 });
    return { stdout, stderr: "", code: 0 };
  } catch (e) {
    return {
      stdout: e.stdout || "",
      stderr: e.stderr || "",
      code: typeof e.status === "number" ? e.status : 1,
    };
  }
}

// Cache ripgrep availability — if rg isn't installed, search_files would
// otherwise return nothing for *every* query (the old code swallowed the
// "command not found" via `2>/dev/null`).
let _rgAvailable = null;
function rgAvailable() {
  if (_rgAvailable !== null) return _rgAvailable;
  try {
    execSync("command -v rg", { encoding: "utf8", timeout: 3000 });
    _rgAvailable = true;
  } catch {
    _rgAvailable = false;
  }
  return _rgAvailable;
}

function executeTool(name, args, repoDir) {
  try {
    switch (name) {
      case "read_file": {
        const absPath = safePath(args.path, repoDir);
        if (!absPath) return { error: "Path outside repo" };
        if (!fs.existsSync(absPath)) return { error: `File not found: ${args.path}` };
        const stat = fs.statSync(absPath);
        if (stat.isDirectory()) return { error: `${args.path} is a directory` };
        const lines = fs.readFileSync(absPath, "utf8").split("\n");
        const offset = Math.max(1, args.offset || 1);
        const limit = Math.min(2000, args.limit || 500);
        const slice = lines.slice(offset - 1, offset - 1 + limit);
        const numbered = slice.map((l, i) => `${offset + i}|${l}`).join("\n");
        return { content: numbered, totalLines: lines.length, path: args.path };
      }

      case "read_files": {
        const paths = (args.paths || []).slice(0, 10);
        const results = [];
        for (const p of paths) {
          const absPath = safePath(p, repoDir);
          if (!absPath) { results.push({ path: p, error: "Path outside repo" }); continue; }
          if (!fs.existsSync(absPath)) { results.push({ path: p, error: "Not found" }); continue; }
          const content = fs.readFileSync(absPath, "utf8").slice(0, 100000);
          results.push({ path: p, content, size: content.length });
        }
        return { files: results };
      }

      case "write_file": {
        const absPath = safePath(args.path, repoDir);
        if (!absPath) return { error: "Path outside repo" };
        // Block writing to sensitive files
        const basename = path.basename(absPath);
        if (/^\.env/.test(basename) || basename === "package-lock.json") {
          return { error: `Refused: cannot write to ${basename}` };
        }
        fs.mkdirSync(path.dirname(absPath), { recursive: true });
        fs.writeFileSync(absPath, args.content, "utf8");
        return { ok: true, path: args.path, bytes: Buffer.byteLength(args.content) };
      }

      case "patch": {
        const absPath = safePath(args.path, repoDir);
        if (!absPath) return { error: "Path outside repo" };
        if (!fs.existsSync(absPath)) return { error: `File not found: ${args.path}` };
        const content = fs.readFileSync(absPath, "utf8");
        const idx = content.indexOf(args.old_string);
        if (idx === -1) return { error: "old_string not found in file" };
        // Check uniqueness
        const secondIdx = content.indexOf(args.old_string, idx + 1);
        if (secondIdx !== -1) return { error: "old_string is not unique — include more surrounding context" };
        const patched = content.slice(0, idx) + args.new_string + content.slice(idx + args.old_string.length);
        fs.writeFileSync(absPath, patched, "utf8");
        return { ok: true, path: args.path, bytesChanged: Buffer.byteLength(args.new_string) - Buffer.byteLength(args.old_string) };
      }

      case "search_files": {
        // Default to *all* files, not just *.{ts,tsx,js,jsx,json}. The old
        // narrow default silently excluded .py/.md/.css/.html/.yml etc., so
        // searches over those file types always came back empty.
        const glob = args.glob || null;
        const limit = Math.min(100, args.limit || 30);
        const useRg = rgAvailable();
        const engine = useRg ? "rg" : "grep";
        // No `2>/dev/null`, no pipe to `head` — keep the engine's real exit
        // code so we can distinguish "no matches" from an actual error, and
        // cap results in JS instead.
        const cmd = useRg
          ? `rg --no-heading -n --max-count=5${glob ? ` -g ${JSON.stringify(glob)}` : ""} -e ${JSON.stringify(args.pattern)} .`
          : `grep -rnI --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next${glob ? ` --include=${JSON.stringify(glob)}` : ""} -e ${JSON.stringify(args.pattern)} .`;
        const r = runShell(cmd, repoDir);
        // rg/grep: exit 0 = matches, exit 1 = no matches, exit >=2 = real error.
        if (r.code >= 2) {
          return {
            error: `search failed (${engine}): ${(r.stderr || "unknown error").trim().split("\n")[0]}`,
            pattern: args.pattern, glob: glob || "(all files)", engine, command: cmd,
          };
        }
        let matches = r.stdout.trim() ? r.stdout.trim().split("\n") : [];
        const total = matches.length;
        if (matches.length > limit) matches = matches.slice(0, limit);
        return {
          matches, count: total, truncated: total > limit,
          pattern: args.pattern, glob: glob || "(all files)", engine, command: cmd,
        };
      }

      case "find_files": {
        const limit = Math.min(100, args.limit || 30);
        const pat = String(args.pattern || "").trim();
        const exclude = "-not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/.next/*'";
        let cmd;
        if (pat.includes("/") || pat.includes("**")) {
          // Path-ish pattern → match against the whole path, case-insensitive.
          const p = pat.replace(/^\.?\/+/, "").replace(/\*\*/g, "*");
          cmd = `find . ${exclude} -ipath ${JSON.stringify("*" + p + "*")}`;
        } else {
          // Bare word with no glob metachars → treat as a substring match.
          // `-name foo` (the old behaviour) required an exact basename, so
          // any non-glob query returned nothing.
          const namePat = /[*?[\]]/.test(pat) ? pat : `*${pat}*`;
          cmd = `find . ${exclude} -iname ${JSON.stringify(namePat)}`;
        }
        const r = runShell(cmd, repoDir);
        if (r.code >= 1 && !r.stdout.trim() && r.stderr.trim()) {
          return { error: `find failed: ${r.stderr.trim().split("\n")[0]}`, pattern: args.pattern, command: cmd };
        }
        let files = r.stdout.trim() ? r.stdout.trim().split("\n") : [];
        const total = files.length;
        if (files.length > limit) files = files.slice(0, limit);
        return { files, count: total, truncated: total > limit, pattern: args.pattern, command: cmd };
      }

      case "terminal": {
        const timeout = Math.min(120, args.timeout || 60) * 1000;
        // Env scrub: don't inherit secrets
        const env = { ...process.env };
        delete env.MONGODB_URI;
        delete env.KIMI_API_KEY;
        delete env.OLLAMA_CLOUD_KEY;
        delete env.LLM_API_KEY;
        delete env.OPS_PASSWORD_HASH;
        delete env.OPENCODE_GO_API_KEY;
        try {
          const out = execSync(args.command, {
            cwd: repoDir,
            encoding: "utf8",
            timeout,
            maxBuffer: 1024 * 1024,
            env,
            stdio: ["pipe", "pipe", "pipe"],
          });
          return { stdout: out.trim(), exit_code: 0 };
        } catch (e) {
          return {
            stdout: (e.stdout || "").trim(),
            stderr: (e.stderr || "").trim(),
            exit_code: e.status || 1,
          };
        }
      }

      case "git_status": {
        const out = execSync("git status --short --branch", { cwd: repoDir, encoding: "utf8", timeout: 10000 });
        return { status: out.trim() };
      }

      case "git_diff": {
        let cmd = "git diff";
        if (args.staged) cmd += " --staged";
        if (args.file) {
          const absPath = safePath(args.file, repoDir);
          if (absPath) cmd += ` -- ${JSON.stringify(args.file)}`;
        }
        const out = execSync(cmd, { cwd: repoDir, encoding: "utf8", timeout: 15000, maxBuffer: 1024 * 1024 });
        return { diff: out.trim() || "(no changes)" };
      }

      case "git_log": {
        const limit = Math.min(50, args.limit || 10);
        let cmd = `git log --oneline --no-decorate -${limit}`;
        if (args.file) cmd += ` -- ${JSON.stringify(args.file)}`;
        const out = execSync(cmd, { cwd: repoDir, encoding: "utf8", timeout: 10000 });
        return { log: out.trim() || "(no commits)" };
      }

      case "git_commit": {
        const files = (args.files || []).map(f => safePath(f, repoDir)).filter(Boolean);
        if (!files.length) return { error: "No valid files to stage" };
        if (!args.message) return { error: "Commit message required" };
        for (const f of files) {
          execSync(`git add ${JSON.stringify(path.relative(repoDir, f))}`, { cwd: repoDir, encoding: "utf8", timeout: 10000 });
        }
        // Write message to a temp file and use `git commit -F` to preserve newlines,
        // quotes, and other characters exactly. Using JSON.stringify + shell -m
        // double-escapes \n into literal "\n" in the committed message.
        const tmp = path.join(os.tmpdir(), `ops-code-commit-${Date.now()}-${process.pid}.txt`);
        fs.writeFileSync(tmp, args.message);
        let out;
        try {
          out = execSync(`git commit -F ${JSON.stringify(tmp)}`, { cwd: repoDir, encoding: "utf8", timeout: 15000 });
        } finally {
          try { fs.unlinkSync(tmp); } catch {}
        }
        return { commit: out.trim(), message: args.message };
      }

      case "use_skill": {
        const skillName = args.skill;
        if (!skillName || !/^[a-z0-9-]+$/.test(skillName)) return { error: "Invalid skill name" };
        const projectSkillsPath = projectSkillsDir(repoDir);
        // Look in project skills first, then the broader Hermes library
        const candidates = [
          path.join(projectSkillsPath, skillName, "SKILL.md"),
          HERMES_SKILLS_DIR ? path.join(HERMES_SKILLS_DIR, skillName, "SKILL.md") : null,
        ].filter(Boolean);
        for (const skillPath of candidates) {
          if (fs.existsSync(skillPath)) {
            let content = fs.readFileSync(skillPath, "utf8");
            // Strip YAML frontmatter
            content = content.replace(/^---[\s\S]*?---\n?/, "");
            const source = skillPath.startsWith(projectSkillsPath + path.sep) ? "project" : "shared";
            return { skill: skillName, source, content };
          }
        }
        return {
          error: `Skill not found: ${skillName}`,
          available: { project: getProjectSkillNames(repoDir), shared: getHermesSkillNames() },
        };
      }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return { error: `${name} failed: ${e.message}` };
  }
}

// ── Codebase map builder ─────────────────────────────────────────

function buildCodebaseMap(repoDir) {
  const dirs = [
    "src/lib", "src/app/api", "src/components", "src/hooks", "src/types",
    "src/app", "docs", "scripts", "public"
  ];
  const lines = [`${path.basename(repoDir)} Codebase Map`, "════════════════"];
  for (const d of dirs) {
    const absDir = path.join(repoDir, d);
    if (!fs.existsSync(absDir)) continue;
    try {
      const entries = fs.readdirSync(absDir, { withFileTypes: true })
        .filter(e => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules")
        .map(e => e.name)
        .slice(0, 25);
      if (entries.length) lines.push(`${d}/ — ${entries.join(", ")}`);
    } catch {}
  }
  return lines.join("\n");
}

// ── System prompt ────────────────────────────────────────────────

function buildSystemPrompt(codebaseMap, repoDir) {
  const promptFile = getConfig().codeAgent?.promptFile;
  if (promptFile) {
    const fullPath = path.resolve(__dirname, promptFile);
    const prompt = fs.readFileSync(fullPath, "utf8");
    return prompt.replaceAll("{{CODEBASE_MAP}}", codebaseMap);
  }
  return `You are a coding agent working in ${path.basename(repoDir)}.
Read the repository instructions and nearby code before editing. Keep changes focused,
run the relevant checks, and report the files changed and results. Protect secrets
and preserve uncommitted or unlanded worktrees.

${codebaseMap}`;
}

// ── Agent loop (per WebSocket connection) ────────────────────────

function setupCodeAgent(server, opts) {
  const { repoDir, llmProvider, llmModel, llmApiUrl, llmApiKey } = opts;
  const codebaseMap = buildCodebaseMap(repoDir);
  const systemPrompt = buildSystemPrompt(codebaseMap, repoDir);

  const wss = new WebSocketServer({ noServer: true });

  // WebSocket upgrade handling
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url, `http://localhost`);
    if (url.pathname !== "/api/code/ws") {
      return; // Not our route
    }

    // Parse session cookie for auth
    const cookies = (req.headers["cookie"] || "").split(";").map(c => c.trim());
    const sessionCookie = cookies.find(c => c.startsWith("ops_session="));
    const token = sessionCookie?.split("=").slice(1).join("=");

    if (!token || !opts.checkSession(token)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    const session = opts.checkSession(token);
    if (session.role !== "admin") {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      ws._session = session;
      handleConnection(ws, opts);
    });
  });

  console.log("[code-agent] WebSocket agent ready at /api/code/ws");
  return wss;
}

function handleConnection(ws, opts) {
  const { repoDir, llmProvider, llmModel, llmApiUrl, llmApiKey } = opts;
  const codebaseMap = buildCodebaseMap(repoDir);
  const systemPrompt = buildSystemPrompt(codebaseMap, repoDir);

  // Per-connection state
  let messages = [];       // Conversation history
  let abortController = null;
  let isRunning = false;
  let pendingApproval = null;  // { resolve, command, risk }

  function send(type, data) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type, ...data }));
    }
  }
  // Stage events are short status updates ("Initializing agent", "Reading file X")
  // streamed to the UI so the user can see what the agent is doing at each step
  // — they don't get recorded in the LLM's conversation history.
  function sendStage(text) { send("stage", { text }); }
  // Build a human-readable "what is happening" label for a given tool call.
  function stageForTool(name, args) {
    switch (name) {
      case "read_file": return `Reading ${args?.path || "file"}`;
      case "read_files": return `Reading ${(args?.paths || []).length} files`;
      case "write_file": return `Writing ${args?.path || "file"}`;
      case "patch": return `Patching ${args?.path || "file"}`;
      case "search_files": return `Searching for ${args?.pattern || ""}`;
      case "find_files": return `Finding ${args?.pattern || ""}`;
      case "terminal": return `Running \`${(args?.command || "").slice(0, 60)}\``;
      case "git_status": return "Checking git status";
      case "git_diff": return "Viewing diff";
      case "git_log": return "Reading git log";
      case "git_commit": return "Creating commit";
      case "git_branch": return "Switching branch";
      case "tsc_check": return "Type-checking";
      case "use_skill": return `Loading skill ${args?.skill || ""}`;
      case "web_fetch": return `Fetching ${args?.url || ""}`;
      case "list_directory": return "Listing directory";
      case "vision_analyze": return "Analyzing image";
      default: return `Running ${name}`;
    }
  }

  // ── Agent loop ─────────────────────────────────────────────

  async function runAgent(userMessage) {
    if (isRunning) {
      send("error", { error: "Agent is already processing a message" });
      return;
    }
    isRunning = true;
    abortController = new AbortController();
    sendStage("Initializing agent");

    // Add user message to history
    messages.push({ role: "user", content: userMessage });

    // Build message list for LLM
    const llmMessages = [
      { role: "system", content: systemPrompt },
      ...messages,
    ];

    const MAX_ROUNDS = 30;
    let answerSent = false;

    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        if (abortController.signal.aborted) break;

        sendStage(round === 0 ? "Planning approach" : `Reasoning (round ${round + 1})`);
        send("thinking", { round });

        // Call LLM
        const reqHeaders = {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${llmApiKey}`,
        };
        if (llmProvider === "kimi") reqHeaders["User-Agent"] = "claude-code/1.0";

        const controller = new AbortController();
        abortController.signal.addEventListener("abort", () => controller.abort());
        const timeout = setTimeout(() => controller.abort(), 300000);

        sendStage("Asking model");

        let llmRes;
        try {
          llmRes = await fetch(llmApiUrl, {
            method: "POST",
            headers: reqHeaders,
            body: JSON.stringify({
              model: llmModel,
              messages: llmMessages,
              tools: TOOLS,
              temperature: 0.2,
              max_tokens: 16000,
            }),
            signal: controller.signal,
          });
        } catch (e) {
          clearTimeout(timeout);
          if (e.name === "AbortError") {
            send("error", { error: "Request cancelled or timed out" });
            break;
          }
          send("error", { error: `LLM API error: ${e.message}` });
          break;
        }
        clearTimeout(timeout);

        if (!llmRes.ok) {
          const errText = await llmRes.text().catch(() => "");
          send("error", { error: `LLM returned ${llmRes.status}: ${errText.slice(0, 200)}` });
          break;
        }

        const data = await llmRes.json();
        const msg = data.choices?.[0]?.message;
        if (!msg) {
          send("error", { error: "No response from model" });
          break;
        }

        // Handle reasoning content (Kimi)
        if (msg.reasoning_content) {
          send("thinking_content", { content: msg.reasoning_content });
        }

        // If text response with no tool calls → we're done
        if (msg.content && !msg.tool_calls?.length) {
          messages.push({ role: "assistant", content: msg.content });
          sendStage("Composing final answer");
          send("answer", { text: msg.content, model: llmModel });
          answerSent = true;
          break;
        }

        // Process tool calls
        if (msg.tool_calls?.length) {
          // Add assistant message with tool_calls to history
          const assistantMsg = {
            role: "assistant",
            content: msg.content || null,
            tool_calls: msg.tool_calls,
          };
          if (msg.reasoning_content) assistantMsg.reasoning_content = msg.reasoning_content;
          llmMessages.push(assistantMsg);
          messages.push(assistantMsg);

          for (const tc of msg.tool_calls) {
            if (abortController.signal.aborted) break;

            const fnName = tc.function.name;
            let fnArgs;
            try {
              fnArgs = typeof tc.function.arguments === "string"
                ? JSON.parse(tc.function.arguments)
                : tc.function.arguments;
            } catch {
              fnArgs = {};
            }

            send("tool_start", { id: tc.id, tool: fnName, args: fnArgs });
            sendStage(stageForTool(fnName, fnArgs));

            // Approval check for dangerous terminal commands
            if (fnName === "terminal") {
              const risk = classifyCommand(fnArgs.command);
              if (risk === "dangerous") {
                sendStage("Awaiting approval for risky command");
                const approved = await requestApproval(fnArgs.command, risk);
                if (!approved) {
                  const toolResult = { error: "Command denied by user" };
                  send("tool_result", { id: tc.id, tool: fnName, result: toolResult });
                  llmMessages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(toolResult) });
                  messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(toolResult) });
                  continue;
                }
              }
            }

            // Execute tool
            const result = executeTool(fnName, fnArgs, repoDir);

            // Send result to client (truncate large outputs)
            const resultStr = JSON.stringify(result);
            const truncated = resultStr.length > 50000
              ? { ...result, _truncated: true, _originalSize: resultStr.length }
              : result;

            // For diffs, send a special diff event
            if (fnName === "git_diff" && result.diff && result.diff !== "(no changes)") {
              send("diff", { content: result.diff });
            }
            // For write_file/patch, generate a git diff to show what changed
            if ((fnName === "write_file" || fnName === "patch") && result.ok) {
              sendStage(`Verifying change to ${fnArgs.path}`);
              try {
                const diff = execSync(`git diff -- ${JSON.stringify(fnArgs.path)}`, {
                  cwd: repoDir, encoding: "utf8", timeout: 5000, maxBuffer: 512 * 1024,
                });
                if (diff.trim()) send("diff", { file: fnArgs.path, content: diff });
              } catch {}
            }

            send("tool_result", { id: tc.id, tool: fnName, result: truncated });

            llmMessages.push({ role: "tool", tool_call_id: tc.id, content: resultStr });
            messages.push({ role: "tool", tool_call_id: tc.id, content: resultStr });
          }
        } else {
          // No tool calls and no content — edge case
          send("error", { error: "Model returned empty response" });
          break;
        }
      }

      if (!answerSent && !abortController.signal.aborted) {
        send("answer", { text: "Reached maximum tool rounds without a final answer. Try breaking your request into smaller steps.", model: llmModel });
      }
    } catch (e) {
      console.error("[code-agent] Agent loop error:", e);
      send("error", { error: `Agent error: ${e.message}` });
    } finally {
      isRunning = false;
      abortController = null;
      if (pendingApproval) {
        pendingApproval.resolve(false);
        pendingApproval = null;
      }
      send("done", { messageCount: messages.length });
    }
  }

  // ── Approval flow ──────────────────────────────────────────

  function requestApproval(command, risk) {
    return new Promise((resolve) => {
      const id = crypto.randomUUID();
      pendingApproval = { id, resolve, command, risk };
      send("approval_required", { id, command, risk });
      // Auto-deny after 60 seconds
      setTimeout(() => {
        if (pendingApproval?.id === id) {
          pendingApproval.resolve(false);
          pendingApproval = null;
          send("tool_result", { id, tool: "terminal", result: { error: "Approval timed out" } });
        }
      }, 60000);
    });
  }

  // ── Message handler ────────────────────────────────────────

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      send("error", { error: "Invalid JSON" });
      return;
    }

    switch (msg.type) {
      case "message":
        if (!msg.content || typeof msg.content !== "string") {
          send("error", { error: "Message content required" });
          return;
        }
        if (msg.content.length > 10000) {
          send("error", { error: "Message too long (max 10000 chars)" });
          return;
        }
        sendStage("Received prompt");
        runAgent(msg.content);
        break;

      case "cancel":
        if (abortController) {
          abortController.abort();
          send("cancelled", {});
        }
        break;

      case "approve":
        if (pendingApproval && msg.id === pendingApproval.id) {
          pendingApproval.resolve(true);
          send("approved", { id: msg.id });
          pendingApproval = null;
        }
        break;

      case "deny":
        if (pendingApproval && msg.id === pendingApproval.id) {
          pendingApproval.resolve(false);
          send("denied", { id: msg.id });
          pendingApproval = null;
        }
        break;

      case "reset":
        messages = [];
        if (abortController) abortController.abort();
        isRunning = false;
        pendingApproval = null;
        send("reset", {});
        break;

      case "pin":
        // Acknowledge pinned files (client-side tracking)
        send("pinned", { files: msg.files || [] });
        break;

      default:
        send("error", { error: `Unknown message type: ${msg.type}` });
    }
  });

  ws.on("close", () => {
    if (abortController) abortController.abort();
    isRunning = false;
    pendingApproval = null;
  });

  // Welcome message
  send("connected", { model: llmModel, repo: path.basename(opts.repoDir) });
}

module.exports = { setupCodeAgent };
