"use strict";

// Published reports and their manifest are read from disk on every request.
// Writing either file therefore makes the report live immediately. Restarting
// Ops here severs active connections and repeats expensive startup indexing.
function activatePublishedReports() {
  return {
    ok: true,
    skipped: true,
    note: "Report files are live immediately; the Ops service was not restarted.",
  };
}

module.exports = { activatePublishedReports };
