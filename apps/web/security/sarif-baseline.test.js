const { test } = require("node:test");
const assert = require("node:assert/strict");
const { findings, compareFindings } = require("./sarif-baseline");

function report({ line = 10, hash = "same", rule = "unsafe", message = "Unsafe input", count = 1 } = {}) {
  return { version: "2.1.0", runs: [{ results: Array.from({ length: count }, () => ({
    ruleId: rule, message: { text: message }, partialFingerprints: { primaryLocationLineHash: hash },
    locations: [{ physicalLocation: { artifactLocation: { uri: "source.js" }, region: { startLine: line } } }],
  })) }] };
}

test("existing fingerprint survives line movement", () => {
  assert.deepEqual(compareFindings(findings(report({ line: 20 })), findings(report())), []);
});
test("new fingerprint, rule, or message blocks", () => {
  for (const change of [{ hash: "new" }, { rule: "new" }, { message: "new" }]) {
    assert.equal(compareFindings(findings(report(change)), findings(report())).length, 1);
  }
});
test("a second matching finding cannot consume one baseline twice", () => {
  assert.equal(compareFindings(findings(report({ count: 2 })), findings(report())).length, 1);
});
test("full scan blocks all findings without a baseline", () => {
  assert.equal(compareFindings(findings(report()), []).length, 1);
});
test("absent or malformed analysis fails closed", () => {
  for (const value of [{}, { version: "2.1.0", runs: [] }, { version: "2.1.0", runs: [{}] }]) {
    assert.throws(() => findings(value));
  }
  const value = report();
  delete value.runs[0].results[0].locations;
  assert.throws(() => findings(value));
});
