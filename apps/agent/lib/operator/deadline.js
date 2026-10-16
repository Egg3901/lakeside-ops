"use strict";
// A task deadline is Keir's own timer, not a question for the owner. The
// first expiry extends it once and the work carries on; only a task that runs
// out of time again is held for the owner (owner, 2026-10-16: an MNM
// settlement investigation reached the app as "Needs you" when the only
// sensible move was to keep going).
const MAX_EXTENSIONS = 1;

function expireDeadline(job, now, { lifetimeMs }) {
  if (!(job.deadline < now) || ["done", "dismissed", "cancelled", "blocked"].includes(job.state)) return null;
  if ((job.deadlineExtensions || 0) < MAX_EXTENSIONS) {
    job.deadlineExtensions = (job.deadlineExtensions || 0) + 1;
    job.deadline = now + lifetimeMs;
    if (job.state === "waiting") job.state = "queued";
    return "extended";
  }
  job.state = "blocked";
  job.summary = "Task ran out of time twice; owner needs to choose the next move.";
  return "blocked";
}

module.exports = { expireDeadline, MAX_EXTENSIONS };
