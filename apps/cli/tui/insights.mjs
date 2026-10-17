// @ts-check
// Pure helpers behind the terminal's status panels. No UI and no OpenCode
// imports, so they run under node --test as well as inside the TUI host.
import { execFileSync } from "node:child_process";

/**
 * Totals for one session from its messages. Only assistant messages carry
 * usage; the model shown is the one that answered last.
 * @param {ReadonlyArray<any>} messages
 */
export function summarizeUsage(messages) {
  const out = { cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, turns: 0, model: "", provider: "" };
  for (const m of messages || []) {
    if (!m || m.role !== "assistant") continue;
    out.turns += 1;
    out.cost += Number(m.cost) || 0;
    const t = m.tokens || {};
    out.input += Number(t.input) || 0;
    out.output += Number(t.output) || 0;
    out.reasoning += Number(t.reasoning) || 0;
    out.cacheRead += Number(t.cache?.read) || 0;
    out.cacheWrite += Number(t.cache?.write) || 0;
    if (m.modelID) { out.model = m.modelID; out.provider = m.providerID || ""; }
  }
  return out;
}

/** 1234 -> "1.2k", 2500000 -> "2.5M". @param {number} n */
export function formatTokens(n) {
  const v = Number(n) || 0;
  if (v >= 1e6) return `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)}k`;
  return String(Math.round(v));
}

/** Subscription routes report 0; show that honestly rather than "$0.00". @param {number} cost */
export function formatCost(cost) {
  const v = Number(cost) || 0;
  if (v === 0) return "no metered cost";
  return v < 0.01 ? "<$0.01" : `$${v.toFixed(2)}`;
}

/**
 * Branch and uncommitted file count for each registered project. Git calls are
 * bounded so a slow network share cannot stall the terminal.
 * @param {Record<string, string>} projects name -> directory
 * @param {{ exec?: (cmd: string, args: string[], opts: object) => string, timeoutMs?: number }} [options]
 */
export function projectStatuses(projects, options = {}) {
  const exec = options.exec || ((cmd, args, opts) => execFileSync(cmd, args, opts).toString());
  const opts = { timeout: options.timeoutMs || 1500, stdio: ["ignore", "pipe", "ignore"] };
  return Object.entries(projects || {}).sort(([a], [b]) => a.localeCompare(b)).map(([name, directory]) => {
    try {
      // symbolic-ref works before the first commit; a detached HEAD shows its short hash.
      exec("git", ["-C", directory, "rev-parse", "--is-inside-work-tree"], opts);
      let branch = "";
      try { branch = exec("git", ["-C", directory, "symbolic-ref", "--short", "-q", "HEAD"], opts).trim(); }
      catch { try { branch = `@${exec("git", ["-C", directory, "rev-parse", "--short", "HEAD"], opts).trim()}`; } catch { branch = "no commits"; } }
      const changes = exec("git", ["-C", directory, "status", "--porcelain"], opts).split("\n").filter(Boolean).length;
      return { name, directory, branch, changes, ok: true };
    } catch {
      return { name, directory, branch: "", changes: 0, ok: false };
    }
  });
}

/** Compare dotted versions with an optional -preview.N suffix. @param {string} a @param {string} b */
export function compareVersions(a, b) {
  const parse = (/** @type {string} */ v) => {
    const [core, pre = ""] = String(v).replace(/^code-v/, "").split("-");
    const n = core.split(".").map(x => Number(x) || 0);
    const p = /(\d+)$/.exec(pre);
    return { n, pre, preN: p ? Number(p[1]) : 0 };
  };
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if ((x.n[i] || 0) !== (y.n[i] || 0)) return (x.n[i] || 0) - (y.n[i] || 0);
  if (!x.pre && y.pre) return 1;
  if (x.pre && !y.pre) return -1;
  return x.preN - y.preN;
}

/**
 * The newest release for the channel that is newer than what is installed.
 * @param {string} installed package version, e.g. "0.1.4-preview.1"
 * @param {ReadonlyArray<any>} releases GitHub release rows
 * @param {"preview" | "stable"} channel
 */
export function newerRelease(installed, releases, channel = "preview") {
  const rows = (releases || []).filter(r => !r.draft && /^code-v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(r.tag_name || "")
    && (channel === "preview" || (!r.prerelease && !r.tag_name.slice(6).includes("-"))));
  rows.sort((a, b) => compareVersions(b.tag_name, a.tag_name));
  const best = rows[0];
  return best && compareVersions(best.tag_name, installed) > 0 ? best.tag_name : null;
}

/**
 * One row per check for /doctor. Each row says what is wrong and what to do.
 * @param {{ providers: ReadonlyArray<any>, mcp: ReadonlyArray<{ name: string, status: string, error?: string }>,
 *   vps: { origin?: string } | null, peers: ReadonlyArray<any>, engine: string, version: string,
 *   update: string | null | undefined }} input
 */
export function doctorChecks(input) {
  const rows = [];
  const providers = (input.providers || []).map(p => p.name || p.id).filter(Boolean);
  rows.push(providers.length
    ? { level: "ok", label: "Providers", detail: providers.slice(0, 6).join(", ") + (providers.length > 6 ? ` +${providers.length - 6}` : "") }
    : { level: "error", label: "Providers", detail: "None signed in. Use /connect to add one." });
  const mcp = input.mcp || [];
  const broken = mcp.filter(m => m.status !== "connected" && m.status !== "disabled");
  if (!mcp.length) rows.push({ level: "info", label: "MCP servers", detail: "None configured. Optional; see lakeside code mcp add." });
  else if (broken.length) rows.push({ level: "warn", label: "MCP servers", detail: `${mcp.length - broken.length}/${mcp.length} connected. Failing: ${broken.map(m => `${m.name} (${m.error || m.status})`).join(", ")}` });
  else rows.push({ level: "ok", label: "MCP servers", detail: `${mcp.length} connected` });
  if (!input.vps) rows.push({ level: "info", label: "VPS", detail: "Not connected. Optional; /vps explains how." });
  else {
    const down = (input.peers || []).filter(p => p && p.state !== "connected");
    rows.push(down.length
      ? { level: "warn", label: "VPS", detail: `${input.vps.origin}: ${down.map(p => p.error || p.id).join(", ")}. Try /reconnect, or refresh your token file.` }
      : { level: "ok", label: "VPS", detail: input.vps.origin || "configured" });
  }
  rows.push({ level: "ok", label: "Engine", detail: `OpenCode ${input.engine}` });
  if (input.update === undefined) rows.push({ level: "info", label: "Updates", detail: `Lakeside Code ${input.version}. Checking...` });
  else if (input.update) rows.push({ level: "warn", label: "Updates", detail: `${input.update} is available. Exit and run: lakeside code update` });
  else rows.push({ level: "ok", label: "Updates", detail: `Lakeside Code ${input.version} is current` });
  return rows;
}
