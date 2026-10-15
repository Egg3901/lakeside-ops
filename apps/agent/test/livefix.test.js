"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { verifyLiveFix } = require("../lib/operator/livefix");
const { displayOnlyDiff } = require("../lib/operator/blastradius");

function fixture({ worker = false, fileError = false, laterWorker = false, deployment = "success", health = "SUCCESS", workerStatus = "success" } = {}) {
  const calls = [];
  const api = async ([route]) => {
    calls.push(route);
    if (/pulls\/7$/.test(route)) return { merged: true, merge_commit_sha: "abc1234" };
    if (/\/files\?/.test(route)) {
      if (fileError) throw new Error("GitHub offline");
      const page = Number(new URL(`https://example.com/${route}`).searchParams.get("page"));
      if (laterWorker && page === 1) return Array.from({ length: 100 }, () => ({ filename: "src/components/Test.tsx" }));
      return [{ filename: worker || laterWorker ? "scripts/turn-worker.ts" : "src/components/Test.tsx" }];
    }
    if (/\/status$/.test(route)) return { sha: "deployed123", statuses: [
      { context: "A House Divided - AHD Production", state: deployment },
      { context: "A House Divided - AHD Turn Worker", state: workerStatus },
    ] };
    if (/compare\//.test(route)) return { status: "behind" };
    throw new Error(`unexpected ${route}`);
  };
  const mcp = { call: async () => ({ services: [{ service: "AHD Production", status: health }, { service: "AHD Turn Worker", status: "SUCCESS" }] }) };
  return { calls, run: () => verifyLiveFix({ api, mcp, number: 7 }) };
}

test("closure needs a successful deployment of an exact containing commit", async () => {
  assert.equal((await fixture().run()).live, true);
  assert.equal((await fixture({ deployment: "pending" }).run()).live, false);
  assert.equal((await fixture({ health: "BUILDING" }).run()).live, false);
  assert.equal((await fixture({ fileError: true }).run()).live, false);
});

test("worker files after the first page require the worker deployment", async () => {
  const f = fixture({ laterWorker: true, workerStatus: "pending" });
  assert.equal((await f.run()).live, false);
  assert.ok(f.calls.some((r) => r.includes("page=2")));
  assert.ok(f.calls.some((r) => r.includes("turn-worker%2Fproduction/status")));
  assert.equal((await fixture({ worker: true }).run()).live, true);
});

const row = (filename, before, after) => ({ filename, status: "modified", additions: 1, deletions: 1, patch: `@@ -1 +1 @@\n-${before}\n+${after}` });
test("unattended display changes reject transaction logic, service workers, renames and missing diffs", () => {
  assert.equal(displayOnlyDiff([row("src/components/Price.tsx", "  <p>Loading</p>", "  <p>Price unavailable</p>")]).allowed, true);
  assert.equal(displayOnlyDiff([row("src/app/page.tsx", "const amount = Number(input);", "const amount = Number(input) * 100;")]).allowed, false);
  assert.equal(displayOnlyDiff([row("src/components/Trade.tsx", "  <button disabled>Buy</button>", "  <button>Buy</button>")]).allowed, false);
  assert.equal(displayOnlyDiff([row("public/service-worker.js", "fetch('/api');", "fetch('https://outside.test');")]).allowed, false);
  assert.equal(displayOnlyDiff([{ filename: "src/app/page.tsx" }]).allowed, false);
  assert.equal(displayOnlyDiff([{ ...row("src/app/page.tsx", "<p>A</p>", "<p>B</p>"), previous_filename: "src/lib/money.ts" }]).allowed, false);
  assert.equal(displayOnlyDiff([row("src/app/globals.css", "p { color: red; }", "p { color: blue; }")]).allowed, true);
});
