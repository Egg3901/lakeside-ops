"use strict";

// Read-only projection of the operator ledger. Never return action args,
// approval material, environment values or repair execution payloads.
const HOUR = 3600000;
const SENSOR_DEFS = [
  { id: "turns", label: "Turn failures and warnings", cadenceMs: 5 * 60000, perTurn: false },
  { id: "economy", label: "Economy numbers", cadenceMs: null, perTurn: true },
  { id: "invariants", label: "Game invariants", cadenceMs: null, perTurn: true },
  { id: "heal", label: "Structural repair detectors", cadenceMs: 3 * HOUR, perTurn: false },
  { id: "sentry", label: "Production errors", cadenceMs: HOUR / 2, perTurn: false },
  { id: "pages", label: "Public pages", cadenceMs: 2 * HOUR, perTurn: false },
];
const stamp = (v) => { const n = typeof v === "number" ? v : Date.parse(v); return Number.isFinite(n) && n > 0 ? n : null; };
const count = (n) => Number.isFinite(Number(n)) ? Math.max(0, Math.floor(Number(n))) : 0;
function short(value, max = 400) {
  return String(value ?? "").slice(0, 10000)
    .replace(/\b(?:Bearer\s+)[\w.+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(?:ahdk_|gh[pousr]_|github_pat_|sk-)[\w-]+/g, "[redacted]")
    .replace(/\b[\w.-]*(?:token|password|secret|api[_-]?key|authorization)["']?\s*[:=]\s*["']?[^\s,"';}]+/gi, "[redacted]")
    .replace(/\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|redis):\/\/[^\s]+/gi, "[redacted connection]")
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[redacted]@")
    .slice(0, max);
}
const number = (v) => Number.isSafeInteger(Number(v)) && Number(v) > 0 ? Number(v) : null;
const prUrls = (urls) => [...new Set((Array.isArray(urls) ? urls : []).filter((url) => typeof url === "string" && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(url)))].slice(0, 12);

function buildWatchState(d, { now = Date.now(), mode = null, ledgerAvailable = true, sentryConfigured = null, findingLimit = 60 } = {}) {
  d = d && typeof d === "object" ? d : {};
  const w = d.watch && typeof d.watch === "object" ? d.watch : null;
  const available = ledgerAvailable && Boolean(w);
  const effectiveMode = ["off", "report", "active"].includes(mode) ? mode : ["report", "active"].includes(w?.mode) ? w.mode : "unknown";
  const paused = Boolean(d.paused), disabled = effectiveMode === "off" || paused;
  const audit = (Array.isArray(d.audit) ? d.audit : []).filter((a) => a && stamp(a.at)).sort((a, b) => stamp(b.at) - stamp(a.at));
  const sensors = SENSOR_DEFS.map((def) => {
    const lastAttemptAt = stamp(w?.ran?.[def.id]), lastSuccessAt = stamp(w?.succeeded?.[def.id]);
    const failure = w?.errors?.[def.id];
    const auditFailure = audit.find((a) => a.kind === "watch_sensor_failed" && a.sensor === def.id);
    const errorAt = stamp(failure?.at) || stamp(auditFailure?.at);
    const error = errorAt && errorAt >= (lastSuccessAt || 0) ? short(failure?.error || auditFailure?.error, 220) : null;
    const unavailableAt = def.id === "invariants" ? stamp(w?.invariantsUnavailable) : null;
    let status;
    if (disabled) status = "off";
    else if (!available || (def.id === "sentry" && sentryConfigured === false) || (unavailableAt && unavailableAt >= (lastSuccessAt || 0))) status = "unavailable";
    else if (error) status = "error";
    else if (!lastSuccessAt) status = "not-started";
    // Turn-triggered checks can stay quiet overnight. A newer turn check alone
    // does not prove a new turn ran; use the other turn-triggered success.
    else if (def.perTurn ? Math.max(stamp(w?.succeeded?.economy) || 0, stamp(w?.succeeded?.invariants) || 0) - lastSuccessAt > 5 * 60000 : now - lastSuccessAt > def.cadenceMs + 5 * 60000) status = "stale";
    else status = effectiveMode === "report" ? "report" : "active";
    return { ...def, status, lastAttemptAt, lastSuccessAt, error, errorAt: error ? errorAt : null, unavailableAt };
  });
  const actions = Object.values(d.actions || {}).filter((a) => a && a.kind === "heal" && a.state === "prepared" && d.jobs?.[a.jobId]?.kind === "finding");
  const repairs = actions.sort((a, b) => (stamp(b.at) || 0) - (stamp(a.at) || 0)).slice(0, 40).map((a) => ({
    id: short(a.id, 100), jobId: short(a.jobId, 100), state: "prepared", executable: false, at: stamp(a.at),
    kind: ["ledger", "adhoc", "compensation"].includes(a.args?.spec?.kind) ? a.args.spec.kind : null,
    environment: ["prod", "sandbox", "dev"].includes(a.args?.spec?.env) ? a.args.spec.env : null,
    affected: Number.isFinite(a.args?.affected) ? Math.max(0, a.args.affected) : null,
  }));
  const allFindings = Object.entries(w?.findings || {}).filter(([, f]) => f && typeof f === "object").map(([key, f]) => {
    const j = d.jobs?.[f.jobId], issueNumber = number(f.issue), item = number(f.item);
    return { fp: short(f.fp || key, 240), title: short(f.title, 240), sensor: short(f.sensor, 40), state: short(f.state || "observed", 40), hard: Boolean(f.hard), severe: Boolean(f.severe),
      evidence: short(f.evidence, 1800), firstSeen: stamp(f.firstSeen), lastSeen: stamp(f.lastSeen), raisedAt: stamp(f.raisedAt), resolvedAt: stamp(f.resolvedAt),
      deferredAt: stamp(f.deferredAt), seen: count(f.seen), playerConfirmedAt: stamp(f.playerConfirmed),
      job: j ? { id: short(j.id || f.jobId, 100), state: short(j.state, 40), summary: short(j.summary, 500) } : null,
      issue: issueNumber ? { number: issueNumber, url: `https://github.com/Egg3901/AHDGame/issues/${issueNumber}` } : null,
      kanban: item ? { id: item, url: "/kanban" } : null, pullRequests: prUrls(j?.pullRequests), repairs: repairs.filter((a) => a.jobId === f.jobId),
    };
  }).sort((a, b) => Number(a.state === "resolved") - Number(b.state === "resolved") || Number(b.severe) - Number(a.severe) || Number(b.hard) - Number(a.hard) || (b.lastSeen || 0) - (a.lastSeen || 0));
  const spawned = (Array.isArray(w?.spawned) ? w.spawned : []).map(stamp).filter((t) => t && t <= now && now - t < 24 * HOUR);
  const hourUsed = spawned.filter((t) => now - t < HOUR).length, dayUsed = spawned.length;
  const caughtFirst = count(w?.score?.caughtFirst), playerFirst = count(w?.score?.playerFirst);
  const recentKinds = new Set(["watch_finding_raised", "watch_finding_deferred", "watch_finding_cleared", "watch_sensor_failed", "watch_caught_first", "ticket_authority_carried", "issue_closed_fixed", "sentry_resolved", "skills_unavailable", "activation_skills", "promotion_held_awake_window"]);
  const recent = audit.filter((a) => recentKinds.has(a.kind)).slice(0, 20).map((a) => ({
    kind: a.kind, at: stamp(a.at), job: a.job ? short(a.job, 100) : null, sensor: a.sensor ? short(a.sensor, 40) : null,
    fp: a.fp ? short(a.fp, 240) : null, error: a.error ? short(a.error, 220) : null,
    lane: a.lane ? short(a.lane, 40) : null, degraded: typeof a.degraded === "boolean" ? a.degraded : null,
    skillChars: typeof a.skillChars === "number" ? count(a.skillChars) : null,
  }));
  const since = now - 24 * HOUR, windowAudit = audit.filter((a) => stamp(a.at) >= since && stamp(a.at) <= now);
  const occurrences = (kind) => windowAudit.filter((a) => a.kind === kind).length;
  const latestSkills = audit.find((a) => a.kind === "activation_skills");
  const status = disabled ? "off" : !available ? "unavailable" : sensors.some((s) => s.status === "error") ? "error" : sensors.some((s) => s.status === "stale") ? "stale"
    : sensors.some((s) => s.status === "unavailable") ? "unavailable" : sensors.some((s) => s.status === "not-started") ? "not-started" : effectiveMode === "report" ? "report" : "active";
  return { available, mode: effectiveMode, paused, status, lastTurn: Number.isFinite(w?.lastTurn) ? w.lastTurn : null, sensors,
    findings: allFindings.slice(0, Math.max(1, Math.min(100, count(findingLimit)))), totalFindings: allFindings.length,
    hiddenFindings: Math.max(0, allFindings.length - Math.max(1, Math.min(100, count(findingLimit)))), openFindings: allFindings.filter((f) => f.state !== "resolved").length,
    budget: { perHour: 3, perDay: 8, hourUsed, dayUsed, hourRemaining: Math.max(0, 3 - hourUsed), dayRemaining: Math.max(0, 8 - dayUsed), deferred: allFindings.filter((f) => f.deferredAt && f.state === "observed").length },
    score: { caughtFirst, playerFirst, share: caughtFirst + playerFirst ? Math.round(100 * caughtFirst / (caughtFirst + playerFirst)) : null, label: "Caught first, confirmed later by player reports" },
    repairs, capabilities: { windowMs: 24 * HOUR, scope: "Retained ledger audit events", authorityCarried: occurrences("ticket_authority_carried"), issuesClosedLive: occurrences("issue_closed_fixed"), sentryResolved: occurrences("sentry_resolved"), heldPromotions: occurrences("promotion_held_awake_window"), sensorFailures: occurrences("watch_sensor_failed"), skillFailures: occurrences("skills_unavailable"),
      skills: latestSkills ? { at: stamp(latestSkills.at), lane: short(latestSkills.lane, 40), degraded: Boolean(latestSkills.degraded), disabled: Boolean(latestSkills.disabled), names: (Array.isArray(latestSkills.skills) ? latestSkills.skills : []).slice(0, 12).map((s) => short(s, 80)), chars: count(latestSkills.skillChars) } : null }, recent };
}

module.exports = { buildWatchState, SENSOR_DEFS };
