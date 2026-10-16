"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const { resolveOutcome, openSwipeStore } = require("./suggestion-swipe-store");
const { assembleDeck, mergeNearDuplicates } = require("./suggestion-swipe-deck");
const { handleSuggestionSwipeRoute } = require("./suggestion-swipe-routes");

const unit = (i, n = 4) => Array.from({ length: n }, (_, k) => (k === i ? 1 : 0));

test("resolveOutcome: agreement decides, anything else is discussed", () => {
  assert.deepEqual(resolveOutcome("yes", "yes"), { outcome: "planned", superLike: false });
  assert.deepEqual(resolveOutcome("yes", "super"), { outcome: "planned", superLike: true });
  assert.deepEqual(resolveOutcome("no", "no"), { outcome: "not_implementing", superLike: false });
  assert.deepEqual(resolveOutcome("done", "done"), { outcome: "completed", superLike: false });
  assert.equal(resolveOutcome("yes", "no").outcome, "discuss");
  assert.equal(resolveOutcome("done", "no").outcome, "discuss");
  assert.equal(resolveOutcome("skip", "yes"), null);
});

test("store: skips do not count and a second counted vote resolves", () => {
  const s = openSwipeStore({ dbPath: ":memory:" });
  assert.equal(s.vote(7, "a@x", "skip").outcome, null);
  assert.equal(s.vote(7, "b@x", "yes").outcome, null);
  assert.equal(s.vote(7, "a@x", "super").outcome.outcome, "planned");
  s.recordOutcome(7, { outcome: "planned", superLike: true, appliedStatus: "planned" });
  assert.equal(s.vote(7, "a@x", "no").alreadyDecided, true);
  s.reopen(7, { onlyVoter: "a@x" });
  assert.equal(s.outcomeFor(7), null);
  assert.deepEqual(s.votesFor(7).map((v) => v.voter), ["b@x"]);
  s.close();
});

test("mergeNearDuplicates groups only near-identical embeddings", () => {
  const groups = mergeNearDuplicates([
    { issueNumber: 1, embedding: unit(0) },
    { issueNumber: 2, embedding: unit(0) },
    { issueNumber: 3, embedding: [0.8, 0.6, 0, 0] },
    { issueNumber: 4, embedding: unit(2) },
  ]);
  assert.deepEqual(groups.map((g) => g.map((s) => s.issueNumber)), [[1, 2], [3], [4]]);
});

test("assembleDeck is blind and orders skipped cards last", () => {
  const pending = [
    { issueNumber: 1, title: "one", status: "not_reviewed", embedding: unit(0) },
    { issueNumber: 2, title: "two", status: "not_reviewed", embedding: unit(1) },
    { issueNumber: 3, title: "three", status: "not_reviewed", embedding: unit(2) },
    { issueNumber: 4, title: "four", status: "not_reviewed", embedding: unit(3) },
  ];
  const others = [{ issueNumber: 9, title: "shipped one", status: "completed", embedding: [0.9, 0.43, 0, 0] }];
  const votes = [
    { issue_number: 1, voter: "me@x", vote: "skip" },
    { issue_number: 2, voter: "me@x", vote: "yes" },
    { issue_number: 3, voter: "other@x", vote: "no" },
    { issue_number: 4, voter: "me@x", vote: "no" },
    { issue_number: 4, voter: "other@x", vote: "yes" },
  ];
  const outcomes = [{ issue_number: 4, outcome: "discuss", super_like: 0, decided_at: "t", decided_by: "other@x" }];
  const deck = assembleDeck({ pending, others, votes, outcomes, voter: "me@x" });
  assert.deepEqual(deck.cards.map((c) => c.issueNumber), [3, 1]);
  assert.equal(deck.counts.waiting, 1);
  assert.equal(deck.counts.discuss, 1);
  // The other voter's choice on an open card never reaches this voter.
  assert.ok(!JSON.stringify(deck.cards).includes("other"));
  assert.deepEqual(deck.otherVoters, [{ voter: "other", remaining: 2 }]);
  // Both votes show once a card is in the discuss pile.
  assert.deepEqual(deck.discuss[0].votes.map((v) => v.vote).sort(), ["no", "yes"]);
  // A close decided match is offered as context.
  assert.equal(deck.cards.find((c) => c.issueNumber === 1).related[0].issueNumber, 9);
});

function fakeDb(docs) {
  return {
    collection(name) {
      assert.equal(name, "suggestions");
      return {
        async updateOne(filter, update) {
          const d = docs.find((x) => x.issueNumber === filter.issueNumber && x.status === filter.status);
          if (!d) return { modifiedCount: 0 };
          Object.assign(d, update.$set);
          (d.statusHistory = d.statusHistory || []).push(update.$push.statusHistory);
          return { modifiedCount: 1 };
        },
        find(filter) {
          const list = docs.filter((x) => filter.issueNumber.$in.includes(x.issueNumber));
          return { sort: () => ({ toArray: async () => list }) };
        },
      };
    },
  };
}

function call(pathname, { email = "me@x", role = "admin", method = "POST", body, origin = "http://127.0.0.1:1" }, ctx) {
  const req = Readable.from(body ? [JSON.stringify(body)] : []);
  req.method = method;
  req.headers = { host: "127.0.0.1:1", origin, "x-requested-with": "ops-dashboard" };
  const out = { status: 0, body: "" };
  const res = { setHeader() {}, writeHead(s) { out.status = s; }, end(b) { out.body = b || ""; } };
  return handleSuggestionSwipeRoute(req, res, pathname, {
    resolveSession: async () => (role ? { role, email } : null),
    addSecurityHeaders() {},
    renderShell: ({ body: html }) => html,
    ...ctx,
  }).then((handled) => ({ handled, ...out, json: () => JSON.parse(out.body) }));
}

test("routes: access rules", async () => {
  const s = openSwipeStore({ dbPath: ":memory:" });
  const ctx = { store: () => s, getDb: async () => fakeDb([]), kanban: () => ({}), audit: () => null };
  assert.equal((await call("/suggestions/12", {}, ctx)).handled, false);
  assert.equal((await call("/api/suggestions/swipe/vote", { role: null, body: {} }, ctx)).status, 401);
  assert.equal((await call("/api/suggestions/swipe/vote", { role: "moderator", body: {} }, ctx)).status, 404);
  assert.equal((await call("/api/suggestions/swipe/vote", { origin: "https://evil.example", body: {} }, ctx)).status, 403);
  s.close();
});

test("routes: a match on a merged card plans every member under one kanban card, undo reverts", async () => {
  const docs = [
    { issueNumber: 5, title: "Bonds rework", status: "not_reviewed" },
    { issueNumber: 6, title: "Rework bonds", status: "not_reviewed" },
  ];
  const added = [];
  const updated = [];
  const kanbanStore = {
    add(item) { added.push(item); return { id: 77 }; },
    update(id, patch) { updated.push([id, patch]); },
    logEvent() {},
  };
  const s = openSwipeStore({ dbPath: ":memory:" });
  const ctx = { store: () => s, getDb: async () => fakeDb(docs), kanban: () => kanbanStore };
  const first = await call("/api/suggestions/swipe/vote", { email: "a@x", body: { issueNumbers: [5, 6], vote: "yes" } }, ctx);
  assert.deepEqual(first.json().results, []);
  const second = (await call("/api/suggestions/swipe/vote", { email: "b@x", body: { issueNumbers: [5, 6], vote: "super" } }, ctx)).json();
  assert.equal(second.results.length, 1);
  assert.equal(second.results[0].outcome, "planned");
  assert.equal(added.length, 1);
  assert.equal(added[0].impact, "high");
  assert.equal(added[0].lane, "next");
  assert.match(added[0].title, /S#5.*\+1 similar/);
  assert.deepEqual(docs.map((d) => d.status), ["planned", "planned"]);
  assert.equal(docs[0].statusHistory[0].source, "ops-swipe");

  await call("/api/suggestions/swipe/reopen", { email: "b@x", body: { issueNumbers: [5, 6], mine: true } }, ctx);
  assert.deepEqual(docs.map((d) => d.status), ["not_reviewed", "not_reviewed"]);
  assert.deepEqual(updated, [[77, { lane: "done" }]]);
  assert.deepEqual(s.votesFor(5).map((v) => v.voter), ["a@x"]);
  s.close();
});

test("routes: a suggestion changed elsewhere is not overwritten", async () => {
  const docs = [{ issueNumber: 8, title: "x", status: "in_progress" }];
  const s = openSwipeStore({ dbPath: ":memory:" });
  const ctx = { store: () => s, getDb: async () => fakeDb(docs), kanban: () => ({}) };
  await call("/api/suggestions/swipe/vote", { email: "a@x", body: { issueNumbers: [8], vote: "no" } }, ctx);
  await call("/api/suggestions/swipe/vote", { email: "b@x", body: { issueNumbers: [8], vote: "no" } }, ctx);
  assert.equal(docs[0].status, "in_progress");
  assert.equal(s.outcomeFor(8).applied_status, null);
  s.close();
});

test("audit: invalid entries are dropped, checked-live cards lead the deck", () => {
  const { normalizeAudit } = require("./suggestion-swipe-audit");
  const audit = normalizeAudit({
    sourceCommit: "abc1234",
    items: {
      2: { verdict: "implemented", confidence: "high", inGameToday: "Exists.", asks: [] },
      3: { verdict: "partial", confidence: "medium", missing: "Half." },
      x: { verdict: "implemented" },
      4: { verdict: "maybe" },
    },
  });
  assert.deepEqual(Object.keys(audit.items), ["2", "3"]);
  const pending = [1, 2, 3].map((n) => ({ issueNumber: n, title: `s${n}`, status: "not_reviewed", embedding: unit(n - 1) }));
  const deck = assembleDeck({ pending, audit, voter: "me@x" });
  assert.deepEqual(deck.cards.map((c) => c.issueNumber), [2, 3, 1]);
  assert.equal(deck.cards[0].codeCheck.verdict, "implemented");
  assert.equal(deck.cards[2].codeCheck, null);
  assert.equal(deck.audit.checked, 2);
});

test("routes: a planned card carries the code check into the kanban detail", async () => {
  const docs = [{ issueNumber: 3, title: "Half done", status: "not_reviewed" }];
  const added = [];
  const s = openSwipeStore({ dbPath: ":memory:" });
  const audit = () => ({ sourceCommit: "abc1234", items: { 3: { verdict: "partial", confidence: "high", inGameToday: "The page exists.", missing: "No filter." } } });
  const ctx = { store: () => s, getDb: async () => fakeDb(docs), kanban: () => ({ add(i) { added.push(i); return { id: 1 }; } }), audit };
  await call("/api/suggestions/swipe/vote", { email: "a@x", body: { issueNumbers: [3], vote: "yes" } }, ctx);
  await call("/api/suggestions/swipe/vote", { email: "b@x", body: { issueNumbers: [3], vote: "yes" } }, ctx);
  assert.match(added[0].detail, /Code check \(partial, high confidence, game main abc1234\)/);
  assert.match(added[0].detail, /Still missing: No filter\./);
  s.close();
});
