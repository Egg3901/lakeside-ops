"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getAskSearchRoots,
  normalizeAskRetrievalQuery,
  shouldIndexAskDirectory,
} = require("./ask-retrieval");

test("normalizes common Staatsrat speech and spelling variants", () => {
  const query = normalizeAskRetrievalQuery("What does the Staats raar do?");

  assert.match(query, /Staatsrat/);
  assert.match(query, /Council of State/);
});

test("keeps seeded player wiki content searchable", () => {
  assert.equal(shouldIndexAskDirectory("wiki"), true);
  assert.equal(shouldIndexAskDirectory("node_modules"), false);
  assert.equal(shouldIndexAskDirectory("plans"), false);

  const roots = getAskSearchRoots("/game");
  assert.equal(roots[0], "/game/src/lib/seeds/wiki/content");
  assert.equal(roots.at(-1), "/game");
});

test("leaves unrelated mechanics questions unchanged", () => {
  const question = "How does party confidence work?";
  assert.equal(normalizeAskRetrievalQuery(question), question);
});
