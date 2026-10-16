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

module.exports = { loadAudit, normalizeAudit, defaultAuditPath, VERDICTS };
