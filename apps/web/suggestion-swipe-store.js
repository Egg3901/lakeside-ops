"use strict";

// suggestion-swipe-store.js: votes and outcomes for the suggestion swipe deck.
//
// Two staff members swipe the unreviewed player suggestions blind. Votes are
// stored per suggestion and per voter in SQLite (OPS_SWIPE_DB). Once two
// distinct voters have a counted vote on a suggestion, resolveOutcome() turns
// the pair into one outcome. The routes apply that outcome to the suggestion
// and, for a match, open a kanban card.

const path = require("path");

const VOTES = ["yes", "super", "no", "done", "skip"];
const COUNTED = new Set(["yes", "super", "no", "done"]);
// in_progress is only set by the code audit (built on development, not live yet).
const OUTCOMES = ["planned", "not_implementing", "completed", "in_progress", "discuss"];
const STATUS_FOR_OUTCOME = { planned: "planned", not_implementing: "not_implementing", completed: "completed", in_progress: "in_progress" };

function defaultDbPath(env = process.env) {
  return path.resolve(env.OPS_SWIPE_DB || path.join(__dirname, "data", "suggestion-swipe.db"));
}

// Two counted votes in, one outcome out. A super like counts as a yes and
// marks the match top priority. Anything other than agreement goes to the
// discuss pile.
function resolveOutcome(a, b) {
  if (!COUNTED.has(a) || !COUNTED.has(b)) return null;
  const yes = (v) => v === "yes" || v === "super";
  if (yes(a) && yes(b)) return { outcome: "planned", superLike: a === "super" || b === "super" };
  if (a === "no" && b === "no") return { outcome: "not_implementing", superLike: false };
  if (a === "done" && b === "done") return { outcome: "completed", superLike: false };
  return { outcome: "discuss", superLike: false };
}

function iso() {
  return new Date().toISOString();
}

function openSwipeStore({ dbPath = defaultDbPath(), Database = require("better-sqlite3") } = {}) {
  if (dbPath !== ":memory:") require("fs").mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS swipe_votes (
      issue_number INTEGER NOT NULL,
      voter TEXT NOT NULL,
      vote TEXT NOT NULL,
      voted_at TEXT NOT NULL,
      PRIMARY KEY (issue_number, voter)
    );
    CREATE TABLE IF NOT EXISTS swipe_outcomes (
      issue_number INTEGER PRIMARY KEY,
      outcome TEXT NOT NULL,
      super_like INTEGER NOT NULL DEFAULT 0,
      applied_status TEXT,
      kanban_id INTEGER,
      decided_by TEXT,
      decided_at TEXT NOT NULL
    );
  `);

  const getVotes = db.prepare("SELECT voter, vote, voted_at FROM swipe_votes WHERE issue_number = ? ORDER BY voted_at");
  const upsertVote = db.prepare(`INSERT INTO swipe_votes (issue_number, voter, vote, voted_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (issue_number, voter) DO UPDATE SET vote = excluded.vote, voted_at = excluded.voted_at`);
  const getOutcome = db.prepare("SELECT * FROM swipe_outcomes WHERE issue_number = ?");
  const putOutcome = db.prepare(`INSERT INTO swipe_outcomes (issue_number, outcome, super_like, applied_status, kanban_id, decided_by, decided_at)
    VALUES (@issue_number, @outcome, @super_like, @applied_status, @kanban_id, @decided_by, @decided_at)
    ON CONFLICT (issue_number) DO UPDATE SET outcome = excluded.outcome, super_like = excluded.super_like,
      applied_status = excluded.applied_status, kanban_id = excluded.kanban_id, decided_by = excluded.decided_by, decided_at = excluded.decided_at`);

  function votesFor(issueNumber) {
    return getVotes.all(issueNumber);
  }

  // Record one voter's swipe. Returns the outcome when this vote completes a
  // pair, else null. A suggestion that already has an outcome is left alone.
  function vote(issueNumber, voter, value) {
    if (!VOTES.includes(value)) throw Object.assign(new Error(`vote must be one of ${VOTES.join(", ")}`), { status: 400 });
    if (!voter) throw Object.assign(new Error("voter is required"), { status: 400 });
    return db.transaction(() => {
      if (getOutcome.get(issueNumber)) return { alreadyDecided: true, outcome: null };
      upsertVote.run(issueNumber, voter, value, iso());
      const counted = getVotes.all(issueNumber).filter((v) => COUNTED.has(v.vote));
      if (counted.length < 2) return { alreadyDecided: false, outcome: null };
      return { alreadyDecided: false, outcome: resolveOutcome(counted[0].vote, counted[1].vote) };
    })();
  }

  function recordOutcome(issueNumber, { outcome, superLike = false, appliedStatus = null, kanbanId = null, decidedBy = null }) {
    if (!OUTCOMES.includes(outcome)) throw Object.assign(new Error(`outcome must be one of ${OUTCOMES.join(", ")}`), { status: 400 });
    putOutcome.run({
      issue_number: issueNumber,
      outcome,
      super_like: superLike ? 1 : 0,
      applied_status: appliedStatus,
      kanban_id: kanbanId,
      decided_by: decidedBy,
      decided_at: iso(),
    });
    return getOutcome.get(issueNumber);
  }

  function outcomeFor(issueNumber) {
    return getOutcome.get(issueNumber) || null;
  }

  // Undo: forget the outcome and the votes so the suggestion goes back in
  // the deck. With onlyVoter, the other voter's vote stands and only that
  // voter swipes it again.
  function reopen(issueNumber, { onlyVoter = null } = {}) {
    db.transaction(() => {
      db.prepare("DELETE FROM swipe_outcomes WHERE issue_number = ?").run(issueNumber);
      if (onlyVoter) db.prepare("DELETE FROM swipe_votes WHERE issue_number = ? AND voter = ?").run(issueNumber, onlyVoter);
      else db.prepare("DELETE FROM swipe_votes WHERE issue_number = ?").run(issueNumber);
    })();
  }

  function allVotes() {
    return db.prepare("SELECT issue_number, voter, vote, voted_at FROM swipe_votes").all();
  }

  function allOutcomes() {
    return db.prepare("SELECT * FROM swipe_outcomes ORDER BY decided_at DESC").all();
  }

  return { db, close: () => db.close(), vote, votesFor, recordOutcome, outcomeFor, reopen, allVotes, allOutcomes };
}

let shared = null;
function sharedSwipeStore() {
  if (!shared) shared = openSwipeStore();
  return shared;
}

module.exports = {
  VOTES,
  OUTCOMES,
  STATUS_FOR_OUTCOME,
  resolveOutcome,
  openSwipeStore,
  sharedSwipeStore,
  defaultDbPath,
};
