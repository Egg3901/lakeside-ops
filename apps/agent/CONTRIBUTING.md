# Contributing

This repository runs a live support desk for real players. Ship like it matters.

- **Branch from `origin/main` in a registered worktree** (`git worktree add worktrees/<branch> -b <branch> origin/main`). Never switch branches on the main checkout; units read pinned releases, not the checkout, but other agents share the tree.
- **Conventional commits**, no em or en dashes anywhere (code, comments, commits, player copy).
- **Tests before a PR**: `npm test` and `cd rust && cargo test`. Tests run with `KEIR_JEV=off` and never reach the network; inject fakes for providers and MCPs.
- **Changelog and version**: every PR that changes behaviour adds its lines under `## Unreleased` in `CHANGELOG.md` and never bumps a version. The next train's version stays open for every fix until the train leaves; the comment under `## Unreleased` names it. At train time `bin/keir-cut.js X.Y.Z` moves the lines under a version heading and sets the version in `package.json`, `package-lock.json`, `rust/Cargo.toml` and `rust/Cargo.lock` (merge that, then `deploy/release.sh`). `test/versioning.test.js` fails if a PR cuts a version heading on its own.
- **Player copy is gated in code**. If a rule about what Keir may say or claim matters, it goes in `lib/operator/playercopy.js` or the broker guards with a test, not only in `KEIR.md`.
- **Nothing public leaks**: PR bodies Keir opens on `lakesidegamedev/AHDGame` are public; no player names, hosts, paths or tokens. Runbooks and incident notes go to ops-knowledge, not this repo.
- **Merge** with a merge commit via the REST API once tests are green; delete the branch and remove the worktree.
- **Release train**: weekly after the 4.0 cutover; nothing ships the day it is written; one shadow day per release (`/reports/keir-4-shadow` before and after). Player-facing breakage is the only exception.
