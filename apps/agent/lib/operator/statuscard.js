"use strict";
// Keir 3.0 ticket status card: one Discord message per ticket, edited in
// place as work moves, instead of a new "still testing" post each time
// (owner, 2026-10-14, after ticket 1536 showed duplicate and stage-regressing
// waiting posts). New messages stay for what the player must read: a question
// for them, a finding, and the final confirmation.
//
// A ticket can carry several fixes (1514 had three), so the card lists each
// one with its own progress. A stage is the last milestone reached; release
// milestones need the same receipts as release words in a post.

// Live on the main server is the finish line: a live fix shows a full green
// bar (owner, 2026-10-14: "if it's green and on the main server what else is
// this waiting for?"). "confirmed" is the same last step, marked confirmed in
// game, not a further step that reads as still pending.
const STAGES = [
  { id: "found", label: "Investigating", needs: "investigated" },
  { id: "written", label: "Fix written" },
  { id: "tested", label: "Tested", needs: "development" },
  { id: "sandbox", label: "On the sandbox", needs: "staging" },
  { id: "main", label: "Live on the main server", needs: "main" },
];
const CONFIRMED = { id: "confirmed", label: "Live · confirmed in game", needs: "main" };
const NEXT = { found: "Checking cause and next step", written: "In testing", tested: "Going to the sandbox", sandbox: "Going to the main server" };
const COLOR = { progress: 0x3b82f6, blocked: 0xf59e0b, done: 0x22c55e };
const stageIndex = (id) => (id === "confirmed" ? STAGES.length - 1 : STAGES.findIndex((s) => s.id === id));
const stageOf = (id) => (id === "confirmed" ? CONFIRMED : STAGES[stageIndex(id)]);

// evidence: broker ticketEvidence() shape ({ development: { done }, ... }).
function stageAllowed(stage, evidence = {}) {
  const s = stageIndex(stage) < 0 ? null : stageOf(stage);
  if (!s) return { ok: false, reason: `unknown stage "${stage}"; use one of ${[...STAGES.map((x) => x.id), "confirmed"].join(", ")}` };
  if (s.needs === "investigated" && !evidence.investigated?.done) return { ok: false, reason: `"${s.label}" needs the cause investigated first: read the live game state, data or code for this ticket. Until then post no card, or say what you are checking` };
  if (s.needs && s.needs !== "investigated" && !evidence[s.needs]?.done) return { ok: false, reason: `"${s.label}" needs github where to show the fix on ${s.needs}` };
  return { ok: true };
}

function stageFromEvidence(evidence = {}, fallback = "written") {
  if (evidence.main?.done) return "main";
  if (evidence.staging?.done) return "sandbox";
  if (evidence.development?.done) return "tested";
  return fallback;
}

// One row per fix. The field name carries a status icon; the value is a
// progress bar with the milestone reached in bold, then one short line for
// what happens next, or why it is paused.
const ICON = { done: "✅", progress: "🔄", paused: "⏸️" };
const isLive = (item) => !item.blocked && (item.stage === "main" || item.stage === "confirmed");
function rowState(item) { return item.blocked ? "paused" : isLive(item) ? "done" : "progress"; }

function itemLine(item) {
  const idx = stageIndex(item.stage);
  const bar = STAGES.map((_, i) => (i <= idx ? "▰" : "▱")).join("");
  const head = `${bar}  **${stageOf(item.stage).label}**`;
  const note = item.note ? item.note.replace(/[.\s]+$/, "") : "";
  const tail = item.blocked ? `⏸ Paused${note ? ` · ${note}` : ""}`
    : isLive(item) ? (note ? note : "")
    : `→ ${NEXT[item.stage]}${note ? ` · ${note}` : ""}`;
  return tail ? `${head}\n${tail}` : head;
}

function render({ ticket, items = [], status = "", at = Date.now(), avatarUrl = null }) {
  const states = items.map(rowState);
  const color = states.length && states.every((x) => x === "done") ? COLOR.done
    : states.includes("progress") ? COLOR.progress : states.includes("paused") ? COLOR.blocked : COLOR.progress;
  return {
    content: "",
    embeds: [{
      author: { name: "Keir · Support desk", ...(avatarUrl ? { icon_url: avatarUrl } : {}) },
      title: `Ticket ${ticket} · Progress`,
      ...(status ? { description: String(status).slice(0, 500) } : {}),
      fields: items.slice(0, 10).map((i) => ({ name: `${ICON[rowState(i)]}  ${String(i.name).slice(0, 110)}`, value: itemLine(i).slice(0, 500), inline: false })),
      footer: { text: "Updates in place as work moves" },
      timestamp: new Date(at).toISOString(),
      color,
    }],
    allowed_mentions: { parse: [] },
  };
}

function waitNote(info = {}) {
  const promoting = info.base === "staging" ? "sandbox" : info.base === "main" ? "main server" : null;
  const what = promoting ? `Release checks for the ${promoting}` : "Tests for the fix";
  return `${what} ${info.queued ? "are queued" : info.running ? "are running" : "have not finished"}.`;
}

module.exports = { STAGES, stageIndex, stageAllowed, stageFromEvidence, itemLine, rowState, render, waitNote };
