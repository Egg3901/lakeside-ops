// Security MCP — gives agents on-demand Semgrep security scanning of the
// A House Divided codebase (license-clean Semgrep OSS, via Docker). The whole
// point: an agent working on AHD can audit a path or its own diff before PR.
// Streamable HTTP + scoped bearer-token auth. Read-only (mounts repo :ro).
//   node mcp/security-server.js   (default :9733)
require("dotenv").config({ quiet: true, path: require("path").join(__dirname, "..", ".env") });
const path = require("path");
const { z } = require("zod");
const { execFile } = require("child_process");
const fs = require("fs");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { createServer } = require("../packages/mcp-server");
const store = require("../knowledge-store");
const tokens = require("../agent-tokens");
const { primaryRepoDir } = require("../src/core/paths");

const PORT = parseInt(process.env.SECURITY_MCP_PORT || "9733", 10);
const REPO = process.env.AHD_GAME_REPO || primaryRepoDir();
const RULES = path.join(__dirname, "..", "security", "semgrep");
const LATEST = "/var/lib/ahd-semgrep/latest.json";
const CONFIGS = ["--config=p/security-audit", "--config=p/secrets", "--config=p/owasp-top-ten", "--config=/rules/ahd-rules.yml"];

function runSemgrep(targets) {
  return new Promise((resolve, reject) => {
    const tgt = targets && targets.length ? targets.map((t) => "/src/" + t.replace(/^\/+/, "")) : ["/src"];
    const args = ["run", "--rm", "--memory", "3g", "-v", `${REPO}:/src:ro`, "-v", `${RULES}:/rules:ro`,
      "semgrep/semgrep", "semgrep", "scan", ...CONFIGS, "--metrics=off", "--json", "--quiet", "--timeout", "60", ...tgt];
    execFile("docker", args, { maxBuffer: 96 * 1024 * 1024, timeout: 240000 }, (err, stdout) => {
      if (stdout && stdout.trim()) { try { return resolve(JSON.parse(stdout)); } catch (e) { /* fallthrough */ } }
      reject(err || new Error("semgrep produced no parseable output"));
    });
  });
}
function summarize(data, cap = 50) {
  const res = (data.results || []).map((r) => ({
    rule: (r.check_id || "?").split(".").pop(), severity: (r.extra || {}).severity || "INFO",
    file: r.path.replace(/^\/src\//, "").replace(/^.*a-house-divided\//, ""), line: r.start && r.start.line,
    message: ((r.extra || {}).message || "").trim().slice(0, 200),
  }));
  const order = { ERROR: 0, WARNING: 1, INFO: 2 };
  res.sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3));
  const by = res.reduce((m, f) => ((m[f.severity] = (m[f.severity] || 0) + 1), m), {});
  return { total: res.length, bySeverity: by, findings: res.slice(0, cap), truncated: res.length > cap };
}

async function main() {
  const db = await store.getDb(process.env.MONGODB_URI);
  await tokens.ensureIndexes(db);

  function buildServer() {
    const server = new McpServer({ name: "ops-security", version: "1.0.0" });

    server.tool("security_scan",
      "Run a Semgrep security scan on a path in the A House Divided repo (NoSQL injection, authz/IDOR, secrets, OWASP + AHD custom rules). Default scans the API surface. Scope to a folder for speed.",
      { path: z.string().optional().default("src/app/api").describe("repo-relative path, e.g. src/app/api/admin") },
      async ({ path }) => {
        try { return jsonResult({ scanned: path, ...summarize(await runSemgrep([path])) }); }
        catch (e) { return errorResult(e.message); }
      });

    server.tool("security_scan_changes",
      "Scan ONLY the TypeScript files changed versus a base branch — for auditing a feature branch / PR before merge.",
      { base: z.string().optional().default("origin/development").describe("base git ref to diff against") },
      async ({ base }) => {
        // `base` is caller-supplied and lands in a git argv slot. execFile with
        // an array stops SHELL injection, but not ARGUMENT injection: git reads
        // a leading dash as an option, so a base of "--output=/path/evil" made
        // git write that file AS ROOT and truncate it if it existed. Verified by
        // execution, not inspection. See LSGD-ops-dash#86.
        //
        // Two guards, either of which alone would close it:
        //   1. refuse anything that could be read as an option, up front
        //   2. --end-of-options, so git cannot treat what follows as one
        const badBase = !/^[A-Za-z0-9._\/@^~-]{1,200}$/.test(base) || base.startsWith("-");
        if (badBase) return errorResult("invalid base ref: " + JSON.stringify(String(base).slice(0, 60)));
        const files = await new Promise((res) => execFile("git", ["-C", REPO, "diff", "--name-only", "--end-of-options", `${base}...HEAD`], { timeout: 20000 },
          (e, out) => res(e ? [] : out.split("\n").filter((f) => /\.(ts|tsx)$/.test(f)))));
        if (!files.length) return jsonResult({ base, changedFiles: 0, note: "no changed .ts/.tsx files vs " + base });
        try { return jsonResult({ base, changedFiles: files.length, ...summarize(await runSemgrep(files)) }); }
        catch (e) { return errorResult(e.message); }
      });

    server.tool("security_audit_latest",
      "Return the most recent weekly full-repo audit summary (instant; no scan).", {},
      async () => {
        try { return jsonResult(summarize(JSON.parse(fs.readFileSync(LATEST, "utf8")))); }
        catch { return jsonResult({ note: "no audit has run yet" }); }
      });

    return server;
  }

  createServer({
    name: "security-mcp", version: "1.0.0", port: PORT, bind: process.env.MCP_BIND || "127.0.0.1",
    authorize: req => tokens.validate(db, req.headers.authorization), buildServer,
  });
}
function jsonResult(o) { return { content: [{ type: "text", text: JSON.stringify(o, null, 2) }] }; }
function errorResult(m) { return { content: [{ type: "text", text: "Error: " + m }], isError: true }; }
function rpcErr(code, message) { return { jsonrpc: "2.0", error: { code, message }, id: null }; }
main().catch((e) => { console.error("[security-mcp] fatal:", e); process.exit(1); });
