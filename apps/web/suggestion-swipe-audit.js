"use strict";

// suggestion-swipe-audit.js: loads the code check shown on swipe cards.
//
// The audit is produced offline by reading each unreviewed suggestion against
// the production game code. It is a JSON file at OPS_SWIPE_AUDIT:
//
//   { "generatedAt": ISO date, "sourceCommit": "<game main sha>",
//     "items": { "<issueNumber>": { verdict, confidence, inGameToday,
//                                   missing, notes, asks: [{ ask, status, evidence }] } } }
//
// verdict is implemented | partial | in_development | not_implemented |
// unclear. A missing or unreadable file means "not checked", never an error.

const fs = require("fs");
const path = require("path");

const VERDICTS = ["implemented", "partial", "in_development", "not_implemented", "unclear"];

function defaultAuditPath(env = process.env) {
  return path.resolve(env.OPS_SWIPE_AUDIT || path.join(__dirname, "data", "suggestion-implementation-audit.json"));
}

function normalizeAudit(raw) {
  if (!raw || typeof raw !== "object" || !raw.items || typeof raw.items !== "object") return null;
  const items = {};
  for (const [key, item] of Object.entries(raw.items)) {
    const n = parseInt(key, 10);
    if (!Number.isInteger(n) || !item || !VERDICTS.includes(item.verdict)) continue;
    items[n] = item;
  }
  return { generatedAt: raw.generatedAt || null, sourceCommit: raw.sourceCommit || null, items };
}

let cache = { file: null, mtimeMs: 0, audit: null };
function loadAudit(file = defaultAuditPath()) {
  try {
    const { mtimeMs } = fs.statSync(file);
    if (cache.file === file && cache.mtimeMs === mtimeMs) return cache.audit;
    const audit = normalizeAudit(JSON.parse(fs.readFileSync(file, "utf8")));
    cache = { file, mtimeMs, audit };
    return audit;
  } catch (error) {
    if (error.code !== "ENOENT") console.warn("[suggestion-swipe] audit unreadable:", error.message);
    return null;
  }
}

const NOTE_MARK = "Code check";

// One staff note per suggestion per audit, appended to adminNotes (shown only
// in the game's admin tab, never to players).
function auditNote(item, { generatedAt, sourceCommit }) {
  const label = { implemented: "already in game", partial: "partly in game", in_development: "built on development, not live yet", not_implemented: "not in game", unclear: "unclear" }[item.verdict];
  const head = `${NOTE_MARK} ${String(generatedAt || "").slice(0, 10)}${sourceCommit ? ` (game main ${String(sourceCommit).slice(0, 10)})` : ""}: ${label}, ${item.confidence || "low"} confidence.`;
  return [head, item.inGameToday && `In game: ${item.inGameToday}`, item.missing && `Missing: ${item.missing}`, item.notes && `Notes: ${item.notes}`]
    .filter(Boolean).join("\n");
}

// Decide what the audit changes on each suggestion. Only high-confidence
// verdicts that a person has confirmed (confirmed: true on the item) move a
// status; everything else just gets the note and stays in the swipe deck.
// Suggestions no longer unreviewed are left alone, and a suggestion that
// already carries this audit's note is not noted twice.
function planAuditUpdates(audit, suggestions) {
  const byNumber = new Map(suggestions.map((s) => [s.issueNumber, s]));
  const plan = [];
  for (const [key, item] of Object.entries(audit.items)) {
    const n = Number(key);
    const s = byNumber.get(n);
    if (!s || s.status !== "not_reviewed") continue;
    const note = auditNote(item, audit);
    const existing = String(s.adminNotes || "");
    const head = note.split("\n")[0];
    const adminNotes = existing.includes(head) ? null : (existing.trim() ? `${existing.trim()}\n\n${note}` : note).slice(0, 5000);
    let status = null;
    if (item.confidence === "high" && item.confirmed === true) {
      if (item.verdict === "implemented") status = "completed";
      else if (item.verdict === "in_development") status = "in_progress";
    }
    if (adminNotes || status) plan.push({ issueNumber: n, status, adminNotes, verdict: item.verdict });
  }
  return plan.sort((a, b) => a.issueNumber - b.issueNumber);
}

module.exports = { loadAudit, normalizeAudit, defaultAuditPath, auditNote, planAuditUpdates, VERDICTS };
