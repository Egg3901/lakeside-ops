"use strict";
// Keir 5.1 chain consent (owner, 2026-10-15). The 5.x audit counted 2.5
// owner decision DMs an hour, mostly the same change asked three times: the
// PR merge, then development to staging, then staging to main (ticket 1555).
// The owner's 5.0 ruling is one yes per chain unless the change grows, so a
// promotion that carries only changes the owner already approved, at the
// exact heads approved, rides those approvals.
//
// What still asks: any economy or turn-worker change in the range without an
// owner approval for that PR at its merged head, any commit that is not from
// a pull request (a direct push), and approvals older than CHAIN_MS. The
// owner-awake window still gates economy promotions to main (ticket 1498), and
// the caller passes the oldest covering approval's time to that gate.
//
// Pure: range facts and actions in, a verdict out. No I/O.

const CHAIN_MS = 24 * 3600000;

// actions: ledger actions. Returns Map<prNumber, [{ head, approvedAt, id, approvalMessage }]>.
function approvedMerges(actions, ownerId, now = Date.now()) {
  const out = new Map();
  const add = (number, head, a) => {
    if (!Number(number) || !head) return;
    const list = out.get(Number(number)) || [];
    list.push({ head, approvedAt: a.approvedAt || a.at, id: a.id, approvalMessage: a.approvalMessage });
    out.set(Number(number), list);
  };
  for (const a of Object.values(actions || {})) {
    if (a.kind !== "github" || a.state !== "approved" || a.approvedBy !== ownerId || !a.approvalMessage) continue;
    if (now - (a.approvedAt || a.at || 0) > CHAIN_MS) continue;
    if (a.args?.action === "merge") add(a.args.number, a.args.head, a);
    else if (a.args?.action === "merge-set") for (const p of a.args.prs || []) add(p.number, p.head, a);
  }
  return out;
}

// entries: one per non-merge commit in the promotion range:
//   { sha, prs: [{ number, head, huge }] }  (prs empty = direct push).
// huge: the PR's files include economy, turn-worker or migration paths, or its
// file list is unknown. Non-huge PRs need no approval here.
function cover({ entries, approvals }) {
  if (!Array.isArray(entries) || !entries.length) return { covered: false, uncovered: [{ reason: "promotion range unavailable" }], by: [] };
  const by = new Map(), uncovered = [];
  for (const e of entries) {
    if (!e.prs?.length) { uncovered.push({ sha: e.sha, reason: "commit is not from a pull request" }); continue; }
    const huge = e.prs.filter((p) => p.huge);
    if (!huge.length) continue;
    // A commit is covered when any PR that carries it was approved at its head.
    const hit = huge.map((p) => (approvals.get(Number(p.number)) || []).find((x) => x.head === p.head)).find(Boolean);
    if (hit) by.set(hit.id, hit);
    else uncovered.push({ sha: e.sha, pr: huge[0].number, reason: `PR ${huge[0].number} changes economy or turn code and has no owner approval at its merged head` });
  }
  const list = [...by.values()];
  return { covered: uncovered.length === 0 && list.length > 0, uncovered, by: list,
    oldestApprovedAt: list.length ? Math.min(...list.map((x) => x.approvedAt)) : 0 };
}

module.exports = { CHAIN_MS, approvedMerges, cover };
