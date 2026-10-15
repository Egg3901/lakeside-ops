"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseGithubRef } = require("./kanban-store");

test("transferred issue references use one identity across old and new namespaces", () => {
  const expected = { repo: "lakesidegamedev/AHDGame", number: 42, url: "https://github.com/lakesidegamedev/AHDGame/issues/42" };
  for (const input of ["Egg3901/AHDGame#42", "lakesidegamedev/ahdgame#42", "https://github.com/egg3901/AHDGame/issues/42", { repo: "Egg3901/AHDGame", number: 42 }]) {
    assert.deepEqual(parseGithubRef(input), expected);
  }
});

test("renamed MOVGame references resolve to the transferred repository", () => {
  assert.equal(parseGithubRef("Egg3901/ahd-sim#10").repo, "lakesidegamedev/MOVGame");
});

test("historical personal and unrelated owners keep their identity", () => {
  assert.equal(parseGithubRef("Egg3901/personal-ops#2").repo, "Egg3901/personal-ops");
  assert.equal(parseGithubRef("someone/AHDGame#2").repo, "someone/AHDGame");
});

test("old and transferred references cannot create duplicate kanban cards", () => {
  const { openKanban } = require("./kanban-store");
  const board = openKanban(":memory:");
  try {
    board.upsertProduct({ slug: "a-house-divided", name: "A House Divided", aliases: ["ahd"] });
    const card = board.add({ product: "ahd", title: "Existing work", lane: "now", github: "Egg3901/AHDGame#42" });
    assert.equal(card.github.repo, "lakesidegamedev/AHDGame");
    assert.throws(() => board.add({ product: "ahd", title: "Duplicate", github: "lakesidegamedev/AHDGame#42" }), /already item/);
    assert.equal(board.get(card.id).lane, "now");
  } finally {
    board.db.close();
  }
});
