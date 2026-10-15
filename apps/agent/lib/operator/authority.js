"use strict";
// Keir 4.2 ticket authority (owner, 2026-10-14): "if I'm telling Keir
// explicitly to work on a ticket or do the initial authorization, unless it's
// a huge change don't ping me 20x". One yes from Egg (or Ariane on his behalf)
// covers the rest of that ticket's chain: heal, merge, promote. Huge changes
// still ask every time.
//
// Huge: economy or turn-worker code (blast radius economy class), database
// migrations, an unreadable file list, and heals that touch money, world
// config or more than 25 records. Everything else rides the ticket's yes.
//
// Pure apart from the ledger map it reads and writes. No I/O.

const blast = require("./blastradius");

const AUTHORITY_MS = 7 * 86400000;
const MIGRATION_PATHS = /^(?:scripts\/migrations\/|src\/lib\/migrations\/|src\/app\/api\/admin\/migrations\/)/;
// Words that make an addressed developer message a direction to work, not a
// question about the ticket.
const WORK_WORDS = /\b(?:work(?:ing)? on|fix|handle|take (?:it|this|over)|pick (?:it|this) up|look into|investigate|sort (?:it|this)|deal with|go ahead|do it|heal|ship|promote|release|deploy|approved?|signed? off)\b/i;

function isDirection(text) {
  const s = String(text || "");
  if (/[?"“”`]|^\s*>|\b(?:don['’]t|do not|never|not yet|hold off|stop|wait|why|did you|have you|already|shouldn['’]t|mustn['’]t|cannot|can['’]t)\b/i.test(s)) return false;
  return WORK_WORDS.test(s);
}

// Who may grant: the owner, or the delegate (first staff id) on his behalf.
const granter = (config, actor) => actor === config.ownerId || config.staffIds.slice(0, 1).includes(actor);

function grant(d, config, ticketNo, { by, messageId = null, how, at = Date.now() }) {
  const n = Number(ticketNo);
  if (!n || !granter(config, by)) return null;
  const g = { by, messageId, how, at };
  (d.ticketAuthority ||= {})[n] = g;
  for (const k of Object.keys(d.ticketAuthority)) if (at - (d.ticketAuthority[k].at || 0) > AUTHORITY_MS) delete d.ticketAuthority[k];
  return g;
}

function lookup(d, ticketNo, now = Date.now()) {
  const g = Number(ticketNo) && d.ticketAuthority?.[Number(ticketNo)];
  return g && now >= g.at && now - (g.at || 0) <= AUTHORITY_MS ? g : null;
}

// files: repository paths a merge or promotion carries; null = unknown.
function hugeCode(files) {
  if (!Array.isArray(files)) return { huge: true, reason: "file list unavailable" };
  if (blast.classify(files).cls === "economy" || files.some((f) => /^src\/(?:lib\/|app\/api\/)/.test(f))) return { huge: true, reason: "economy or turn-worker code" };
  const migrations = files.filter((f) => MIGRATION_PATHS.test(f));
  if (migrations.length) return { huge: true, reason: `database migration (${migrations.slice(0, 3).join(", ")})` };
  return { huge: false };
}

function hugeHeal(spec = {}) {
  if (spec.env !== "prod") return false;
  return Boolean(spec.touchesMoney || spec.kind === "compensation" || spec.collection === "gameConfig" || Number(spec.expectedMax || 0) > 25);
}

module.exports = { AUTHORITY_MS, MIGRATION_PATHS, WORK_WORDS, isDirection, granter, grant, lookup, hugeCode, hugeHeal };
