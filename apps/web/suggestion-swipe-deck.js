"use strict";

// suggestion-swipe-deck.js: builds one voter's deck for /suggestions/swipe.
//
// The deck is every unreviewed, unmerged suggestion without a swipe outcome.
// Near-identical suggestions (embedding cosine >= MERGE_SIM) become one card
// and are voted together. Looser matches (>= RELATED_SIM), including already
// decided suggestions, are shown on the card as context, since a close match
// marked completed usually means "already shipped".
//
// Voting is blind: a voter never sees the other voter's choice on a card
// until both have voted, and then only in the discuss pile or the decided
// list. Progress for other voters is a count, not their votes.

const { VOTES } = require("./suggestion-swipe-store");

const MERGE_SIM = 0.85;
const RELATED_SIM = 0.7;
const RELATED_MAX = 3;
const RECENT_MAX = 40;
const COUNTED = new Set(VOTES.filter((v) => v !== "skip"));

function dot(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let x = 0;
  for (let i = 0; i < a.length; i++) x += a[i] * b[i];
  return x;
}

// Union-find over pending suggestions joined by near-identical embeddings.
function mergeNearDuplicates(pending, threshold = MERGE_SIM) {
  const parent = pending.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < pending.length; i++) {
    for (let j = i + 1; j < pending.length; j++) {
      if (dot(pending[i].embedding, pending[j].embedding) >= threshold) parent[find(j)] = find(i);
    }
  }
  const groups = new Map();
  pending.forEach((s, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(s);
  });
  return [...groups.values()];
}

// Easy calls first (the AI flagged them as quick, a decline, or likely
// already done), then the most wanted, then the oldest.
function cardScore(card) {
  let score = 0;
  const a = card.assessment;
  if (a && (a.recommendedAction === "quick_implement" || a.recommendedAction === "decline")) score += 3;
  if (a && a.likelyAlreadyFixed) score += 3;
  score += Math.min(card.likes, 10) * 0.5;
  score += (card.members.length - 1) * 2;
  return score;
}

function orderCards(cards) {
  return cards.sort((x, y) => cardScore(y) - cardScore(x) || x.issueNumber - y.issueNumber);
}

function publicSuggestion(s) {
  return { issueNumber: s.issueNumber, title: s.title || "", status: s.status };
}

function shapeAssessment(a) {
  if (!a) return null;
  return {
    summary: a.summary || "",
    recommendation: a.recommendation || "",
    complexity: a.complexity || null,
    risk: a.risk || null,
    recommendedAction: a.recommendedAction || null,
    likelyAlreadyFixed: !!a.likelyAlreadyFixed,
  };
}

// Pure part of the deck, separated from Mongo so it can be tested.
function assembleDeck({ pending, others = [], assessments = new Map(), votes = [], outcomes = [], voter }) {
  const outcomeBy = new Map(outcomes.map((o) => [o.issue_number, o]));
  const votesBy = new Map();
  for (const v of votes) {
    if (!votesBy.has(v.issue_number)) votesBy.set(v.issue_number, []);
    votesBy.get(v.issue_number).push(v);
  }
  const titleBy = new Map([...pending, ...others].map((s) => [s.issueNumber, s.title || ""]));

  const open = pending.filter((s) => !outcomeBy.has(s.issueNumber));
  const cards = mergeNearDuplicates(open).map((group) => {
    group.sort((a, b) => ((b.reactions && b.reactions.like) || 0) - ((a.reactions && a.reactions.like) || 0) || a.issueNumber - b.issueNumber);
    const lead = group[0];
    const inGroup = new Set(group.map((s) => s.issueNumber));
    const related = [...pending, ...others]
      .filter((s) => !inGroup.has(s.issueNumber))
      .map((s) => ({ s, sim: dot(lead.embedding, s.embedding) }))
      .filter((r) => r.sim >= RELATED_SIM)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, RELATED_MAX)
      .map((r) => ({ ...publicSuggestion(r.s), similarity: Math.round(r.sim * 100) / 100 }));
    return {
      issueNumber: lead.issueNumber,
      members: group.map((s) => s.issueNumber),
      title: lead.title || "",
      description: lead.description || "",
      impact: lead.impact || "",
      category: lead.category || null,
      gameSystem: lead.gameSystem || null,
      likes: group.reduce((n, s) => n + ((s.reactions && s.reactions.like) || 0), 0),
      dislikes: group.reduce((n, s) => n + ((s.reactions && s.reactions.dislike) || 0), 0),
      createdAt: lead.createdAt || null,
      memberTitles: group.slice(1).map((s) => ({ issueNumber: s.issueNumber, title: s.title || "" })),
      assessment: shapeAssessment(assessments.get(lead.issueNumber)),
      related,
    };
  });
  orderCards(cards);

  const myVote = (card) => {
    const mine = card.members.map((n) => (votesBy.get(n) || []).find((v) => v.voter === voter)).filter(Boolean);
    if (mine.length && mine.every((v) => COUNTED.has(v.vote))) return "counted";
    if (mine.some((v) => v.vote === "skip")) return "skip";
    return null;
  };
  const fresh = [];
  const skipped = [];
  let waiting = 0;
  for (const card of cards) {
    const state = myVote(card);
    if (state === "counted") waiting++;
    else if (state === "skip") skipped.push(card);
    else fresh.push(card);
  }

  // Other voters' progress: how many open cards each still has, never what
  // they chose.
  const voters = [...new Set(votes.map((v) => v.voter))].filter((v) => v !== voter);
  const otherVoters = voters.map((v) => ({
    voter: v.split("@")[0],
    remaining: cards.filter((c) => !c.members.every((n) => (votesBy.get(n) || []).some((x) => x.voter === v && COUNTED.has(x.vote)))).length,
  }));

  // Discuss pile and decided list: both votes are in, so they are visible.
  // Members of one merged card share an outcome row each; collapse them.
  const collapse = (rows) => {
    const seen = new Map();
    for (const o of rows) {
      const key = o.kanban_id ? `k${o.kanban_id}` : `${o.outcome}:${o.decided_at}:${o.decided_by}`;
      if (!seen.has(key)) seen.set(key, { ...o, members: [] });
      seen.get(key).members.push(o.issue_number);
    }
    return [...seen.values()].map((o) => ({
      issueNumber: Math.min(...o.members),
      members: o.members.sort((a, b) => a - b),
      title: titleBy.get(Math.min(...o.members)) || "",
      outcome: o.outcome,
      superLike: !!o.super_like,
      appliedStatus: o.applied_status || null,
      kanbanId: o.kanban_id || null,
      decidedBy: o.decided_by ? String(o.decided_by).split("@")[0] : null,
      decidedAt: o.decided_at,
      votes: o.members.flatMap((n) => votesBy.get(n) || [])
        .filter((v, i, all) => all.findIndex((x) => x.voter === v.voter) === i)
        .map((v) => ({ voter: v.voter.split("@")[0], vote: v.vote, mine: v.voter === voter })),
    }));
  };
  const discussRows = outcomes.filter((o) => o.outcome === "discuss");
  const decidedRows = outcomes.filter((o) => o.outcome !== "discuss");
  const discuss = collapse(discussRows);
  const decided = collapse(decidedRows).slice(0, RECENT_MAX);

  return {
    voter: voter.split("@")[0],
    cards: [...fresh, ...skipped],
    counts: {
      open: cards.length,
      mine: fresh.length + skipped.length,
      skipped: skipped.length,
      waiting,
      discuss: discuss.length,
      matches: collapse(decidedRows.filter((o) => o.outcome === "planned")).length,
      declined: collapse(decidedRows.filter((o) => o.outcome === "not_implementing")).length,
      shipped: collapse(decidedRows.filter((o) => o.outcome === "completed")).length,
    },
    otherVoters,
    discuss: discuss.map((d) => ({ ...d, card: cardForDiscuss(d, pending, assessments) })),
    decided,
  };
}

function cardForDiscuss(d, pending, assessments) {
  const lead = pending.find((s) => s.issueNumber === d.issueNumber);
  if (!lead) return null;
  return {
    description: lead.description || "",
    impact: lead.impact || "",
    assessment: shapeAssessment(assessments.get(lead.issueNumber)),
  };
}

async function buildDeck({ db, store, voter }) {
  const coll = db.collection("suggestions");
  const projection = { issueNumber: 1, title: 1, description: 1, impact: 1, category: 1, gameSystem: 1, reactions: 1, status: 1, createdAt: 1, embedding: 1, assessmentId: 1 };
  const [pending, others] = await Promise.all([
    coll.find({ status: "not_reviewed", mergedInto: { $exists: false } }, { projection }).toArray(),
    coll.find({ status: { $ne: "not_reviewed" }, mergedInto: { $exists: false } }, { projection: { issueNumber: 1, title: 1, status: 1, embedding: 1 } }).toArray(),
  ]);
  const ids = pending.map((s) => s._id);
  const rows = ids.length
    ? await db.collection("assessments")
      .find({ targetType: "suggestion", targetId: { $in: ids }, status: { $ne: "error" } },
        { projection: { targetId: 1, summary: 1, recommendation: 1, complexity: 1, risk: 1, recommendedAction: 1, likelyAlreadyFixed: 1, createdAt: 1 } })
      .sort({ createdAt: 1 })
      .toArray()
    : [];
  const numberById = new Map(pending.map((s) => [s._id.toString(), s.issueNumber]));
  const assessments = new Map();
  for (const a of rows) assessments.set(numberById.get(a.targetId.toString()), a); // ascending, so the latest wins
  // Outcomes also cover suggestions whose status has since changed, so the
  // decided list keeps titles; the deck itself only uses pending ones.
  return assembleDeck({ pending, others, assessments, votes: store.allVotes(), outcomes: store.allOutcomes(), voter });
}

module.exports = { buildDeck, assembleDeck, mergeNearDuplicates, orderCards, MERGE_SIM, RELATED_SIM };
