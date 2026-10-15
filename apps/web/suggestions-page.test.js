// Unit tests for the suggestion detail page: one safe vocabulary for
// suggesters, the full working view for staff, and no staff internals on the
// public view.
// Run: node --test suggestions-page.test.js
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { makeSuggestionDetailBody } = require("./suggestions-page");

function suggestionDoc(over = {}) {
  return {
    _id: "68c000000000000000000000",
    issueNumber: 42,
    title: "Let me embezzle",
    description: "Add an embezzle action.",
    context: "Seen while playing the finance minister.",
    impact: "More roleplay depth.",
    category: "feature_request",
    gameSystem: "economy",
    priority: "medium",
    status: "not_reviewed",
    tags: ["economy"],
    statusHistory: [],
    createdAt: "2026-09-01T00:00:00Z",
    ...over,
  };
}

function assessmentDoc(over = {}) {
  return {
    status: "ok",
    model: "jev-latest",
    summary: "SECRET-INTERNAL-SUMMARY",
    complexity: "low",
    risk: "low",
    confidence: 0.9,
    ...over,
  };
}

const linked = {
  id: "support-suggestion-42",
  status: "active",
  project: "a-house-divided",
  updated_by: "fable",
  updated_at: 1757280000000,
};

describe("makeSuggestionDetailBody", () => {
  it("shows the suggester their own words plus status and tracked work", () => {
    const pub = makeSuggestionDetailBody({
      suggestion: suggestionDoc(), assessment: null, fixSession: null, viewer: "public", tracked: linked,
    }).body;
    assert.ok(pub.includes("Let me embezzle"));
    assert.ok(pub.includes("Add an embezzle action."));
    assert.ok(pub.includes("Seen while playing the finance minister."));
    assert.ok(pub.includes("More roleplay depth."));
    assert.ok(pub.includes("not reviewed"), "public view must show the status");
    assert.ok(pub.includes("Tracked work"));
    assert.ok(pub.includes("active"), "public tracked card must show the stage");
  });

  it("keeps staff internals off the public view", () => {
    const pub = makeSuggestionDetailBody({
      suggestion: suggestionDoc(), assessment: null, fixSession: null, viewer: "public", tracked: linked,
    }).body;
    assert.ok(!pub.includes("#42"), "public view must not show the issue number");
    assert.ok(!pub.includes("support-suggestion-42"), "public view must not carry the tracker id");
    assert.ok(!pub.includes("/tracker"), "public card links nowhere internal");
    assert.ok(!pub.includes("fable"), "public card must not name who touched it");
    for (const marker of ["Launch implementation", "Re-triage", "Re-run triage", "Assessment", "Triage"]) {
      assert.ok(!pub.includes(marker), "public view must not contain: " + marker);
    }
  });

  it("keeps the full working view for staff", () => {
    const staff = makeSuggestionDetailBody({
      suggestion: suggestionDoc(), assessment: assessmentDoc(), fixSession: null, viewer: "staff", tracked: linked,
    }).body;
    assert.ok(staff.includes("#42"));
    assert.ok(staff.includes("SECRET-INTERNAL-SUMMARY"), "staff view must show the assessment");
    assert.ok(staff.includes("support-suggestion-42"));
    assert.ok(staff.includes("/tracker"));
    assert.ok(!staff.includes("Launch implementation"));
    assert.ok(!staff.includes('id="cm-launch-btn"'));
  });

  it("renders no tracked card with no linked item", () => {
    const pub = makeSuggestionDetailBody({
      suggestion: suggestionDoc(), assessment: null, fixSession: null, viewer: "public",
    }).body;
    assert.ok(!pub.includes("Tracked work"), "unlinked suggestions render exactly as before");
  });
});
