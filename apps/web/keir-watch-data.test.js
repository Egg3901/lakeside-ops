"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { buildWatchState, SENSOR_DEFS } = require("./keir-watch-data");
const NOW = Date.parse("2026-10-14T15:00:00Z"), HOUR = 3600000;
function ledger() {
  return { watch: { mode: "active", findings: {}, ran: Object.fromEntries(SENSOR_DEFS.map((s) => [s.id, NOW - 1000])), succeeded: Object.fromEntries(SENSOR_DEFS.map((s) => [s.id, NOW - 1000])), spawned: [], score: {} }, jobs: {}, actions: {}, audit: [] };
}
const sensor = (s, name) => s.sensors.find((x) => x.id === name);

test("missing, legacy, disabled and report states never invent successful checks", () => {
  const absent = buildWatchState({}, { now: NOW });
  assert.equal(absent.status, "unavailable"); assert.equal(absent.available, false); assert.equal(absent.score.share, null);
  const legacy = buildWatchState({ watch: { ran: { turns: NOW - 1000 } } }, { now: NOW });
  assert.equal(legacy.status, "not-started");
  assert.equal(sensor(legacy, "turns").lastAttemptAt, NOW - 1000);
  assert.equal(sensor(legacy, "turns").lastSuccessAt, null);
  const off = buildWatchState({}, { mode: "off", now: NOW });
  assert.equal(off.status, "off"); assert.ok(off.sensors.every((s) => s.status === "off"));
  const report = buildWatchState(ledger(), { now: NOW, mode: "report" });
  assert.equal(report.status, "report"); assert.ok(report.sensors.every((s) => s.status === "report"));
  assert.equal(buildWatchState({ ...ledger(), paused: true }, { now: NOW }).status, "off");
});

test("sensor health distinguishes stale, failed, recovered and unavailable checks", () => {
  const d = ledger();
  d.watch.succeeded.turns = NOW - HOUR;
  d.watch.errors = { heal: { at: NOW, error: "Read failed token=credential" } };
  d.watch.invariantsUnavailable = NOW;
  const s = buildWatchState(d, { now: NOW, sentryConfigured: false });
  assert.equal(s.status, "error");
  assert.equal(sensor(s, "turns").status, "stale");
  assert.equal(sensor(s, "heal").status, "error");
  assert.doesNotMatch(sensor(s, "heal").error, /credential/);
  assert.equal(sensor(s, "invariants").status, "unavailable");
  assert.equal(sensor(s, "sentry").status, "unavailable");
  d.watch.succeeded.heal = NOW + 1;
  assert.equal(sensor(buildWatchState(d, { now: NOW + 1 }), "heal").status, "active");
  const overnight = ledger();
  overnight.watch.succeeded.economy = overnight.watch.succeeded.invariants = NOW - 8 * HOUR;
  assert.equal(sensor(buildWatchState(overnight, { now: NOW }), "economy").status, "active", "quiet turns do not imply stale economy checks");
  overnight.watch.succeeded.invariants = NOW;
  assert.equal(sensor(buildWatchState(overnight, { now: NOW }), "economy").status, "stale");
});

test("findings are bounded, severity ordered and linked to their own work only", () => {
  const d = ledger();
  d.watch.findings = {
    soft: { title: "Soft", state: "observed", lastSeen: NOW, fp: "soft" },
    resolved: { title: "Resolved severe", severe: true, state: "resolved", lastSeen: NOW, fp: "resolved" },
    severe: { title: "Severe", severe: true, hard: true, state: "raised", lastSeen: NOW - 1000, fp: "severe", issue: 55, item: 12, jobId: "j1", evidence: "x".repeat(3000) },
    hard: { title: "Hard", hard: true, state: "observed", lastSeen: NOW, fp: "hard" },
  };
  d.jobs.j1 = { id: "j1", state: "waiting", summary: "Draft prepared", pullRequests: ["https://github.com/Egg3901/AHDGame/pull/7", "javascript:alert(1)", "https://github.com/Egg3901/AHDGame/pull/7"] };
  const s = buildWatchState(d, { now: NOW, findingLimit: 2 });
  assert.deepEqual(s.findings.map((f) => f.fp), ["severe", "hard"]);
  assert.equal(s.hiddenFindings, 2); assert.equal(s.openFindings, 3);
  const f = s.findings[0]; assert.equal(f.evidence.length, 1800);
  assert.equal(f.issue.url, "https://github.com/Egg3901/AHDGame/issues/55");
  assert.deepEqual(f.kanban, { id: 12, url: "/kanban" });
  assert.equal(f.job.state, "waiting"); assert.equal(f.pullRequests.length, 1);
  assert.equal(s.findings[1].job, null);
});

test("budgets count rolling windows and score counts confirmed later reports", () => {
  const d = ledger();
  d.watch.spawned = [NOW - 100, NOW - HOUR + 1, NOW - HOUR, NOW - 23 * HOUR, NOW - 24 * HOUR, NOW + 1];
  d.watch.findings.x = { state: "observed", deferredAt: NOW };
  d.watch.score = { caughtFirst: 2, playerFirst: 1 };
  const s = buildWatchState(d, { now: NOW });
  assert.deepEqual(s.budget, { perHour: 3, perDay: 8, hourUsed: 2, dayUsed: 4, hourRemaining: 1, dayRemaining: 4, deferred: 1 });
  assert.equal(s.score.share, 67); assert.match(s.score.label, /confirmed later/);
});

test("prepared repair metadata and diagnostics exclude executable details and credentials", () => {
  const d = ledger();
  d.jobs.j1 = { id: "j1", kind: "finding", state: "done" };
  d.watch.findings.x = { jobId: "j1", title: "Connection mongodb://user:pw@db/private", evidence: "Bearer secretbearer ghp_secretsecret sk-privateprivate api_key=hidden {\"SENTRY_API_TOKEN\":\"jsonsecret\"}" };
  d.actions.a1 = { id: "a1", kind: "heal", state: "prepared", jobId: "j1", at: NOW, token: "toksecret", args: { affected: 5, spec: { kind: "adhoc", env: "prod", filter: { owner: "private" }, action: { liquidCapital: 999 }, description: "password=private" }, plan: "privateplan", planDigest: "digest" } };
  d.actions.a2 = { id: "a2", kind: "heal", state: "approved", jobId: "j1" };
  d.audit = [{ kind: "activation_skills", at: NOW, lane: "worker", skills: ["ponytail"], skillChars: 200, degraded: false, credentials: "privatetoken" }, { kind: "skills_unavailable", at: NOW - 1, errors: [{ token: "sensitive" }] }, { kind: "ticket_authority_carried", at: NOW - 2 }, { kind: "issue_closed_fixed", at: NOW - 25 * HOUR }];
  const s = buildWatchState(d, { now: NOW });
  assert.equal(s.repairs.length, 1); assert.equal(s.repairs[0].executable, false); assert.equal(s.repairs[0].affected, 5);
  assert.equal(s.findings[0].repairs[0].id, "a1");
  const text = JSON.stringify(s);
  assert.doesNotMatch(text, /jsonsecret|secretbearer|secretsecret|privateprivate|\bhidden\b|user:pw|privateplan|liquidCapital|privatetoken|sensitive|toksecret|planDigest|"filter"/);
  assert.equal(s.capabilities.skillFailures, 1); assert.equal(s.capabilities.authorityCarried, 1); assert.equal(s.capabilities.issuesClosedLive, 0);
  assert.equal(s.capabilities.skills.chars, 200); assert.equal(s.recent.length, 3 + 1);
});
