"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createChunkContext, sanitizeLine } = require("./chunk-context");

function tempCache() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chunk-context-"));
  return { dir, cachePath: path.join(dir, "cache.db") };
}

test("annotate prepends a deterministic header plus the model line, and caches by content", async () => {
  const { dir, cachePath } = tempCache();
  let calls = 0;
  const ctx = createChunkContext({
    cachePath,
    llm: async ({ path: filePath }) => { calls++; return `Computes the bond yield used by ${filePath}.`; },
  });
  const items = [
    { source: "code", path: "src/lib/turn/bondTurn.ts", ord: 0, total: 2, text: "const YIELD = 0.04;", docText: "" },
    { source: "code", path: "src/lib/turn/bondTurn.ts", ord: 1, total: 2, text: "function payCoupons() {}", docText: "" },
  ];
  await ctx.annotate(items);
  assert.equal(calls, 2);
  assert.match(items[0].contextHeader, /^\[code\] src\/lib\/turn\/bondTurn\.ts \(part 1\/2\): Computes the bond yield/);

  // Same content again: served from cache, no new model calls.
  const again = [{ ...items[0], contextHeader: undefined }];
  await ctx.annotate(again);
  assert.equal(calls, 2);
  assert.equal(again[0].contextHeader, items[0].contextHeader);
  ctx.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a failed model call falls open to the deterministic header and is not cached", async () => {
  const { dir, cachePath } = tempCache();
  let calls = 0;
  const flaky = createChunkContext({
    cachePath,
    llm: async () => { calls++; if (calls === 1) throw new Error("model down"); return "Names the mechanic."; },
    log: () => {},
  });
  const item = { source: "wiki", path: "src/lib/seeds/wiki/content/elections.md", ord: 0, total: 1, text: "Elections run every 12 turns.", docText: "" };
  await flaky.annotate([item]);
  assert.equal(item.contextHeader, "[wiki] src/lib/seeds/wiki/content/elections.md (part 1/1)");
  // Retry on a later pass reaches the model again because failure was not cached.
  const retry = { ...item, contextHeader: undefined };
  await flaky.annotate([retry]);
  assert.match(retry.contextHeader, /Names the mechanic\.$/);
  flaky.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("sanitizeLine rejects garbage and trims wrappers", () => {
  assert.equal(sanitizeLine('  "Implements cloture voting thresholds for the Senate."  '), "Implements cloture voting thresholds for the Senate.");
  assert.equal(sanitizeLine("no"), "");
  assert.equal(sanitizeLine(""), "");
  assert.equal(sanitizeLine("x".repeat(400)), "");
});

test("a generation budget leaves over-budget chunks on deterministic headers", async () => {
  process.env.RAG_CONTEXT_MAX_GENERATE = "1";
  delete require.cache[require.resolve("./chunk-context")];
  const { createChunkContext: budgeted } = require("./chunk-context");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chunk-context-budget-"));
  let calls = 0;
  const ctx = budgeted({
    cachePath: path.join(dir, "cache.db"),
    llm: async () => { calls++; return "Names the mechanic."; },
  });
  const items = [
    { source: "code", path: "a.ts", ord: 0, total: 1, text: "alpha", docText: "" },
    { source: "code", path: "b.ts", ord: 0, total: 1, text: "beta", docText: "" },
  ];
  await ctx.annotate(items);
  assert.equal(calls, 1);
  assert.match(items[0].contextHeader, /Names the mechanic\.$/);
  assert.equal(items[1].contextHeader, "[code] b.ts (part 1/1)");
  ctx.close();
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.RAG_CONTEXT_MAX_GENERATE;
  delete require.cache[require.resolve("./chunk-context")];
});
