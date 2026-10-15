"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  inferContextNeeds,
  hasGameIdentity,
  hasCorporationLink,
  hasPageLink,
  parseJevNeeds,
  parseJevAnswers,
  contextRequestForDisplay,
} = require("./ticket-context");

test("infers missing account, corporation, and page context from a report", () => {
  const ticket = {
    title: "The market page is broken",
    description: "My corporation's market page does not match consumption.",
    reporter: { corporationName: "Example Corp" },
  };
  assert.equal(hasGameIdentity(ticket), false);
  assert.equal(hasCorporationLink(ticket), false);
  assert.equal(hasPageLink(ticket), false);
  assert.deepEqual(inferContextNeeds(ticket), ["discord", "corporation", "page"]);
});

test("does not request links already present on the report", () => {
  const ticket = {
    title: "Market page mismatch",
    description: "The market page does not match consumption.",
    userId: "game-user-1",
    pageUrl: "https://www.ahousedividedgame.com/market",
    reporter: {
      corporationUrl: "https://www.ahousedividedgame.com/corporation/3",
    },
  };
  assert.deepEqual(inferContextNeeds(ticket), []);
});

test("accepts Jev's compact JSON decision and clamps it to candidates", () => {
  assert.deepEqual(parseJevNeeds('{"needed":["discord","page","not-a-request"]}', ["discord", "page"]), ["discord", "page"]);
  assert.deepEqual(parseJevNeeds('{"corporation":true,"page":false}', ["corporation", "page"]), ["corporation"]);
});

test("reads Jev Decisions API noul probabilities", () => {
  assert.deepEqual(
    parseJevAnswers({ discord: { type: "noul", noul: 0.91 }, page: { type: "noul", noul: 0.2 } }, ["discord", "page"]),
    ["discord"],
  );
});

test("receipt fallback is safe before the persisted Jev decision exists", () => {
  const request = contextRequestForDisplay({ title: "Cannot open page", description: "The page is blank." });
  assert.deepEqual(request.needed, ["discord", "page"]);
  assert.equal(request.generatedBy, "receipt-fallback");
});

test("a fix milestone removes the stale context banner from the receipt", () => {
  assert.equal(contextRequestForDisplay({
    contextRequest: { needed: ["page"] },
    publicUpdates: [{ kind: "development" }],
  }), null);
});
