// Focused tests for the pinned-source shape check (#136, mirrors
// AHDGame#1966 simSource shape behavior). Pure validation only — no Mongo,
// no git, no worktree mutation.
// Run: node --test mcp/worldsim-source.test.js
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { z } = require("zod");
const {
  SOURCE_WORKTREE_RE,
  SOURCE_COMMIT_RE,
  sourceWorktreeSchema,
  sourceCommitSchema,
  assertSimSourcePin,
  assertCampaignPriceRun,
} = require("./worldsim-source");

const SHA = "a".repeat(40);
const SHA2 = "0123456789abcdef".repeat(2) + "01234567".slice(0, 8);

describe("worldsim pinned-source schema fields", () => {
  it("accepts omission on both fields", () => {
    assert.equal(sourceWorktreeSchema(z).parse(undefined), undefined);
    assert.equal(sourceCommitSchema(z).parse(undefined), undefined);
  });

  it("accepts a valid leaf name plus full 40-hex SHA", () => {
    assert.equal(sourceWorktreeSchema(z).parse("muse-992"), "muse-992");
    assert.equal(sourceCommitSchema(z).parse(SHA), SHA);
    assert.equal(sourceCommitSchema(z).parse(SHA2), SHA2);
  });

  it("rejects traversal and path strings as worktree names", () => {
    for (const bad of [
      "../main",
      "..",
      ".",
      "a/b",
      "muse-992/../../etc",
      "./muse-992",
      "/root/projects/AHDGame/worktrees/muse-992",
      "/etc/passwd",
      "muse 992",
      " muse-992",
      "muse-992 ",
      "muse-992\n",
      "muse.992",
      "",
    ]) {
      assert.throws(() => sourceWorktreeSchema(z).parse(bad), undefined, bad);
      assert.ok(!SOURCE_WORKTREE_RE.test(bad), bad);
    }
  });

  it("rejects short SHAs, refs, and non-lowercase-hex commits", () => {
    for (const bad of [
      "HEAD",
      "main",
      "development",
      "v1.2.3",
      SHA.slice(0, 7),
      SHA.slice(0, 39),
      SHA + "a",
      SHA.toUpperCase(),
      "G".repeat(40),
      " ".repeat(40),
      "",
    ]) {
      assert.throws(() => sourceCommitSchema(z).parse(bad), undefined, bad);
      assert.ok(!SOURCE_COMMIT_RE.test(bad), bad);
    }
  });
});

describe("worldsim pinned-source pair check (enqueue time)", () => {
  it("passes omission through as unpinned", () => {
    assert.equal(assertSimSourcePin(undefined, undefined), null);
  });

  it("accepts a valid pair unchanged (no normalization)", () => {
    assert.deepEqual(assertSimSourcePin("muse-992", SHA), {
      sourceWorktree: "muse-992",
      sourceCommit: SHA,
    });
  });

  it("rejects a partial pair on either side, including empty strings", () => {
    for (const [w, c] of [
      ["muse-992", undefined],
      [undefined, SHA],
      ["muse-992", ""],
      ["", SHA],
      ["", ""],
    ]) {
      assert.throws(() => assertSimSourcePin(w, c), /must both be set/, JSON.stringify([w, c]));
    }
  });

  it("rejects traversal/path worktrees even with a good SHA", () => {
    for (const bad of ["../x", "a/b", "/root/projects/AHDGame/worktrees/x", ".", "a b"]) {
      assert.throws(() => assertSimSourcePin(bad, SHA), /sourceWorktree/, bad);
    }
  });

  it("rejects short/ref/uppercase SHAs even with a good worktree", () => {
    for (const bad of ["HEAD", "main", SHA.slice(0, 7), SHA.toUpperCase(), "g".repeat(40)]) {
      assert.throws(() => assertSimSourcePin("muse-992", bad), /sourceCommit/, bad);
    }
  });

  it("does not normalize case or whitespace (worker validates verbatim)", () => {
    // Uppercase hex is rejected, not lowercased; padded values are rejected,
    // not trimmed — what the caller sends is what the worker checks.
    assert.throws(() => assertSimSourcePin("muse-992", ` ${SHA}`), /sourceCommit/);
    assert.throws(() => assertSimSourcePin("muse-992", `${SHA}\n`), /sourceCommit/);
    assert.throws(() => assertSimSourcePin("Muse-992 ", SHA), /sourceWorktree/);
    // Leaf charset itself is case-preserving, like the worker SAFE_TOKEN.
    assert.deepEqual(assertSimSourcePin("Muse-992", SHA), {
      sourceWorktree: "Muse-992",
      sourceCommit: SHA,
    });
  });
});


describe("campaign price run admission", () => {
  const pin = assertSimSourcePin("muse-992", SHA);

  it("preserves legacy jobs with no override", () => {
    assert.doesNotThrow(() => assertCampaignPriceRun(undefined, null, "immediate"));
  });

  it("admits both explicit comparison arms only with a pin and window", () => {
    for (const enabled of [false, true]) {
      assert.doesNotThrow(() => assertCampaignPriceRun(enabled, pin, "window"));
      assert.throws(() => assertCampaignPriceRun(enabled, null, "window"), /pinned source/);
      assert.throws(() => assertCampaignPriceRun(enabled, pin, "immediate"), /startPolicy=window/);
    }
  });

  it("rejects a non-boolean override", () => {
    assert.throws(() => assertCampaignPriceRun("true", pin, "window"), /must be boolean/);
  });
});
