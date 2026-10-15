// Unit tests for the ticket/tracker merge builders: content edits validate
// per collection, tracker upserts converge on one derived id, and the public
// view leaks nothing internal.
// Run: node --test mcp/support-tracker.test.js
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  TRACKER_COLLECTION,
  TRACKER_STATUSES,
  trackerIdFor,
  buildContentUpdate,
  buildTrackerUpsert,
  buildTrackerNote,
  publicTrackedView,
} = require("./support-tracker");

const NOW = new Date("2026-09-10T00:00:00Z");

describe("trackerIdFor", () => {
  it("derives one stable id per report", () => {
    assert.equal(trackerIdFor("ticket", 42), "support-ticket-42");
    assert.equal(trackerIdFor("suggestion", 7), "support-suggestion-7");
    assert.equal(trackerIdFor("ticket", 42), trackerIdFor("ticket", 42));
  });
});

describe("buildContentUpdate", () => {
  it("sets only supplied fields and records them in history", () => {
    const r = buildContentUpdate("ticket", { status: "open" }, { title: " New title " }, "fable", NOW);
    assert.ok(!r.error, r.error);
    assert.equal(r.set.title, "New title");
    assert.equal(r.set.updatedAt, NOW);
    assert.equal(r.historyEntry.status, "open");
    assert.equal(r.historyEntry.source, "mcp");
    assert.ok(r.historyEntry.note.includes("title"));
  });

  it("keeps the stored status on the history entry", () => {
    const r = buildContentUpdate("ticket", { status: "in_progress" }, { category: "ui" }, "fable", NOW);
    assert.equal(r.historyEntry.status, "in_progress");
  });

  it("cleans tag lists and rejects junk", () => {
    const ok = buildContentUpdate("ticket", { status: "open" }, { tags: [" ui ", "bug"] }, "fable", NOW);
    assert.deepEqual(ok.set.tags, ["ui", "bug"]);
    const bad = buildContentUpdate("ticket", { status: "open" }, { tags: "ui" }, "fable", NOW);
    assert.ok(bad.error);
  });

  it("rejects suggestion-only fields on tickets", () => {
    const r = buildContentUpdate("ticket", { status: "open" }, { gameSystem: "elections" }, "fable", NOW);
    assert.ok(r.error && r.error.includes("suggestions only"));
  });

  it("accepts suggestion-only fields on suggestions", () => {
    const r = buildContentUpdate(
      "suggestion",
      { status: "not_reviewed" },
      { gameSystem: "elections", priority: "high" },
      "fable",
      NOW
    );
    assert.ok(!r.error, r.error);
    assert.equal(r.set.gameSystem, "elections");
  });

  it("rejects empty updates and overlong titles", () => {
    assert.ok(buildContentUpdate("ticket", {}, {}, "fable", NOW).error);
    assert.ok(buildContentUpdate("ticket", {}, { title: "x".repeat(201) }, "fable", NOW).error);
  });
});

describe("buildTrackerUpsert", () => {
  it("upserts on the derived id and never replaces history-style fields", () => {
    const r = buildTrackerUpsert("ticket", 42, "Globe is blank", { status: "active", project: "a-house-divided" }, 1000);
    assert.ok(!r.error, r.error);
    assert.equal(r.id, "support-ticket-42");
    assert.equal(r.update.$set.status, "active");
    assert.equal(r.update.$set.fields.supportKind, "ticket");
    assert.equal(r.update.$set.fields.supportNumber, 42);
    assert.equal(r.update.$setOnInsert.id, "support-ticket-42");
    assert.ok(!("$push" in r.update), "tracker sync must not touch array operators");
  });

  it("falls back to the report title so a status flip still reads on the board", () => {
    const r = buildTrackerUpsert("ticket", 42, "Globe is blank", { status: "active" }, 1000);
    assert.equal(r.update.$set.title, "Globe is blank");
  });

  it("rejects unknown tracker statuses", () => {
    const r = buildTrackerUpsert("ticket", 42, "t", { status: "shipped" }, 1000);
    assert.ok(r.error && r.error.includes("unknown tracker status"));
  });

  it("accepts every tracker status the board renders", () => {
    for (const s of TRACKER_STATUSES) {
      const r = buildTrackerUpsert("ticket", 1, "t", { status: s }, 1000);
      assert.ok(!r.error, `${s}: ${r.error}`);
      assert.equal(r.update.$set.status, s);
    }
  });
});

describe("buildTrackerNote", () => {
  it("hangs the note off its parent with a collision-proof id", () => {
    const a = buildTrackerNote("support-ticket-42", "Found the cause.", "fable", "a-house-divided", 1000);
    const b = buildTrackerNote("support-ticket-42", "Found the cause.", "fable", "a-house-divided", 1001);
    assert.ok(!a.error && !b.error);
    assert.notEqual(a.id, b.id);
    assert.equal(a.doc.parent, "support-ticket-42");
    assert.equal(a.doc.kind, "note");
    assert.equal(a.doc.project, "a-house-divided");
  });

  it("rejects empty bodies", () => {
    assert.ok(buildTrackerNote("support-ticket-42", "  ", "fable", null, 1000).error);
  });
});

describe("publicTrackedView", () => {
  it("exposes status text and the blocked reason, nothing else", () => {
    const v = publicTrackedView({
      id: "support-ticket-42",
      status: "blocked",
      blocked_by: "waiting on deploy",
      updated_at: 1000,
      fields: { supportNumber: 42 },
      body: "internal notes here",
    });
    assert.equal(v.status, "blocked");
    assert.equal(v.blockedBy, "waiting on deploy");
    assert.ok(!("id" in v) && !("body" in v) && !("fields" in v));
  });

  it("renders tracker stages in plain words", () => {
    assert.equal(publicTrackedView({ status: "done_prod" }).status, "done prod");
  });

  it("returns null with no linked item", () => {
    assert.equal(publicTrackedView(null), null);
    assert.equal(TRACKER_COLLECTION, "tracker_items");
  });
});
