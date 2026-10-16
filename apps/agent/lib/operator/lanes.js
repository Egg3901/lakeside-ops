"use strict";
// Keir 3.0 wiring: execution lanes driven by fast-lane admission. Each lane
// is one slot of an admission class; the dedicated lanes are the service budget.
// drain() asks pickForLanes which queued jobs start in which free lanes,
// replacing scheduling.nextJob. Owner work that does not fit the owner lane
// runs in an investigation lane, as admission allows.

const { admit, classOf, CLASSES } = require("./admission");

const LANES = Object.entries(CLASSES).flatMap(([name, c]) =>
  Array.from({ length: c.capacity }, (_, i) => `${name}${i ? i + 1 : ""}`));
const laneClass = (lane) => lane.replace(/\d+$/, "");

function emptyLanes() { return Object.fromEntries(LANES.map((l) => [l, null])); }

// jobs: every ledger job. active: { lane: { job } | null }.
// ctx: { now, supportDeferred(job) | boolean, claimedBy(channelId) }.
function pickForLanes(jobs, active, ctx = {}) {
  const activeIds = new Set(Object.values(active).filter(Boolean).map((s) => s.job.id));
  const counts = {};
  for (const [lane, slot] of Object.entries(active)) if (slot) counts[laneClass(lane)] = (counts[laneClass(lane)] || 0) + 1;
  // Lane occupants are running by definition, whatever their stored state.
  const view = jobs.map((j) => (activeIds.has(j.id) ? { ...j, state: "running" } : j));
  const admitted = admit(view, { ...ctx, active: counts, borrowCoding: false });
  const free = new Set(LANES.filter((l) => !active[l]));
  const picks = [];
  for (const job of admitted) {
    const cls = classOf(job);
    const options = [...free].filter((l) => laneClass(l) === cls);
    if (!options.length && cls === "owner") options.push(...[...free].filter((l) => laneClass(l) === "investigation"));
    // Investigation borrows the coding lane when admission lent it.
    if (!options.length && ["investigation", "owner"].includes(cls)) options.push(...[...free].filter((l) => laneClass(l) === "coding"));
    if (!options.length) continue;
    free.delete(options[0]);
    picks.push({ lane: options[0], job });
  }
  return picks;
}

function laneTimeoutMs(lane, maxTurnMs) {
  const cls = laneClass(lane);
  return ["conversation", "watchkeeper", "engineering"].includes(cls) ? CLASSES[cls].timeoutMs : maxTurnMs;
}

module.exports = { LANES, laneClass, emptyLanes, pickForLanes, laneTimeoutMs };
