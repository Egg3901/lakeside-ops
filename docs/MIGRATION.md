# Repository consolidation

The canonical product source is `lakesidegamedev/lakeside-ops`.

| Component | Imported source revision | Destination |
| --- | --- | --- |
| Native app | `Egg3901/lakeside-ops@9effd9001f9c1e9bf0c46aa100e815a0f72b642a` | `apps/ios` |
| Web portal/studio backend | `Egg3901/LSGD-ops-dash@b0a8373d2c28e0030072ca35b99cb3efe4a46d59` | `apps/web` |
| Keir agent/harness | `Egg3901/lakeside-operator@8d7bfe6ff430e8e32e74f223af36c28c3c64f249` | `apps/agent` |

The native app's Git history, issues, repository identity, Actions secrets and
release workflows are retained by transferring the existing repository to the
organization. Web and agent code are source snapshots with provenance, not
history merges. Historical studio env backups must never become public.
The original private repositories remain historical references and sources for
currently pinned production releases. New product changes belong here.

The web import excludes runtime data, tenant configuration, operational reports,
release evidence, analysis plans, unrelated storefront assets and absolute-path
symlinks. The shipped tenant config is an example. Individual component licenses
and third-party notices remain alongside their source.

Production cutover is a separate release operation: build tested component
releases from the monorepo, preserve environment and persistent state, update
release tooling and service source references, then verify each service. Existing
production files, services, locked worktrees and release symlinks are not moved
or restarted by this consolidation. Historical clones must not be deleted while
services or active sessions still depend on them.
