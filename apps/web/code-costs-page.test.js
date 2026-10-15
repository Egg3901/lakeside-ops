// Regression: Code burn breakdown page markup + period helper.
// Run: node --test code-costs-page.test.js agent-cost-breakdown.test.js
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const makeCodeCostsPage = require("./code-costs-page");

describe("code costs page", () => {
  const html = makeCodeCostsPage("", "/*BASE*/");

  it("includes period controls and ledger hooks", () => {
    assert.match(html, /id="period-seg"/);
    assert.match(html, /data-period="today"/);
    assert.match(html, /data-period="week"/);
    assert.match(html, /data-period="month"/);
    assert.match(html, /id="ledger-body"/);
    assert.match(html, /id="ledger-q"/);
    assert.match(html, /id="ledger-provider"/);
    assert.match(html, /\/api\/code\/costs\/breakdown/);
  });

  it("links back to the code homepage", () => {
    assert.match(html, /href="\/code"/);
    assert.match(html, /Code burn/);
  });
});
