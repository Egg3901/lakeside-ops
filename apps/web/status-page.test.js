"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const makeStatusPage = require("./status-page");
const { escapeHtml } = require("./src/ui/safeDom");

test("public status cards escape feed names and reject unsafe links", () => {
  const html = makeStatusPage("", "");
  const start = html.indexOf("function esc(value)");
  const end = html.indexOf("loadStatus();", start);
  assert.ok(start > 0 && end > start);
  const context = { window: { OpsDom: { escapeHtml } }, location: { origin: "https://ops.example.test" }, URL };
  vm.runInNewContext(html.slice(start, end) + "\nthis.card = svcCard;", context);
  const card = context.card({
    name: '<img src=x onerror="alert(1)">',
    pageUrl: "javascript:alert(1)",
    current: 'operational" onclick="alert(1)',
    history: [],
  });
  assert.match(card, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.doesNotMatch(card, /href="javascript:|<img|onclick=/);
  assert.match(card, /class="svc unknown"/);
});

test("status page uses project branding and safe configured links", () => {
  const html = makeStatusPage("", "", {
    tenant: { name: "Nova Studio" },
    primary: { name: '<Nova & Co>', publicUrl: 'https://nova.example.com/', sandboxUrl: 'javascript:alert(1)' },
  });
  assert.match(html, /<title>&lt;Nova &amp; Co&gt; — System Status<\/title>/);
  assert.match(html, /href="https:\/\/nova\.example\.com\/"/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.doesNotMatch(html, /sandbox\.ahousedividedgame\.com/);
});
