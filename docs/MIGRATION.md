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

This is a port of existing products, not a replacement agent or a separate
Discord bot product. The desktop client wraps the Keir app. Web, desktop, iOS
and CLI use the existing app-channel/task protocol. The standalone Discord
owner-DM connector reuses the operator's REST transport and catch-up reader,
then enters that same task protocol. The existing guild/support gateway,
approval adapters and studio integrations remain available in Lakeside mode.
Independent-mode availability is documented in [clients](CLIENTS.md) and the
README's current boundaries; importing a component does not by itself make
every studio-specific feature portable.

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

For Keir, `apps/agent/deploy/release.sh REF --stage` builds and tests an immutable
agent-only release without switching the running service. Activation uses the
same reviewed ref with the normal train gate or an explicitly authorized
`--hotfix REASON`. Monorepo releases use `keir-vX.Y.Z` tags, a `RELEASE` marker
and `SOURCE.json` with canonical repository, commit and component provenance.
The three Node services keep `/opt/keir/current` as their release path. Their
Discord credential file is `/etc/keir-discord.env`, separate from source.
Keep the old pinned release and environment until the new services and task
path have been verified; `release.sh --rollback` restores the previous pointer.

Unmerged legacy branches and local changes must be preserved before source
cutover. A private Git bundle includes every ref and detached worktree HEAD;
dirty tracked and untracked source files need separate snapshots. Review
patch equivalence against legacy main to distinguish squashed history from
pending changes. Preservation is not a claim that pending changes have been
reviewed, merged or enabled. Keep sensitive historical bundles private.
