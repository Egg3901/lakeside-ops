#!/usr/bin/env node
"use strict";
// One scorecard per model (and per model x effort) from three sources:
//   live    /var/lib/keir-operator/usage.jsonl          every real activation
//   bench   /var/lib/keir-operator/bench/results.jsonl  graded benchmark answers
//   review  /var/lib/keir-operator/bench/reviews.jsonl  shadow reviewer marks
// Review line: {"at","job","model","effort","accuracy":0-1,"tone":0-1,"compliance":0-1,"note"}
// Usage: keir-scores.js [sinceISO]   (default: since the A/B trial began)
const fs = require("node:fs");
const since = Date.parse(process.argv[2] || "2026-10-12T17:20:00Z");
const read = (f) => { try { return fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((r) => r && Date.parse(r.at) >= since); } catch { return []; } };
const live = read("/var/lib/keir-operator/usage.jsonl").filter((u) => u.event === "activation");
const bench = read("/var/lib/keir-operator/bench/results.jsonl");
const reviews = read("/var/lib/keir-operator/bench/reviews.jsonl");
const benchJobs = new Set(bench.map((b) => b.task));
const avg = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const med = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const f = (x, d = 2) => x === null ? "-" : Number(x).toFixed(d);
const models = [...new Set([...live, ...bench, ...reviews].map((r) => r.model).filter(Boolean))].sort();

console.log(`KEIR MODEL SCORECARD since ${new Date(since).toISOString()}\n`);
console.log("model                          live n  ok%   limits  p50s  bench n  bench   review n  acc   tone  rules");
for (const m of models) {
  const L = live.filter((u) => u.model === m && !benchJobs.has(u.job)), B = bench.filter((b) => b.model === m), R = reviews.filter((r) => r.model === m);
  // A turn limit means the task continues next activation; only errors and timeouts fail.
  const ok = L.length ? 100 * L.filter((u) => u.outcome === "ok" || u.outcome === "error_max_turns").length / L.length : null;
  const limits = L.filter((u) => u.outcome === "error_max_turns").length;
  console.log(`${m.padEnd(30)} ${String(L.length).padStart(6)}  ${f(ok, 0).padStart(4)}  ${String(limits).padStart(6)}  ${f(med(L.map((u) => u.durationMs / 1000)), 0).padStart(4)}  ${String(B.length).padStart(7)}  ${f(avg(B.map((b) => b.score))).padStart(5)}  ${String(R.length).padStart(8)}  ${f(avg(R.map((r) => r.accuracy)))}  ${f(avg(R.map((r) => r.tone)))}  ${f(avg(R.map((r) => r.compliance)))}`);
}
console.log("\nLIVE BY MODEL x EFFORT (n, ok%, median s)");
for (const m of models) for (const e of ["low", "medium", "high", "xhigh", null]) {
  const L = live.filter((u) => u.model === m && (u.effort || null) === e && !benchJobs.has(u.job));
  if (L.length) console.log(`  ${m.padEnd(30)} ${String(e || "unset").padEnd(7)} ${String(L.length).padStart(3)}  ${f(100 * L.filter((u) => u.outcome === "ok").length / L.length, 0).padStart(3)}%  ${f(med(L.map((u) => u.durationMs / 1000)), 0)}s`);
}
if (bench.length) {
  console.log("\nBENCH BY ITEM (mean score; median model seconds)");
  const items = [...new Set(bench.map((b) => b.item))];
  console.log("  " + "model".padEnd(30) + items.map((i) => i.slice(0, 14).padEnd(15)).join(""));
  for (const m of models) {
    const B = bench.filter((b) => b.model === m); if (!B.length) continue;
    console.log("  " + m.padEnd(30) + items.map((i) => { const x = B.filter((b) => b.item === i); return (x.length ? `${f(avg(x.map((b) => b.score)))}/${f(med(x.map((b) => (b.modelMs || 0) / 1000)), 0)}s` : "-").padEnd(15); }).join(""));
  }
}
if (reviews.length) {
  console.log("\nREVIEW NOTES (latest 12)");
  for (const r of reviews.slice(-12)) console.log(`  ${r.at.slice(11, 16)} ${String(r.model).padEnd(28)} ${String(r.effort || "-").padEnd(6)} acc ${r.accuracy} tone ${r.tone} rules ${r.compliance} | ${r.note || ""}`);
}
