"use strict";
// Keir 5.1 release train (owner, 2026-10-14: after 4.0, a weekly train with a
// shadow soak day and no same-day shipping). The 2026-10-15 audit found 20
// releases in one day of 4.x and 10 in the first three hours of 5.x. Each
// patch fixed the previous one's regression; the train makes a change soak on
// main before it reaches the host.
//
//   train:   the last train release is at least TRAIN_GAP old and the
//            candidate commit has been on main for at least SOAK.
//   hotfix:  bypasses both with a written reason, recorded in the log.
//
// Pure: log entries, timestamps and the request in, a verdict out.

const DAY = 86400000;
const TRAIN_GAP = 6 * DAY;
const SOAK = DAY;

// log: [{ at, sha, version, kind: "train" | "hotfix", reason }]
function decide({ log = [], now = Date.now(), committedAt, hotfix = null }) {
  if (hotfix !== null) {
    const reason = String(hotfix || "").trim();
    if (reason.length < 15) return { allowed: false, reason: "a hotfix needs a written reason (15+ characters): what is broken for players or staff" };
    return { allowed: true, kind: "hotfix", reason };
  }
  const trains = log.filter((e) => e.kind === "train").sort((a, b) => b.at - a.at);
  const last = trains[0];
  if (last && now - last.at < TRAIN_GAP) {
    const next = new Date(last.at + TRAIN_GAP).toISOString().slice(0, 16).replace("T", " ");
    return { allowed: false, reason: `the last train left ${Math.floor((now - last.at) / 3600000)}h ago; the next one is due ${next} UTC. Use --hotfix "<reason>" for a fix that cannot wait.` };
  }
  if (!Number.isFinite(committedAt) || now - committedAt < SOAK)
    return { allowed: false, reason: `the candidate has been on main ${Number.isFinite(committedAt) ? `${Math.floor((now - committedAt) / 3600000)}h` : "for an unknown time"}; a train release soaks 24h first. Use --hotfix "<reason>" for a fix that cannot wait.` };
  return { allowed: true, kind: "train", reason: "weekly train" };
}

module.exports = { decide, TRAIN_GAP, SOAK };

// CLI for deploy/release.sh: node train.js <log.jsonl> <committedAtSeconds> [hotfixReason]
// Prints the verdict as JSON; exit 0 allowed, 3 refused.
if (require.main === module) {
  const fs = require("node:fs");
  const [file, committed, ...rest] = process.argv.slice(2);
  let log = [];
  try { log = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { log = []; }
  const v = decide({ log, committedAt: Number(committed) * 1000, hotfix: rest.length ? rest.join(" ") : null });
  console.log(JSON.stringify(v));
  process.exit(v.allowed ? 0 : 3);
}
