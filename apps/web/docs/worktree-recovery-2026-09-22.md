# Worktree recovery ledger, 2026-09-22

This is a read-only recovery ledger. No checkout or branch was removed while
creating it. Re-run `npm run audit:worktrees` for the live state.

## Finding

The repository had 50 registered checkouts. Excluding the primary checkout,
28 require review: 9 contain uncommitted files and 23 contain patches absent
from `origin/main` (some overlap). Another 21 are clean and contain no unique
patches, making them candidates for reviewed pruning.

The accumulation was caused by a missing terminal lifecycle, not one failed
command. Feature-named Ops worktrees were created outside the code-session
manager, so they had no owner, expiry, or delivery state. The manager's own
periodic cleanup was disabled by `OPS_PASSIVE=1`; if enabled, its old cleanup
would have used forced worktree and branch deletion. Test discovery also walked
the nested worktrees, making stale trees part of the active build accidentally.
Older sessions were sometimes based on a stale local branch. That creation bug
has since been corrected to fetch and branch from the remote-tracking ref.

## Uncommitted files: recover first

These checkouts must be inspected and either committed to a recovery branch or
explicitly discarded by a human. A zero in the unlanded column means the
uncommitted files are the only work absent from the base.

| Checkout | Dirty entries | Unlanded patches |
|---|---:|---:|
| agent-client-controls | 1 | 0 |
| file-map | 1 | 7 |
| generic-ops-dashboard | 1 | 0 |
| hub-ask-mcp-tiers | 7 | 0 |
| macro-worldsim-plants | 1 | 4 |
| mobile-live-terminal | 1 | 0 |
| public-download-assets | 3 | 0 |
| receipt-layout | 2 | 17 |
| ticket-robustness | 10 | 17 |

## Clean branches with unlanded patches

These are durable commits but are not integrated into `origin/main`. Review,
push, and merge them, or record an explicit abandonment decision before pruning:

`ahdclient-2.0.5-portal`, `ask-visualizations-fair-play`,
`canonical-ticket-stage`, `chunker-v2`, `code-agent-design-refine`,
`discord-terminal-workflow`, `docs-polish`, `economy-market-program-final`,
`economy-outsider-2026-08-27`, `lakeside-auth-integration`, `lakeside-hub`,
`live-agent-groups`, `news-client-access`, `preserve-resolution-delivery`,
`public-receipt-context`, `supersede-old-resolution-updates`,
`ticket-resolution-receipts`, `ticket-status-view-ux`, and
`worldsim-source-pin`.

## Prevention now in the tree

- Session deletion refuses dirty work and unlanded patches.
- Automatic removal no longer uses forced worktree or branch deletion.
- The tracked-test runner cannot enter nested worktrees.
- `worktrees/` is ignored by the primary checkout.
- The read-only audit classifies every registered checkout and has a strict
  non-zero mode for the final recovery gate.
- `AGENTS.md` defines the required delivery or recovery state before handoff.

The 21 clean, patch-equivalent checkouts remain registered until reviewed.
Some may represent squash merges, so absence of unique patches is necessary but
not by itself authorization to delete them.
