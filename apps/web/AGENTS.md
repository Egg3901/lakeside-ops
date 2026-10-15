# Agent repository rules

## Worktree lifecycle

A worktree is temporary execution state, not storage. Before ending work, an
agent must leave every change in one of these durable states:

1. committed and pushed with a PR or explicit handoff link;
2. committed on a named recovery branch with the branch and purpose recorded;
3. intentionally discarded by a human after reviewing the diff.

Never use `git worktree remove --force`, `git branch -D`, or an equivalent
automated cleanup on a checkout with changes or patches not present on the base
branch. Session deletion must refuse those states.

Create linked worktrees outside the checkout, or beneath the ignored
`worktrees/` directory. Do not broaden test globs to traverse nested worktrees.
Lock every active worktree at creation (`git worktree add --lock --reason ...`).
Unlock it only after the branch is durably delivered and immediately before
removal. A merged commit is not proof that no build or deployment still uses
the checkout.

Run `npm run audit:worktrees` during handoff. It is intentionally read-only.
Run `npm run audit:worktrees:strict` when validating that recovery is complete.
