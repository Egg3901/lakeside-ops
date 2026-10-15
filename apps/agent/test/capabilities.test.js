"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { createTurnWatch, viewPage, MAX_TURN_WATCH_MS } = require("../lib/operator/capabilities");

test("turn watch wakes a task once its turn has processed, with the note", async () => {
  const data = { jobs: { j1: { id: "j1", state: "waiting", turnWatch: { turn: 150, note: "check Simonella's CA plant fill", since: 0 } } }, audit: [] };
  const ledger = { data, save() {}, audit(k, x) { data.audit.push({ k, ...x }); } };
  // currentTurn is the last processed turn: 149 means turn 150 is still coming
  let turn = 149; const w = createTurnWatch({ ledger, currentTurn: async () => turn, now: () => 1000 });
  await w.tick(); assert.equal(data.jobs.j1.state, "waiting");
  turn = 150; await w.tick(); // turn 150 has just processed
  assert.equal(data.jobs.j1.state, "queued"); assert.match(data.jobs.j1.inbox[0].content, /Turn 150 has been processed.*CA plant/);
});

test("turn watch gives up after eight hours", async () => {
  const data = { jobs: { j1: { id: "j1", state: "waiting", turnWatch: { turn: 150, since: 0 } } }, audit: [] };
  const w = createTurnWatch({ ledger: { data, save() {}, audit() {} }, currentTurn: async () => 149, now: () => MAX_TURN_WATCH_MS + 1 });
  await w.tick(); assert.match(data.jobs.j1.inbox[0].content, /still had not processed/);
});

test("page view only renders the game's own site", async () => {
  await assert.rejects(viewPage("https://evil.example/x"), /only ahousedividedgame\.com/);
  await assert.rejects(viewPage("http://ahousedividedgame.com/x"), /only/);
});
