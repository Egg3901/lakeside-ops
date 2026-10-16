"use strict";
// Keir 5.2: knowledge reads are shaped for the model and the learner sees
// every doc, not the newest page.
const test = require("node:test");
const assert = require("node:assert/strict");
const { shapeKnowledge, listAll, gameKnowledge } = require("../lib/operator/knowledge");

test("shapeKnowledge excerpts query hits and returns one full entry for get", () => {
  const rows = [{ name: "a", body: "y".repeat(5000), score: 0.9, embedding: [1], history: [1] }, { name: "b", body: "short" }];
  const hits = shapeKnowledge(rows, "knowledge_query", { limit: 1 });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].body.length, 1500);
  assert.match(hits[0].more, /knowledge_get name a/);
  assert.equal(hits[0].embedding, undefined);
  const doc = shapeKnowledge({ name: "a", body: "z".repeat(30000), links: ["b"] }, "knowledge_get");
  assert.equal(doc.body.length, 12000);
  assert.deepEqual(doc.links, ["b"]);
  assert.equal(doc.more, undefined);
  assert.equal(shapeKnowledge([], "knowledge_get"), undefined);
});

test("gameKnowledge is opt-in by the mechanics tag and refuses superseded, runbook and memory entries", () => {
  const ahd = (tags) => ({ project: "a-house-divided", tags });
  assert.equal(gameKnowledge(ahd(["mechanics"])), true);
  assert.equal(gameKnowledge(ahd(["unions", "1991", "central-bank"])), false, "domain tags alone are not an opt-in");
  assert.equal(gameKnowledge({ ...ahd(["mechanics"]), kind: "memory" }), false);
  assert.equal(gameKnowledge({ ...ahd(["Mechanics"]), kind: "docs" }), true);
  assert.equal(gameKnowledge(ahd(["mechanics", "superseded"])), false);
  assert.equal(gameKnowledge(ahd(["economy", "runbook"])), false);
  assert.equal(gameKnowledge(ahd(["release"])), false);
  assert.equal(gameKnowledge({ project: "shared", tags: ["mechanics"] }), false);
  assert.equal(gameKnowledge(null), false);
});

test("listAll pages until a short page and stops when the server ignores offset", async () => {
  const docs = Array.from({ length: 1203 }, (_, i) => ({ name: `d${i}` }));
  const paged = await listAll(async ({ limit, offset }) => docs.slice(offset, offset + limit));
  assert.equal(paged.rows.length, 1203);
  assert.equal(paged.complete, true);
  const ignored = await listAll(async ({ limit }) => docs.slice(0, limit));
  assert.equal(ignored.rows.length, 500);
  assert.equal(ignored.complete, false, "a server without offset never proves the list complete");
  const small = await listAll(async () => ({ items: docs.slice(0, 7) }));
  assert.deepEqual([small.rows.length, small.complete], [7, true]);
});

test('knowledge shaping preserves bounded version and source identities but does not claim verification',()=>{
 const row={name:'rule',version:7,body:'Rule text',metadata:{sources:[{repo:'example',path:'src/rule.js',commit:'a'.repeat(40),sha256:'b'.repeat(64),line:12,secret:'hidden'}],authToken:'hidden'},embedding:[1],history:[1]};
 const doc=shapeKnowledge(row,'knowledge_get');assert.equal(doc.version,7);assert.equal(doc.sourceReferences[0].path,'src/rule.js');assert.equal(doc.sourceReferences[0].secret,undefined);assert.equal(doc.sourceVerification,'not-checked');assert.equal(doc.metadata,undefined);assert.equal(shapeKnowledge({...row,stale:true},'knowledge_get').stale,true);
});
