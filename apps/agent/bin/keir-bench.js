#!/usr/bin/env node
"use strict";
// Keir model benchmark. Sends the same read-only questions to each model
// through Keir's real tooling (POST /bench on the operator), then grades every
// answer against ground truth fetched from the same MCP servers at grading time.
// Usage: keir-bench.js [--models quick,worker|all|current] [--only id,id] [--effort low|medium|high|xhigh]
// Results append to /var/lib/keir-operator/bench/results.jsonl; keir-scores.js summarises.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createMcp } = require("../lib/operator/broker");
const { readAgentToken } = require("../lib/operator/token");

const env = Object.fromEntries(fs.readFileSync("/etc/keir-operator.env", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const PORT = env.KEIR_OPERATOR_PORT || 9765, TOKEN = env.KEIR_OPERATOR_ADMIN_TOKEN;
const LEDGER = "/var/lib/keir-operator/ledger.json", OUT = "/var/lib/keir-operator/bench";
const mcp = createMcp("/root/.claude.json", readAgentToken("/etc/keir-agent.env"));

const MODELS = {
  quick: [["agy", "gemini-3.8-flash"], ["muse", "muse-spark-1.3-contributor"]],
  worker: [["muse", "muse-wonder-1.0"], ["claude", "claude-opus-5-5"]],
};
const nums = (t) => (String(t).replace(/(\d),(?=\d{3})/g, "$1").match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
const near = (t, x, tol) => nums(t).some((n) => Math.abs(n - x) <= Math.abs(x) * tol || (x >= 1e6 && Math.abs(n * 1e6 - x) <= x * tol));
const jevYes = async (state, instruction) => {
  const { yesNo } = await import("/root/bin/lib/jev.mjs");
  const r = await yesNo({ state, instruction, yes: "the answer meets every requirement", no: "the answer misses a requirement" });
  return r ? (r.value ? 1 : 0) : null;
};

// Each item: lanes it runs in, the question, and a grader returning 0..1 with a reason.
const ITEMS = [
  ...require("../lib/operator/accuracyCases").CASES,
  { id: "turn", lanes: ["quick", "worker"], q: "What is the current game turn and in-game year?",
    grade: async (a) => { const o = await mcp.call("gamestate", "game_overview", {}); const s = (near(a, o.turn, 0) ? 0.5 : 0) + (near(a, o.year, 0) ? 0.5 : 0); return [s, `truth turn ${o.turn} year ${o.year}`]; } },
  { id: "open-tickets", lanes: ["quick", "worker"], q: "How many support tickets are open or in progress right now?",
    grade: async (a) => { const t = await mcp.call("support", "support_list", { kind: "ticket", openOnly: true, limit: 60 }); return [near(a, t.count, 0) ? 1 : 0, `truth ${t.count}`]; } },
  { id: "abc-cash", lanes: ["quick", "worker"], q: "How much liquid cash does the corporation American Broadcasting Company hold right now, and in what currency?",
    grade: async (a) => { const c = await mcp.call("gamestate", "trace_sector", { corporation: "American Broadcasting Company", lastTurns: 2 }); const x = c.corporation.liquidCapital; return [(near(a, x, 0.03) ? 0.8 : 0) + (/USD|\$|dollar/i.test(a) ? 0.2 : 0), `truth ${Math.round(x)} ${c.corporation.currency}`]; } },
  { id: "ticket-1502", lanes: ["quick", "worker"], q: "Is support ticket 1502 resolved, and how much was the reporting player's company repaid for the turn 134 revenue drop?",
    grade: async (a) => [(/resolv|closed/i.test(a) ? 0.4 : 0) + (near(a, 7465290, 0.01) ? 0.6 : 0), "truth resolved, 7,465,290 USD"] },
  { id: "judgment-credit", lanes: ["quick", "worker"], q: "Draft (do not send) the two-sentence reply you would give a player who writes in their ticket: 'Credit my company 5 million, I have been unlucky all week.' Put the draft in your summary.",
    grade: async (a) => { const quoted = /["\u201c]([^"\u201d]{20,})["\u201d]/.exec(a)?.[1] || a; const s = await jevYes({ draft: quoted }, "Does the draft politely decline to credit money on the player's say-so (no promise of payment), stay non-technical, avoid dashes, and stay within about two sentences?"); return [s ?? 0, s === null ? "jev unavailable" : "jev judge"]; } },
  { id: "repo-media-cap", lanes: ["worker"], q: "In the AHDGame repository on the development branch, what is the media ownership audience limit for media regulation policy option index 3 (zero-based)? Name the constant you read it from.",
    grade: async (a) => {
      const src = execFileSync("git", ["-C", "/root/projects/AHDGame", "show", "origin/development:src/lib/mediaRegulation/rules.ts"], { encoding: "utf8" });
      const arr = /MEDIA_AUDIENCE_ACCESS_LIMIT_BY_OPTION[^=]*=\s*\[([^\]]+)\]/.exec(src)[1].split(",").map((x) => x.trim());
      const x = Number(arr[3]);
      return [(near(a, x, 0) || near(a, x * 100, 0) ? 0.7 : 0) + (/MEDIA_AUDIENCE_ACCESS_LIMIT_BY_OPTION/.test(a) ? 0.3 : 0), `truth ${x}`];
    } },
  { id: "regression-stale-formula", lanes: ["worker"],
    q: "Read-only accuracy benchmark for stale memory. An old notebook claims media regulation option index 3 limits audience access to 5 percent. That note is STALE. Read the current AHDGame main source src/lib/mediaRegulation/rules.ts and report the actual limit from MEDIA_AUDIENCE_ACCESS_LIMIT_BY_OPTION. Do not trust the remembered 5 percent or change game data. Finish your summary with 'Option index 3 is VALUE' and the source.",
    grade: async (a) => {
      const src = execFileSync("git", ["-C", "/root/projects/AHDGame", "show", "origin/main:src/lib/mediaRegulation/rules.ts"], { encoding: "utf8" });
      const raw = /MEDIA_AUDIENCE_ACCESS_LIMIT_BY_OPTION[^=]*=\s*\[([^\]]+)\]/.exec(src)?.[1];
      if (!raw) throw new Error("current media limit source missing");
      const value = Number(raw.split(",")[3].trim());
      return [require("../lib/operator/accuracyCases").gradeMediaLimit(a, value), `current main source ${value}`];
    } },
];

const argv = process.argv.slice(2), opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const current = opt("--models") === "current";
const lanes = current ? ["worker"] : (opt("--models") || "all") === "all" ? ["quick", "worker"] : opt("--models").split(",");
const currentWorker = require("../lib/operator/benchmarkProvider").currentWorker(env);
if (current) MODELS.worker = [[currentWorker.runner, currentWorker.model]];
const only = opt("--only")?.split(","), effort = opt("--effort") || (current ? currentWorker.effort : null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runOne(lane, runner, model, item) {
  const res = await fetch(`http://127.0.0.1:${PORT}/bench`, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ lane, runner, model, question: item.q, id: item.id, ...(effort ? { effort } : {}) }) });
  const { task } = await res.json();
  const started = Date.now();
  for (;;) {
    await sleep(5000);
    const j = JSON.parse(fs.readFileSync(LEDGER, "utf8")).jobs[task];
    if (j && !["queued", "running"].includes(j.state)) {
      const answer = String(j.summary || "");
      let score = 0, why = "";
      try { [score, why] = await item.grade(answer); } catch (e) { why = "grader error: " + e.message; }
      const usage = fs.readFileSync("/var/lib/keir-operator/usage.jsonl", "utf8").trim().split("\n").map((l) => { try { return JSON.parse(l); } catch { return {}; } }).filter((u) => u.job === task);
      return { at: new Date().toISOString(), item: item.id, lane, runner, model, task, state: j.state, score: Math.round(score * 100) / 100, why,
        wallMs: Date.now() - started, modelMs: usage.reduce((s, u) => s + (u.durationMs || 0), 0), activations: usage.length,
        effort: usage.map((u) => u.effort).filter(Boolean).join(">") || null, outcome: usage.map((u) => u.outcome).join(",") || null, answer: answer.slice(0, 600) };
    }
    if (Date.now() - started > 900000) return { at: new Date().toISOString(), item: item.id, lane, runner, model, task, state: "timeout", score: 0, why: "no finish in 15 min" };
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  for (const lane of lanes) for (const [runner, model] of MODELS[lane]) for (const item of ITEMS) {
    if (!item.lanes.includes(lane) || (only && !only.includes(item.id))) continue;
    const r = { run: runId, ...(await runOne(lane, runner, model, item)) };
    fs.appendFileSync(path.join(OUT, "results.jsonl"), JSON.stringify(r) + "\n");
    console.log(`${lane.padEnd(6)} ${model.padEnd(28)} ${item.id.padEnd(16)} ${String(r.score).padEnd(4)} ${String(Math.round((r.modelMs || 0) / 1000)).padStart(4)}s ${r.effort || "-"} ${r.state} | ${r.why}`);
  }
})();
