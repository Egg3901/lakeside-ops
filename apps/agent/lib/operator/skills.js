"use strict";
// Keir 4.2 skills (owner, 2026-10-14): vendored third-party agent skills,
// loaded into the brief per lane so they apply on every runner (Codex, Muse,
// Claude), not only where Claude Code discovers skills itself. Each skill is
// preceded by a Keir note that resolves what does not fit Keir: there is no
// human partner in the loop, no slash commands, and the game has an
// established design system.

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..", "skills");
const ADAPT = {
  "ponytail": "Always on at the full level. Ignore the slash commands and on/off phrases. Your patch is reviewed by a developer and the repository is public: the smallest complete change wins.",
  "ponytail-review": "Use this when you review a patch your coding subworker produced: list what to delete before you publish it.",
  "systematic-debugging": "Where it says to discuss with your human partner, finish blocked with the question for the developers instead (raise_to_developers). Gather evidence with Keir's tools: the snapshot, the trace and gamestate reads, recent_changes and history.",
  "verification-before-completion": "This is the same rule as Keir's own receipts: no claim of fixed, live or done without the evidence in this activation (a test run, github where, a trace read, watch_turn).",
  "test-driven-development": "Where it says to ask your human partner, decide yourself and say in the PR body why a test was not possible. Run the focused tests in the snapshot, never the full suite.",
  "frontend-design": "You are fixing a page inside A House Divided's established design system, not designing a new identity. Match the existing components, tokens and type. Never introduce new typefaces, palettes or a redesign. House rules win over this skill: no serif type, no beige or cream backgrounds, keep the existing density, color and depth, no em or en dashes. Use this skill for its list of generated-design tells to avoid and its self-critique, only when the fix changes how a page looks.",
};

let cache = null;
function load(root = ROOT) {
  if (cache && cache.root === root) return cache;
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8").replace(/^\uFEFF/, ""));
  if (!manifest.skills || typeof manifest.skills !== "object" || Array.isArray(manifest.skills) || !manifest.lanes || typeof manifest.lanes !== "object" || Array.isArray(manifest.lanes)) throw new Error("invalid skills manifest: expected skills and lanes maps");
  const text = {}, errors = [];
  for (const name of Object.keys(manifest.skills)) {
    try {
      if (!/^[a-z0-9-]+$/.test(name)) throw new Error("invalid skill name");
      const raw = fs.readFileSync(path.join(root, "vendor", name, "SKILL.md"), "utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
      // Front matter is for discovery; normalize vendor line endings first.
      const body = raw.replace(/^---\n[\s\S]*?\n---(?:\n|$)/, "").trim();
      if (!body) throw new Error("empty skill body");
      text[name] = body;
    } catch (e) { errors.push({ skill: name, error: String(e.message).slice(0, 200) }); }
  }
  const result = { root, manifest, text, errors };
  // Retry a partial deployment on the next activation instead of caching it.
  if (!errors.length) cache = result;
  return result;
}

// The lane a job's activation runs in, for skill selection.
function laneOf(job, quick) {
  if (job.codingParent) return job.investigation ? "investigator" : "coder";
  if (quick) return "quick";
  return "worker";
}

function prepare(lane, root) {
  let loaded;
  try { loaded = load(root); }
  catch (e) { return { text: "", names: [], errors: [{ error: String(e.message).slice(0, 200) }] }; }
  const { manifest, text } = loaded;
  const errors = [...loaded.errors];
  const requested = manifest.lanes[lane];
  if (!Array.isArray(requested)) return { text: "", names: [], errors: [...errors, { error: `invalid or missing skill lane: ${lane}` }] };
  const names = [...new Set(requested)].filter((n) => {
    if (typeof n === "string" && Object.hasOwn(text, n)) return true;
    if (!errors.some((e) => e.skill === n)) errors.push({ skill: String(n).slice(0, 80), error: "lane skill is unavailable" });
    return false;
  });
  if (!names.length) return { text: "", names, errors };
  const parts = names.map((n) => `### Skill: ${n}\n\n_Keir note: ${ADAPT[n] || "Apply as written."}_\n\n${text[n]}`);
  return { text: `\n\n## Skills\n\nThese skills shape how you work in this lane. Keir's brief above wins wherever they disagree: authority, approvals, player copy and the public-repository rules come from the brief.\n\n${parts.join("\n\n")}`, names, errors };
}

const forLane = (lane, root) => prepare(lane, root).text;
module.exports = { load, laneOf, prepare, forLane, ADAPT };
