import test from "node:test";
import assert from "node:assert/strict";
import { summarizeUsage, formatTokens, formatCost, projectStatuses, compareVersions, newerRelease, doctorChecks } from "./tui/insights.mjs";

test("session usage sums assistant messages and reports the last model", () => {
  const usage = summarizeUsage([
    { role: "user" },
    { role: "assistant", cost: 0.01, modelID: "a", providerID: "p", tokens: { input: 1000, output: 200, reasoning: 50, cache: { read: 300, write: 10 } } },
    { role: "assistant", cost: 0.02, modelID: "b", providerID: "q", tokens: { input: 500, output: 100, reasoning: 0, cache: { read: 0, write: 0 } } },
  ]);
  assert.deepEqual(usage, { cost: 0.03, input: 1500, output: 300, reasoning: 50, cacheRead: 300, cacheWrite: 10, turns: 2, model: "b", provider: "q" });
  assert.equal(summarizeUsage(undefined).turns, 0);
});

test("token and cost labels stay short and honest about subscriptions", () => {
  assert.equal(formatTokens(999), "999");
  assert.equal(formatTokens(1234), "1.2k");
  assert.equal(formatTokens(25000), "25k");
  assert.equal(formatTokens(2500000), "2.5M");
  assert.equal(formatCost(0), "no metered cost");
  assert.equal(formatCost(0.004), "<$0.01");
  assert.equal(formatCost(1.234), "$1.23");
});

test("project status reads branch and changes, and survives a broken checkout", () => {
  const exec = (_cmd, args) => {
    if (args[1] === "/broken") throw new Error("not a repo");
    if (args.includes("--is-inside-work-tree")) return "true\n";
    if (args.includes("symbolic-ref")) { if (args[1] === "/detached") throw new Error("detached"); return "main\n"; }
    if (args.includes("--short")) return "abc1234\n";
    return " M a.js\n?? b.js\n";
  };
  assert.deepEqual(projectStatuses({ web: "/w", api: "/broken", tool: "/detached" }, { exec }), [
    { name: "api", directory: "/broken", branch: "", changes: 0, ok: false },
    { name: "tool", directory: "/detached", branch: "@abc1234", changes: 2, ok: true },
    { name: "web", directory: "/w", branch: "main", changes: 2, ok: true },
  ]);
});

test("versions order previews below their stable release", () => {
  assert.ok(compareVersions("0.1.4-preview.2", "0.1.4-preview.1") > 0);
  assert.ok(compareVersions("code-v0.1.4", "0.1.4-preview.9") > 0);
  assert.ok(compareVersions("0.1.5-preview.1", "0.1.4") > 0);
  assert.equal(compareVersions("0.1.4", "code-v0.1.4"), 0);
});

test("an update is offered only when a newer release exists on the channel", () => {
  const rows = [
    { tag_name: "code-v0.1.4-preview.2", prerelease: true },
    { tag_name: "code-v0.1.4-preview.1", prerelease: true },
    { tag_name: "keir-v5.8.5", prerelease: false },
    { tag_name: "code-v9.0.0", draft: true },
  ];
  assert.equal(newerRelease("0.1.4-preview.1", rows, "preview"), "code-v0.1.4-preview.2");
  assert.equal(newerRelease("0.1.4-preview.2", rows, "preview"), null);
  assert.equal(newerRelease("0.1.3", rows, "stable"), null);
});

test("doctor says what is wrong and what to do", () => {
  const rows = doctorChecks({ providers: [], mcp: [{ name: "support", status: "failed", error: "401" }, { name: "kb", status: "connected" }],
    vps: { origin: "https://ops.example" }, peers: [{ id: "keir", state: "offline", error: "Session expired" }], engine: "1.19.0", version: "0.1.4", update: "code-v0.1.5" });
  const by = Object.fromEntries(rows.map(r => [r.label, r]));
  assert.equal(by.Providers.level, "error"); assert.match(by.Providers.detail, /\/connect/);
  assert.equal(by["MCP servers"].level, "warn"); assert.match(by["MCP servers"].detail, /support \(401\)/);
  assert.equal(by.VPS.level, "warn"); assert.match(by.VPS.detail, /Session expired/);
  assert.equal(by.Updates.level, "warn"); assert.match(by.Updates.detail, /lakeside code update/);
  const healthy = doctorChecks({ providers: [{ id: "anthropic" }], mcp: [], vps: null, peers: [], engine: "1.19.0", version: "0.1.4", update: null });
  assert.deepEqual(healthy.map(r => r.level), ["ok", "info", "info", "ok", "ok"]);
});
