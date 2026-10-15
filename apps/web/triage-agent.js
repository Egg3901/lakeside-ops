// triage-agent.js — agentic assessment. Instead of one blind LLM call, give the
// model TOOLS (code_search, read_file, grep) and several turns to actually read
// the codebase, then produce a grounded assessment. ReAct-style JSON loop so it
// works on any chat model (no function-calling API needed). Read-only.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { callChat } = require("./llm");
const { primaryRepoDir } = require("./src/core/paths");

const REPO = process.env.AHD_GAME_REPO || primaryRepoDir();
const SECRET = process.env.ASK_API_SECRET || "";
const PORT = process.env.PORT || 9724;
const MAX_STEPS = 10;

function relPath(p) { const m = String(p).match(/(?:^|\/)(src\/.*)$/); return m ? m[1] : String(p).replace(/^\/+/, ""); }
function safeResolve(p) { const full = path.resolve(REPO, relPath(p)); return full.startsWith(REPO) ? full : null; }

async function toolCodeSearch(query) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/code-context`, { method: "POST", headers: { "Content-Type": "application/json", "x-ask-secret": SECRET }, body: JSON.stringify({ query, limit: 6 }), signal: AbortSignal.timeout(20000) });
    if (!r.ok) return "search failed (" + r.status + ")";
    const d = await r.json();
    return "Relevant files:\n" + (d.files || []).map(relPath).join("\n") + "\n\n" + (d.context || "").slice(0, 6000);
  } catch (e) { return "search error: " + e.message; }
}
function toolReadFile(p) { const full = safeResolve(p); if (!full || !fs.existsSync(full)) return "file not found: " + p; try { return fs.readFileSync(full, "utf8").slice(0, 9000); } catch { return "read error"; } }
function toolGrep(pattern) {
  try { return execFileSync("grep", ["-rn", "--include=*.ts", "--include=*.tsx", "-m", "30", "-e", String(pattern), "src"], { cwd: REPO, timeout: 15000, maxBuffer: 1 << 20 }).toString().slice(0, 4000) || "no matches"; }
  catch (e) { return (e.stdout ? e.stdout.toString().slice(0, 4000) : "") || "no matches"; }
}

async function callTxt(messages, maxTokens) {
  let txt = "";
  for (let t = 0; t < 2 && !txt; t++) { const r = await callChat({ messages, maxTokens, temperature: 1 }); txt = (r.content || "").trim(); }
  return txt;
}

async function investigate(contextStr, kind, { tagSet = [], depthGuidance = "" } = {}) {
  // ── Phase 1: GATHER — the model picks tools to read the actual code ──
  const toolSys = `You are a senior engineer investigating a ${kind} for "A House Divided" (Next.js + TypeScript + MongoDB). Use tools to read the ACTUAL code behind it. Respond each turn with ONLY one JSON object:
{"action":"code_search","query":"..."}  — find relevant files (returns code snippets)
{"action":"read_file","path":"src/..."} — read a full file
{"action":"grep","pattern":"..."}       — find a symbol/string
{"action":"done"}                        — when you've seen enough
Be efficient: 1-2 searches, then read the 1-2 key files, then "done".

The ${kind}:
${String(contextStr).slice(0, 2500)}`;
  const messages = [{ role: "user", content: toolSys }];
  const findings = [], trail = [];
  for (let step = 0; step < 6; step++) {
    const txt = await callTxt(messages, 500);
    if (!txt) { messages.push({ role: "assistant", content: "(empty)" }, { role: "user", content: "Output one JSON action object." }); continue; }
    messages.push({ role: "assistant", content: txt });
    let act; try { act = JSON.parse((txt.match(/\{[\s\S]*\}/) || [txt])[0]); } catch { act = null; }
    if (!act || !act.action) { messages.push({ role: "user", content: "Output one JSON action object." }); continue; }
    if (act.action === "done") break;
    let result;
    if (act.action === "code_search") result = await toolCodeSearch(act.query || contextStr.slice(0, 200));
    else if (act.action === "read_file") result = toolReadFile(act.path || "");
    else if (act.action === "grep") result = toolGrep(act.pattern || "");
    else { messages.push({ role: "user", content: 'Use "code_search", "read_file", "grep", or "done".' }); continue; }
    trail.push(`${act.action}(${(act.query || act.path || act.pattern || "").slice(0, 40)})`);
    findings.push(`## ${act.action}: ${act.query || act.path || act.pattern || ""}\n${String(result).slice(0, 5000)}`);
    messages.push({ role: "user", content: trail.length >= 2 ? 'Saved. Read at most one more key file, then say {"action":"done"}.' : 'Saved. Continue or say {"action":"done"}.' });
  }
  if (!findings.length) return null; // gathered nothing → caller falls back

  // ── Phase 2: SYNTHESIZE — one reliable JSON assessment from what was read ──
  const synth = `You investigated this ${kind}. Based ONLY on the code you read below, output ONLY a JSON assessment (no prose, no code fences):
{"summary":"detailed analysis that grounds every claim in the code you read — cite the real files/functions and the actual mechanism, not speculation","tags":["1-4 ONLY from: ${tagSet.join(", ")}"],"affectedFiles":["src/..."],"complexity":"trivial|small|medium|large","risk":"low|medium|high","recommendedAction":"quick_implement|decline|standard|needs_info","likelyAlreadyFixed":false,"recommendation":"...","nextSteps":["..."],"confidence":0.0}
${depthGuidance}

${kind}:
${String(contextStr).slice(0, 2000)}

=== CODE READ DURING INVESTIGATION ===
${findings.join("\n\n").slice(0, 20000)}`;
  const out = await (async () => { let o = ""; for (let t = 0; t < 3 && !o; t++) o = await callTxt([{ role: "user", content: synth }], 2200); return o; })();
  try {
    const a = JSON.parse((out.replace(/^```(?:json)?/i, "").replace(/```$/, "").match(/\{[\s\S]*\}/) || [out])[0].replace(/,\s*([}\]])/g, "$1"));
    if (a && a.summary) return { assessment: a, steps: trail.length, trail };
  } catch { /* fall back */ }
  return null;
}

module.exports = { investigate };
