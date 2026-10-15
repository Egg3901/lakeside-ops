#!/usr/bin/env node
"use strict";
// Offline browser regression: repeat polling without remounting the page.
// PLAYWRIGHT_MODULE may point at an existing installation outside this repo.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { makeKeirHubBody } = require("../keir-hub-page");
const { renderShell } = require("../ops-shell");
const { activityByHour, jevAnalytics, buildStream } = require("../keir-hub-data");
const { buildWatchState } = require("../keir-watch-data");
const { buildThroughput } = require("../keir-throughput-data");
const now = Date.now();
const job = { id: "task1", kind: "ticket", ticket: 1553, state: "waiting", summary: "A coding worker is preparing the fix.", runner: "codex", updatedAt: now - 300000, startedAt: now - 600000, decisions: [], history: [], rounds: 2 };
const state = { at: now, release: { sha: "preview000000", version: "source preview" }, lanes: ["worker"], routing: { worker: "codex" }, paused: false,
  kpis: { live: 1, running: 0, waiting: 1, queued: 0, blocked: 0, decisionsPending: 0, openTickets: 1, prsOpen: 0, prsRed: 0, activations24h: 2, successRate24h: 1, medianActivationMs: 60000, p90ActivationMs: 60000 },
  activity: activityByHour([{ atMs: now - 60000, provider: "codex", durationMs: 60000, outcome: "ok" }], now), workers: [job], recent: [], decisions: [], tickets: [], prs: [], issues: [], kanban: [], attempts: [],
  stream: { lanes: [], feed: [] }, live: [], incidents: [], quality: { labels: { open: 2 }, time_to_closure: {}, decision_latency: {}, closed: 0, tickets: 2, decisions_unanswered: 0 },
  jev: jevAnalytics([{ kind: "intake_tagged", at: now, tags: { kind: "bug_report", mood: "calm" } }], now), shadow: null, sources: {},
  watch: buildWatchState({ watch: { mode: "report", findings: { one: { fp: "one", title: "A monitoring finding", state: "observed", evidence: "Recorded evidence" } } } }, { now }),
};
const throughputLedger = { jobs: {
  task1: { ...job, at: now - 3600000 }, task2: { id: "task2", kind: "ticket", ticket: 1552, state: "waiting", at: now - 7200000, updatedAt: now - 2400000, ciWatch: { 4150: { since: now - 2400000 } } },
  task3: { id: "task3", kind: "ticket", ticket: 1545, state: "waiting", updatedAt: now - 1800000 }, task4: { id: "task4", kind: "ticket", ticket: 1522, state: "waiting", updatedAt: now - 600000 },
  coding: { id: "coding", kind: "coding", codingParent: "task1", state: "running", startedAt: now - 60000, investigation: false },
  queued: { id: "queued", kind: "coding", codingParent: "task1", state: "queued", at: now - 300000, updatedAt: now - 300000 },
}, decisions: { ask: { jobId: "task3", state: "pending", at: now - 1800000 } } };
const throughputUsage = [
  { job: "coding", at: now - 60000, durationMs: 300000, outcome: "error_max_turns" }, { job: "coding", at: now - 400000, durationMs: 300000, outcome: "error_max_turns" },
  { job: "task2", at: now - 800000, durationMs: 240000, outcome: "ok" },
];
state.throughput = buildThroughput(throughputLedger, throughputUsage, { now, supportTickets: [{ number: 1522, status: "resolved" }, { number: 1553, status: "in_progress" }] });
state.workers = Object.values(throughputLedger.jobs).map((j) => ({ ...j, summary: j.codingParent ? "Inspecting the isolated patch and focused checks." : "Following the recorded dependency and release gates.", coder: Boolean(j.codingParent), ticket: j.ticket || throughputLedger.jobs[j.codingParent]?.ticket || null, runner: "codex", model: "gpt-6.1-sol", decisions: j.id === "task3" ? [{ id: "ask" }] : [], history: [], rounds: 2, pullRequests: [] }));
state.decisions = [{ id: "ask", job: "task3", ticket: 1545, at: now - 1800000, tldr: "Review the prepared change before it moves to the live server." }];
state.kpis = { ...state.kpis, live: state.workers.length, running: 1, waiting: 4, queued: 1, decisionsPending: 1, openTickets: 3 };
state.tickets = [1553, 1552, 1545, 1522].map((n, i) => ({ number: n, title: ["Confirming a trading correction", "Waiting for release checks", "Prepared change needs review", "Resolved report under observation"][i], status: i === 3 ? "resolved" : "in_progress", category: "bug", prs: [], active: { id: "task" + (i + 1), state: "waiting" }, card: { items: [{ name: "Correction", stage: ["written", "tested", "sandbox", "confirmed"][i] }] }, decisionPending: i === 2, lastKeirAt: now - 60000, createdAt: now - 7200000, attempts: 2, kanban: [] }));
throughputLedger.audit = [{ kind: "coding_delegated", job: "task1", child: "coding", at: now - 300000 }, { kind: "ci_watch_done", job: "task2", number: 4150, at: now - 150000 }, { kind: "decision_opened", job: "task3", at: now - 120000 }];
state.stream = buildStream(throughputLedger, throughputUsage.map((u) => ({ ...u, atMs: u.at, provider: "codex", kind: "coding", turns: 6 })), now);
const output = process.argv[2];
(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, reducedMotion: "reduce" });
    const errors = []; page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      const timeout = window.setTimeout;
      window.setTimeout = (fn, ms, ...args) => {
        if (ms === 2000 || ms === 3000 || ms === 8000) { window.__keirPoll = fn; return timeout(() => {}, 3600000); }
        return timeout(fn, ms, ...args);
      };
    });
    let requests = 0, failed = false, delay = 0;
    const { extraCss, body } = makeKeirHubBody();
    const html = renderShell({ title: "Keir hub", active: "/keir", role: "admin", extraCss, body });
    await page.route("http://keir.test/**", async (route) => {
      if (route.request().url().includes("/api/keir/hub")) {
        requests++; if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        return route.fulfill({ status: failed ? 503 : 200, contentType: "application/json", body: JSON.stringify(state) });
      }
      return route.fulfill({ contentType: "text/html", body: html });
    });
    await page.route("https://**", (route) => route.abort());
    await page.goto("http://keir.test/keir");
    await page.waitForFunction(() => window.__keirPoll && document.querySelector("#kh-chart svg"));
    await page.locator("#kh-diagnostics").evaluate((n) => { n.open = true; });
    await page.locator(".kw-finding").first().evaluate((n) => { n.open = true; });
    await page.getByRole("searchbox", { name: "Search monitoring findings" }).fill("monitoring");
    await page.locator("#kh-jev").scrollIntoViewIfNeeded();
    await page.evaluate(() => {
      window.__nodes = { quality: document.querySelector("#kh-quality .kh-mstat"), bars: document.querySelector("#kh-jev .kh-hbar i"), chart: document.querySelector("#kh-chart svg"), worker: document.querySelector("#kh-workers .kh-row"), finding: document.querySelector(".kw-finding") };
      window.__scroll = scrollY;
    });
    const poll = async () => { const before = requests; await page.evaluate(() => window.__keirPoll()); await page.waitForFunction((n) => document.querySelector("#kh-upd") && !document.querySelector("#kh-src").textContent.includes("Refresh failed"), before); await page.waitForTimeout(100); assert.ok(requests > before); };
    await poll();
    const stable = await page.evaluate(() => Object.fromEntries(Object.entries(window.__nodes).map(([name, node]) => [name, node.isConnected])));
    assert.deepEqual(stable, { quality: true, bars: true, chart: true, worker: true, finding: true }, "unchanged polling must preserve card, chart and finding nodes");
    assert.equal(await page.locator(".kw-finding").first().evaluate((n) => n.open), true);
    assert.equal(await page.getByRole("searchbox", { name: "Search monitoring findings" }).inputValue(), "monitoring");
    assert.ok(await page.evaluate(() => Math.abs(scrollY - window.__scroll) < 2), "refresh preserves scroll");
    failed = true; await page.evaluate(() => window.__keirPoll()); await page.waitForTimeout(100);
    assert.equal(await page.locator("#kh-chart svg").count(), 1, "last good data survives failed refresh");
    failed = false; delay = 100; const before = requests;
    await page.evaluate(() => { window.__keirPoll(); window.__keirPoll(); window.__keirPoll(); }); await page.waitForTimeout(250);
    assert.equal(requests - before, 1, "overlapping refresh requests are coalesced");
    const originalSummary = state.workers[0].summary;
    state.workers[0].summary = '<img src=x onerror="window.keirInjected=true">'; await poll();
    assert.equal(await page.locator("#kh-workers img").count(), 0, "shared trusted template helper receives escaped task text");
    assert.equal(await page.evaluate(() => window.keirInjected), undefined);
    state.workers[0].summary = originalSummary; await poll();
    assert.deepEqual(errors, []);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.waitForTimeout(1100); await poll();
    assert.equal(await page.locator("#kh-jev .kh-hbar i").first().evaluate((n) => n.getAnimations().filter((a) => a.playState === "running").length), 0, "unchanged polling does not restart bar growth animations");
    assert.equal(await page.locator('.kt-lane[data-active="true"]').count(), 1, "only the observed execution lane animates");
    await page.locator('.kt-lane[data-stage="ci"] .kt-ticket').click(); assert.match(await page.locator(".kt-inspector").innerText(), /Waiting for checks/);
    await page.locator('.kt-lane[data-stage="coding"] .kt-ticket').click(); assert.match(await page.locator(".kt-inspector").innerText(), /repeated budget exhaustion/);
    assert.equal(await page.locator(".kt-ticket").count(), 4);
    assert.equal(await page.locator(".kt-metric").count(), 0, "primary view is task nodes, not KPI tiles");
    await page.emulateMedia({ reducedMotion: "reduce" });
    if (output) {
      fs.mkdirSync(output, { recursive: true });
      await page.locator("#kh-diagnostics").evaluate((n) => { n.open = false; });
      await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: path.join(output, "keir-desktop.png"), fullPage: true });
      await page.evaluate(() => document.documentElement.dataset.theme = "dark");
      await page.screenshot({ path: path.join(output, "keir-desktop-dark.png"), fullPage: true });
      await page.screenshot({ path: path.join(output, "keir-desktop-dark-fold.png"), fullPage: false });
      await page.setViewportSize({ width: 390, height: 900 }); await page.screenshot({ path: path.join(output, "keir-mobile.png"), fullPage: true });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "mobile layout has no horizontal overflow");
    }
    console.log(JSON.stringify({ passed: true, checks: ["unchanged DOM stable", "filter and expansion retained", "scroll preserved", "last good data", "coalesced refresh", "no page errors", "desktop and mobile layout"] }));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
