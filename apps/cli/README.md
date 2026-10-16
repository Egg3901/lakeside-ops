# Lakeside Code

A local coding terminal with a blue/steel-grey interface and a pinned OpenCode
1.19.0 engine. Supports Linux and Ubuntu under WSL2 on Windows. Keep projects
inside WSL (for example `~/projects`) for fast filesystem access. Native Windows
and macOS have not been validated.

Lakeside Code retains OpenCode's file editing, shell, model selection, sessions,
compaction, permissions and diff viewer. Keir remains a separate optional remote
agent. No Keir portal, Rust build or VPS connection is needed for local coding.

## Install

Use Node.js 22 or later. Download the package from the private repository's
**Lakeside Code 0.1.0** release, then install it in your WSL terminal:

```sh
gh release download code-v0.1.0 --repo lakesidegamedev/lakeside-ops \
  --pattern 'lakesidegamedev-code-0.1.0.tgz'
npm install --global ./lakesidegamedev-code-0.1.0.tgz
lakeside code doctor
lakeside code ~/projects/your-project
```

The package installs its pinned engine automatically. You do not need a separate
OpenCode installation or the monorepo checkout. `lakeside-code` is an equivalent
direct command. The package owns the `lakeside` command; it is intended for your
coding PC, alongside the separate Keir apps.

For development from this checkout:

```sh
npm --prefix apps/cli ci
node bin/lakeside.js code /path/to/project
```

Use `/connect` to sign in to a supported provider. Existing OpenCode provider
logins and project instructions apply; credentials are never copied from another
machine. An explicit model remains explicit and unavailable models fail rather
than being silently replaced.

```sh
lakeside code /path/to/project --model provider/model
lakeside code /path/to/project --continue
lakeside code /path/to/project --session SESSION_ID
lakeside code --help
lakeside code --version
```

Normal OpenCode commands/options pass through, including `run`, `serve` and
`attach`. `LAKESIDE_OPENCODE_BIN` can override the bundled executable, but its
version must be exactly 1.19.0. Auto-update is disabled for this client launch.

## Terminal

The home screen keeps the mountain/lake mark, prompt and project/branch.
**Inspect project** and **Review changes** fill editable prompts, with equivalent
`/inspect-project` and `/review-changes` palette commands. Agent panels appear
when configured peers or a configuration error need attention. `/agents` inspects
those peers; `/handoffs` shows durable delegated work and refreshes known results.

`lakeside code --preview` shows explicitly simulated Changes, Review and Checks
views without model calls or project edits. Press `1`, `2`, `3` to switch views
and `Esc` to return to coding. The delegated-review rail collapses below 110
columns. The real conversation, code/diff rendering and keyboard controls use
the upstream engine.

Generated TUI launch configuration lives in
`~/.config/lakeside-code/terminal.generated.json`; global/project OpenCode
configuration still loads. The plugin installs its bundled theme through the
engine's theme interface. Sessions/authentication use OpenCode's normal storage.
`LAKESIDE_CODE_CONFIG_DIR` changes the client configuration location;
`LAKESIDE_CODE_NAME` or `--name` changes the displayed name.

## Built-in Keir skills

The installed package includes Keir's pinned workflow skills, supporting files,
licenses and source revisions. No VPS connection or separate skill install is needed.
Ponytail full and verification-before-completion guide coding by default.

- `/ponytail lite|full|ultra` changes the level; `/ponytail stop` or “stop ponytail” disables it.
- `/ponytail-review` reviews changes for correctness and unnecessary complexity.
- `/systematic-debugging` investigates bugs before proposing fixes.
- `/test-driven-development` guides test-first implementation.
- `/verification-before-completion` requires evidence for completion claims.
- `/frontend-design` guides purposeful UI work while respecting the project's design.

Skills are registered with the engine's native skill tool, so the agent can load
them as needed. Owner and repository instructions take precedence. Custom skill
paths and slash commands remain available. `lakeside code skills` lists the
bundled skills and their pinned sources; `lakeside code doctor` checks their presence.
Keir's `apps/agent/skills` directory is the source of truth; `npm pack` includes a
snapshot of it rather than maintaining a second fork.

## Connect agents

Connections are explicit. Add a Keir peer or another OpenCode server:

```sh
lakeside code peers add --id vps-keir --kind keir \
  --url https://your-owner-portal.example.com \
  --token-env MY_KEIR_SESSION --allow-submit

lakeside code peers add --id local-reviewer --kind opencode \
  --url http://127.0.0.1:4096 --directory /home/you/project/worktrees/review \
  --token-env MY_REVIEW_PASSWORD --model provider/model --allow-submit

lakeside code peers
```

Set the named credential variables in your shell's private environment before
launching. Keir uses an owner session bearer token; OpenCode uses HTTP Basic auth
with username `opencode`. The private peer file stores variable names, never
credential values. Its default location is `~/.config/lakeside-code/peers.json`;
`LAKESIDE_CODE_PEERS` selects an existing alternative file. A peer is read-only
unless `--allow-submit` is supplied. Edit the private file to change/remove a peer.

Remote URLs must be HTTPS origins, except loopback HTTP. You can use a loopback
SSH tunnel for a private remote server. A receiving OpenCode peer must have an
explicit directory, preferably a separate registered worktree. Repository paths
are interpreted on the receiving machine. No repository, patch or worktree is
automatically copied. The peer needs access to the specified branch/base commit.

The model can inspect activity, submit a bounded handoff, retrieve results,
list persisted handoffs, refresh their state and request cancellation. Writes
use the `agent_handoff` and `agent_cancel` permissions, defaulting to `ask`.
Existing explicit user permission settings remain in effect. Handoffs carry
repository, branch, base, goal, allowed scope and expected deliverable. Review
returned findings/PRs/commits/patches locally before integrating them.

Only configured Keir/OpenCode server interfaces are controlled. Arbitrary
Claude, Codex, Muse or other existing terminal processes are not discovered or
impersonated. You can continue to use installed provider CLIs through the local
coding agent's shell under your normal permissions.

## Recover and cancel work

```sh
lakeside code handoffs
lakeside code handoffs refresh HANDOFF_ID
lakeside code handoffs cancel HANDOFF_ID
# Explicitly recover an uncertain Keir dispatch using its original client id:
lakeside code handoffs refresh HANDOFF_ID --retry
```

Receipts live under `~/.local/state/lakeside-code/handoffs/`, respecting
`XDG_STATE_HOME` or `LAKESIDE_CODE_STATE_DIR`. Intent is saved before network I/O.
**Accepted** never means completed, and an idle/empty OpenCode session never
counts as success. Known remote results update the receipt across restarts.

Lost responses stay **uncertain** and are never automatically resubmitted.
OpenCode recovery looks up the original session/message and does not create
replacement work. Explicit Keir recovery reuses its deduplication key within a
conservative six-day window; it may deliver the original request if the first
attempt never arrived. Older uncertain requests need manual remote inspection.
Changing a peer's origin/directory prevents a receipt from acting on a different
target. Cancellation is recorded as confirmed only after the peer acknowledges
it; an ambiguous reply stays **cancel-uncertain**. Cancellation cannot undo
already dispatched external effects.

## Validate

```sh
npm run test:cli                 # from the monorepo root
node apps/cli/smoke.mjs          # actual engine, no provider calls
```

CI packs and installs the package outside the checkout, checks its bundled engine
and registers all six coordination tools and built-in skills. Tests cover HTTP protocols, durable
handoffs, cancellation, conservative recovery and startup with ESM dependencies.

Upstream: [server](https://opencode.ai/docs/server/),
[plugins](https://opencode.ai/docs/plugins/),
[TUI interface](https://github.com/anomalyco/opencode/blob/v1.19.0/packages/plugin/src/tui.ts).
