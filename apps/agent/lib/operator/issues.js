"use strict";
// Keir 4.2 GitHub issues (owner, 2026-10-14): "Keir needs to use GitHub
// issues more faithfully and make sure he makes them pretty and closes when
// fixed." A bug or feature Keir raises becomes a real AHDGame issue in one
// house shape, its fix PRs reference it with Refs (Closes would auto-close on
// the development merge, long before players have it), and Keir closes it
// only once the fix is live on the main server.
//
// AHDGame is public and history is permanent: an issue never names a player,
// a character, a Discord id, a ticket channel or an internal host.
//
// Pure: inputs in, markdown or a verdict out. No I/O.

const INTERNAL = /\/root\/|\/var\/lib\/|\/etc\/keir|\b167\.86\.68\.67\b|\b46\.224\.28\.26\b|\b(?:127\.0\.0\.1|localhost)(?::\d{2,5})?\b|\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b|\b[\w.-]+\.(?:internal|lan|railway\.app)\b|mongodb(?:\+srv)?:\/\/|\bops\.lakesidegames\.net\b|\bcontabo\b|\bhetzner\b|\bahdk_|\bkanban\b|\bticket(?:[-\s][a-z]+)*[-\s]*#?\d{3,5}\b|discord\.com\/channels\//i;
const DISCORD = /<[@#][!&]?\d{15,22}>|\b\d{17,20}\b|@everyone|@here/;
const EMAIL = /\b[\w.+-]+@(?!(?:example\.(?:com|org|net)|users\.noreply\.github\.com)\b)[\w-]+(?:\.[\w-]+)+\b/;
const CREDENTIAL = /(?:bearer\s+\S+|(?:api[_-]?key|token|password|secret)\s*[:=]\s*["']?[^\s"']+|gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{12,}|https?:\/\/[^\s/@]+:[^\s/@]+@)/i;
const AREAS = ["ui", "balance", "accessibility", "country-content"];

// Every field the template renders. summary, actual and impact are required;
// the rest are rendered only when given.
const FIELDS = ["summary", "steps", "expected", "actual", "where", "impact", "notes"];

const clean = (t) => String(t || "").replace(/[–—]/g, ",").replace(/\r/g, "").trim();
const list = (t) => {
  const rows = (Array.isArray(t) ? t : clean(t).split(/\n+/)).map((r) => clean(r).replace(/^(?:\d+[.)]|[-*])\s*/, "")).filter(Boolean);
  return rows.map((r, i) => `${i + 1}. ${r}`).join("\n");
};

// Returns the first offending fragment, or null. forbidden: names that must
// never appear (the reporter's character and Discord names).
function leak(text, forbidden = []) {
  const s = String(text || "").normalize("NFKC");
  for (const re of [INTERNAL, DISCORD, EMAIL, CREDENTIAL]) { const m = re.exec(s); if (m) return m[0].slice(0, 80); }
  for (const name of forbidden) {
    const n = String(name || "").normalize("NFKC").trim();
    if (n.length >= 2 && new RegExp(`(?<![\\p{L}\\p{N}_])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}_])`, "iu").test(s)) return n;
  }
  return null;
}

function validate(input) {
  const kind = input.kind === "enhancement" ? "enhancement" : "bug";
  const title = clean(input.title);
  if (title.length < 12 || title.length > 120) throw new Error("issue title: 12 to 120 characters, plain words describing the problem");
  if (/^(?:bug|issue|problem|fix|feat)\s*[:\-]/i.test(title)) throw new Error("issue title: describe the problem itself, no prefix");
  const f = Object.fromEntries(FIELDS.map((k) => [k, Array.isArray(input[k]) ? input[k] : clean(input[k])]));
  if (String(f.summary).length < 30) throw new Error("issue summary: one or two sentences on what goes wrong and who it reaches");
  if (kind === "bug" && String(f.actual).length < 10) throw new Error("bug issue: say what actually happens (actual)");
  if (kind === "bug" && String(f.expected).length < 10) throw new Error("bug issue: say what should happen (expected)");
  if (String(f.impact).length < 10) throw new Error("issue impact: who is affected and how badly");
  const areas = (Array.isArray(input.areas) ? input.areas : []).filter((a) => AREAS.includes(a));
  return { kind, title, fields: f, labels: [kind, ...areas] };
}

function render({ kind, fields: f, origin = "report" }) {
  const out = [String(f.summary)];
  if (kind === "bug") {
    if (f.steps && String(f.steps).trim()) out.push(`## Steps to reproduce\n\n${list(f.steps)}`);
    out.push(`## Expected\n\n${f.expected}`, `## Actual\n\n${f.actual}`);
  } else if (f.expected) out.push(`## Proposal\n\n${f.expected}`);
  if (f.where && String(f.where).trim()) {
    const rows = (Array.isArray(f.where) ? f.where : String(f.where).split(/\n+/)).map(clean).filter(Boolean);
    out.push(`## Where\n\n${rows.map((r) => /^[\w./-]+(?::\d+)?$/.test(r) ? `- \`${r}\`` : `- ${r}`).join("\n")}`);
  }
  out.push(`## Impact\n\n${f.impact}`);
  if (f.notes && String(f.notes).trim()) out.push(`## Notes\n\n${f.notes}`);
  out.push(origin === "watch" ? "---\n_Found and filed by Keir's live monitoring._" : "---\n_Filed by Keir from a player report._");
  return out.join("\n\n");
}

// Build a publishable issue or throw with the reason.
function build(input, forbidden = [], { origin = "report" } = {}) {
  const v = validate(input);
  const body = render({ ...v, origin });
  const bad = leak(`${v.title}\n${body}`, forbidden);
  if (bad) throw new Error(`AHDGame is public: the issue mentions "${bad}". Describe the problem without player or character names, Discord ids, ticket numbers, links or internal hosts, then file again.`);
  return { title: v.title, body, labels: v.labels, kind: v.kind };
}

// The PR body line that links a fix to its issues without auto-closing them
// on the development merge.
function refsLine(numbers) {
  const ns = [...new Set(numbers.map(Number).filter(Boolean))];
  return ns.length ? `Refs ${ns.map((n) => `#${n}`).join(", ")}` : "";
}

// Live where players have it: main for web code, turn-worker/production too
// when the fix touched turn processing.
function liveForPlayers(where, { turn = false } = {}) {
  return where?.main === true && (!turn || where["turn-worker/production"] === true);
}

function closingComment({ pr, sha }) {
  return `Fixed${pr ? ` in #${pr}` : ""}${sha ? ` (${String(sha).slice(0, 10)})` : ""}, now live on the main server.`;
}

module.exports = { AREAS, FIELDS, leak, validate, render, build, refsLine, liveForPlayers, closingComment };
