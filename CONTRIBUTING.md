# Contributing

Work on a branch in a registered worktree. Open a pull request against `main`.
Keep changes scoped to their component and update the relevant setup docs when
behavior changes. Never commit local configuration, runtime state, credentials,
provider transcripts, certificates, signing output or operational reports.

Required checks cover portal/auth behavior, agent regressions, web regressions,
Rust, secret scanning and the iOS simulator. CI must use fixtures and isolated
storage; it must never reach a real game database or deploy a service.

Keep default standalone imports independent of studio services. Advertise a
capability only when the backend supports it. Preserve request idempotency,
origin boundaries, exact authority checks and cancellation fences.

Agent release versions stay in `apps/agent` and its changelog. Native app release
workflows operate in `apps/ios`; desktop packaging is manual and uploads CI
artifacts only. Never use desktop packaging to distribute the server's config.
