"use strict";
// Keir 4.0 phase 1: blast radius classes. A change is classed by the files it
// touches, and the class decides how it may move towards the main server.
//
// Born from ticket 1498 (2026-10-12): an economy change was promoted at night
// on consent inherited from an earlier merge approval, the economy nearly
// imploded and the owner reverted it half asleep. The rule the owner set on
// 2026-10-14: no simulation gate, economy and turn-worker changes need the
// owner's approval per promotion and an owner-awake window, unless the owner
// grants a night pass for that specific change. Copy and display fixes keep
// the fast lane; other logic changes keep the existing green-gated path.
//
// Pure: file lists and timestamps in, a class and a verdict out. No I/O.

const ECONOMY_PATHS = /^src\/lib\/(turn|market|economy|banking|equities|indexFunds|ledger|currency|budget|financialTxLog|corporations\/(commands|queries\/sector))\//;
// Turn-worker entry points and the worker deploy config ship through the
// turn-worker release gate; they move every world's money at once.
const WORKER_PATHS = /^(?:scripts\/turn|src\/worker|railway\.worker\.toml$|src\/lib\/turnWorker)/;
// Copy and display: pages, components, styles, static assets, text. Never a
// route handler, never anything under src/lib.
const DISPLAY_PATHS = /^(?:src\/app\/(?!api\/)[^]*\.(?:tsx|css)$|src\/components\/[^]*\.(?:tsx|css)$|public\/|messages\/|content\/|[^/]*\.md$|src\/app\/[^]*\.css$)/;
const TEST_PATHS = /(?:\.test\.[cm]?[jt]sx?$|^e2e\/|^__tests__\/|\/__tests__\/)/;

const CLASSES = ["copy", "logic", "economy"];

// files: repository-relative paths from the PR or compare API. Unknown file
// list (null) is treated as economy: the class that asks, never the one that
// waves through.
function classify(files) {
  if (!Array.isArray(files)) return { cls: "economy", reasons: ["file list unavailable"], files: [] };
  const code = files.filter((f) => !TEST_PATHS.test(f));
  const economy = code.filter((f) => ECONOMY_PATHS.test(f) || WORKER_PATHS.test(f));
  if (economy.length) return { cls: "economy", reasons: economy.slice(0, 8), files };
  if (code.length && code.every((f) => DISPLAY_PATHS.test(f))) return { cls: "copy", reasons: ["pages, components, styles or text only"], files };
  return { cls: "logic", reasons: code.filter((f) => !DISPLAY_PATHS.test(f)).slice(0, 8), files };
}

// Paths locate presentation code; they do not prove a change is presentation.
// A component can submit a payment and public/ can contain a service worker.
// Unattended findings accept static assets/styles and replacements of literal
// text inside an unchanged intrinsic JSX element. Other code stays for review.
function displayOnlyDiff(rows) {
  const deny = (reason) => ({ allowed: false, reason });
  if (!Array.isArray(rows) || !rows.length) return deny("changed files unavailable");
  const asset = /^(?:public\/)[^]*\.(?:png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf)$/i;
  const text = (line) => /^(\s*<(p|span|h[1-6]|label|small|strong|em|div|li|td|th|button)(?:\s+[^<>]*)?>)([^<>{}`]*)(<\/\2>\s*)$/.exec(line);
  for (const row of rows) {
    const name = row.filename;
    if (typeof name !== "string" || (row.previous_filename && row.previous_filename !== name)) return deny("renamed files need review");
    if (asset.test(name)) continue;
    if (!(DISPLAY_PATHS.test(name)) || /\.(?:mdx|[cm]?js|ts|json|svg|html)$/i.test(name)) return deny(`${name} is executable or outside display paths`);
    if (typeof row.patch !== "string") return deny(`${name} diff unavailable`);
    const added = [], removed = [];
    for (const line of row.patch.split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++")) added.push(line.slice(1));
      if (line.startsWith("-") && !line.startsWith("---")) removed.push(line.slice(1));
    }
    if (row.additions !== added.length || row.deletions !== removed.length) return deny(`${name} diff incomplete`);
    if (/\.(?:css|md)$/i.test(name)) continue;
    if (!/\.tsx$/.test(name) || row.status !== "modified" || !added.length || added.length !== removed.length) return deny(`${name} needs code review`);
    for (let i = 0; i < added.length; i++) {
      const a = text(added[i]), b = text(removed[i]);
      if (!a || !b || a[1] !== b[1] || a[4] !== b[4]) return deny(`${name} changes more than literal display text`);
    }
  }
  return { allowed: true, reason: "static presentation changes only" };
}

// Owner-awake window in the owner's zone (US Eastern). Default 09:00 to
// 23:00 local. The owner is one person; the window is their day, not UTC.
function localHour(nowMs, timeZone = "America/New_York") {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hour12: false }).formatToParts(new Date(nowMs));
  return Number(parts.find((p) => p.type === "hour")?.value) % 24;
}
function inAwakeWindow(nowMs, { timeZone = "America/New_York", start = 9, end = 23 } = {}) {
  const h = localHour(nowMs, timeZone);
  return h >= start && h < end;
}
// Next window opening after nowMs, to the hour, in the owner's zone.
function nextWindowOpen(nowMs, { timeZone = "America/New_York", start = 9, end = 23 } = {}) {
  let t = nowMs - (nowMs % 3600000) + 3600000;
  for (let i = 0; i < 48; i++, t += 3600000) {
    const h = localHour(t, timeZone);
    if (h >= start && h < end) return t;
  }
  return nowMs + 3600000;
}

// A night pass is the owner saying, in their own request or approval answer,
// that this change may ship outside the window. Explicit words only.
const NIGHT_PASS = /\bnight pass\b|\bship (?:it )?(?:tonight|now|overnight)\b|\bpromote (?:it )?(?:tonight|now|overnight)\b|\bgo (?:now|tonight|overnight)\b|\bdon'?t wait for (?:morning|me)\b/i;
const hasNightPass = (text) => NIGHT_PASS.test(String(text || ""));

const FRESH_APPROVAL_MS = 3 * 3600000;

// The promotion gate. Only economy class to main is held; everything else
// passes here (the existing consent rules still apply upstream).
//   to: destination branch. cls: from classify(). lastOwnerApprovalAt: the
//   newest owner approval covering this exact head (a fresh approval is awake
//   evidence). nightPass: owner words granting this change the night.
function promotionGate({ cls, to, now = Date.now(), lastOwnerApprovalAt = 0, nightPass = false, window = {} }) {
  if (cls !== "economy" || to !== "main") return { allowed: true, cls, reason: cls === "copy" ? "copy and display fast lane" : "not an economy promotion to main" };
  if (nightPass) return { allowed: true, cls, reason: "owner granted a night pass for this change" };
  if (inAwakeWindow(now, window)) return { allowed: true, cls, reason: "inside the owner-awake window" };
  if (lastOwnerApprovalAt && now - lastOwnerApprovalAt <= FRESH_APPROVAL_MS) return { allowed: true, cls, reason: "owner approved this head within the last three hours" };
  const resumeAt = nextWindowOpen(now, window);
  return { allowed: false, cls, held: true, resumeAt,
    reason: "economy or turn-worker change outside the owner-awake window with no fresh approval and no night pass" };
}

module.exports = { ECONOMY_PATHS, WORKER_PATHS, DISPLAY_PATHS, CLASSES, classify, displayOnlyDiff, inAwakeWindow, nextWindowOpen, hasNightPass, promotionGate, FRESH_APPROVAL_MS };
