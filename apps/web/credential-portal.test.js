"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const { isOpsOrigin, readCredentialSubmission, railwayConfig } = require("./credential-portal");

const request = (body, type = "application/json") => Object.assign(Readable.from([body]), { headers: { "content-type": type } });

test("only the deployment's own sign-in hosts may submit", () => {
  assert.equal(isOpsOrigin("https://ops.lakesidegames.net"), true);
  assert.equal(isOpsOrigin("https://ops.example.org", ["ops.example.org"]), true);
  assert.equal(isOpsOrigin("https://ops.lakesidegames.net", ["ops.example.org"]), false);
  assert.equal(isOpsOrigin("http://ops.example.org", ["ops.example.org"]), false);
  assert.equal(isOpsOrigin(undefined), false);
});

test("submissions must be small JSON naming a supported credential", async () => {
  assert.equal((await readCredentialSubmission(request("{}", "text/plain"))).status, 415);
  assert.equal((await readCredentialSubmission(request("x".repeat(2000)))).status, 413);
  assert.equal((await readCredentialSubmission(request("not json"))).status, 400);
  assert.equal((await readCredentialSubmission(request(JSON.stringify({ destination: "nope", value: "x" })))).status, 400);
});

test("the Railway integration stays off without its configuration", () => {
  assert.equal(railwayConfig({}), null);
});
