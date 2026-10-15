// Unit tests for the tracker board: report badges link rows back to their
// support ticket or suggestion, and nothing renders without a resolved link.
// Run: node --test tracker-page.test.js
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { makeTrackerBody } = require("./tracker-page");

function item(over = {}) {
  return {
    id: "support-ticket-42",
    kind: "task",
    title: "Fix the globe",
    status: "active",
    status_label: "Active",
    stage: 0,
    blocked_by: null,
    issue: null,
    issue_url: null,
    tags: [],
    body: null,
    updated_at: 1757280000000,
    updated_by: null,
    ...over,
  };
}

function boardWith(items) {
  return {
    totals: { total: items.length, done: 0, in_production: 0, blocked: 0, active: 1 },
    realms: [{
      realm: "Game",
      projects: [{
        project: "work",
        progress: { total: items.length, done: 0, in_production: 0 },
        phases: [{ name: "", items }],
      }],
    }],
  };
}

describe("makeTrackerBody report badges", () => {
  it("renders a quick loading state while the tracker snapshot warms", () => {
    const { body } = makeTrackerBody({ board: null, error: null, loading: true });

    assert.match(body, /Loading the work board/);
    assert.match(body, /\/api\/tracker\/cache-status/);
    assert.match(body, /Try again/);
  });

  it("links a linked row to its report page", () => {
    const { body } = makeTrackerBody({
      board: boardWith([item()]),
      error: null,
      links: { "support-ticket-42": { href: "/t/abc123", label: "ticket" } },
    });
    assert.ok(body.includes('href="/t/abc123"'), "badge must point at the report page");
    assert.ok(body.includes(">ticket<"), "badge must name the report kind");
    assert.ok(body.includes("Fix the globe"), "row itself must still render");
  });

  it("links suggestions to their own pages", () => {
    const { body } = makeTrackerBody({
      board: boardWith([item({ id: "support-suggestion-7" })]),
      error: null,
      links: { "support-suggestion-7": { href: "/s/xyz789", label: "suggestion" } },
    });
    assert.ok(body.includes('href="/s/xyz789"'));
    assert.ok(body.includes(">suggestion<"));
  });

  it("renders no badge without a resolved link", () => {
    const { body } = makeTrackerBody({ board: boardWith([item()]), error: null });
    assert.ok(!body.includes("/t/") && !body.includes("/s/"), "unlinked rows render exactly as before");
    assert.ok(body.includes("Fix the globe"));
  });

  it("escapes badge targets", () => {
    const { body } = makeTrackerBody({
      board: boardWith([item()]),
      error: null,
      links: { "support-ticket-42": { href: '/t/"onmouseover="x', label: "<ticket>" } },
    });
    assert.ok(!body.includes('"onmouseover="'), "href must be escaped");
    assert.ok(!body.includes("<ticket>"), "label must be escaped");
  });
});
