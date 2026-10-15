"use strict";
const { isQuick } = require("./conversation");
function nextJob(jobs, { quick, activeIds = [], supportDeferred = false, preferSupport = false }) {
  const ready = jobs.filter(j => j.state === "queued" && isQuick(j) === quick && !activeIds.includes(j.id) &&
    (j.role === "owner" || ["command", "conversation"].includes(j.kind) || !supportDeferred));
  const support = preferSupport && !quick ? ready.filter(j => j.role !== "owner" && ["ticket", "candidate"].includes(j.kind)) : [];
  const pool = support.length ? support : ready;
  return pool.sort((a, b) => (a.role === "owner" ? 0 : ["command", "conversation", "coding"].includes(a.kind) ? 1 : 2) - (b.role === "owner" ? 0 : ["command", "conversation", "coding"].includes(b.kind) ? 1 : 2) || a.updatedAt - b.updatedAt)[0];
}
module.exports = { nextJob };
