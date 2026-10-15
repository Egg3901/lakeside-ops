// Unit tests for the Keir inbox page and its Attention panel model.
// Run: node --test keir-inbox-page.test.js
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { makeKeirInboxBody, attentionModel } = require("./keir-inbox-page");

const NOW = Date.parse("2026-10-12T15:00:00.000Z");
const MIN = 60e3;

describe("keir inbox page", () => {
  it("ships a hidden Attention panel above the inbox and a script that parses", () => {
    const { body } = makeKeirInboxBody();
    assert.match(body, /<div class="ib-attn" id="ib-attn" hidden><\/div>\s*<div id="ib-error">/);
    const script = body.match(/<script>([\s\S]*)<\/script>/)[1];
    assert.doesNotThrow(() => new vm.Script(script));
    assert.match(script, /function attentionModel\(data, now\)/);
    assert.match(script, /fetch\(API\+'\/alerts'/);
  });

  it("does not render the panel through innerHTML", () => {
    const { body } = makeKeirInboxBody();
    assert.doesNotMatch(body, /ib-attn'\)\.innerHTML|box\.innerHTML/);
  });
});

describe("attentionModel", () => {
  it("returns null when nothing needs the owner", () => {
    assert.equal(attentionModel(null, NOW), null);
    assert.equal(attentionModel({}, NOW), null);
    assert.equal(attentionModel({ prodHold: null, pendingApprovals: [], blocked: [], alerts: [], shadow: null }, NOW), null);
    assert.equal(attentionModel({ shadow: { at: NOW, anomalies: [] } }, NOW), null);
  });

  it("ignores an expired production hold", () => {
    assert.equal(attentionModel({ prodHold: "2026-10-12T14:00:00.000Z" }, NOW), null);
  });

  it("shows an active production hold in US Eastern", () => {
    const m = attentionModel({ prodHold: "2026-10-12T16:00:00.000Z" }, NOW);
    assert.equal(m.hold.until, "Oct 12, 12:00 PM ET");
    assert.equal(m.hold.rel, "in 1h");
    assert.deepEqual(m.chips.map(([, n]) => n), [0, 0, 0, 0]);
  });

  it("builds pending approvals with the exact owner action", () => {
    const m = attentionModel({
      pendingApprovals: [{ id: "abc123def456", kind: "heal", jobId: "j1", ticket: 1506, summary: "Refund corp cash", at: NOW - 5 * MIN, expiresAt: NOW + 40 * MIN }],
    }, NOW);
    const p = m.approvals[0];
    assert.equal(p.action, "Reply `Keir approve abc123def456` in the task's channel");
    assert.equal(p.ticket, "#1506");
    assert.equal(p.when, "5m ago");
    assert.equal(p.expires, "expires in 40m");
    assert.match(p.title, / ET$/);
    assert.deepEqual(m.chips[0], ["Pending approvals", 1]);
  });

  it("counts blocked tasks, alerts and shadow anomalies", () => {
    const m = attentionModel({
      blocked: [{ id: "job9", kind: "ticket", ticket: null, summary: "Waiting on owner", updatedAt: NOW - 2 * 3600e3 }],
      alerts: [{ key: "a", content: "x", at: NOW - 30e3 }, { key: "b", content: "y", at: NOW - 3 * 864e5 }],
      shadow: { at: NOW - 10 * MIN, anomalies: ["drift", "", "gap"] },
    }, NOW);
    assert.deepEqual(m.chips.map(([, n]) => n), [0, 1, 2, 2]);
    assert.equal(m.blocked[0].ticket, "");
    assert.equal(m.blocked[0].when, "2h ago");
    assert.equal(m.alerts[0].when, "<1m ago");
    assert.equal(m.alerts[1].when, "3d ago");
    assert.deepEqual(m.shadow.anomalies, ["drift", "gap"]);
  });

  it("keeps player text as plain strings and tolerates junk rows", () => {
    const m = attentionModel({ alerts: [null, "bad", { content: "<img src=x onerror=alert(1)>", at: "nope" }], pendingApprovals: "x" }, NOW);
    assert.equal(m.alerts.length, 1);
    assert.equal(m.alerts[0].content, "<img src=x onerror=alert(1)>");
    assert.equal(m.alerts[0].when, "");
    assert.equal(m.approvals.length, 0);
  });
});
