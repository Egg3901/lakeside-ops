# Lakeside Code

A local coding terminal with a blue/steel-grey interface and a pinned OpenCode
1.19.0 engine. Supports Linux and Ubuntu under WSL2 on Windows. Keep projects
inside WSL (for example `~/projects`) for fast filesystem access. Native Windows
has a prototype installer and CI checks for installation, runtime and the ConPTY
terminal. Physical PC setup can differ; macOS has not been validated.

Lakeside Code retains OpenCode's file editing, shell, model selection, sessions,
compaction, permissions and diff viewer. Keir remains a separate optional remote
agent. No Keir portal, Rust build or VPS connection is needed for local coding.

## Install

Use Node.js 22.12 or later. Download the package from the private repository's
**Lakeside Code 0.1.2 preview** release, then install it in your WSL terminal:

```sh
gh release download code-v0.1.2-preview.3 --repo lakesidegamedev/lakeside-ops \
  --pattern 'lakesidegamedev-code-0.1.2.tgz'
npm install --global ./lakesidegamedev-code-0.1.2.tgz
lakeside code doctor
lakeside code ~/projects/your-project
```

`lakeside` on its own opens coding in the current folder; `lakeside code` remains
available. Relative project paths resolve from your current shell directory.
Open a terminal in an existing checkout and run `lakeside`, or pass its full path.
Register a local checkout once to open it by name from any directory:

```powershell
lakeside code projects add AHDGame "C:\path\to\AHDGame-dev"
lakeside code AHDGame
```

Use your actual checkout path. A registered project never creates or clones a
missing directory, and stale registrations fail explicitly.

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

The home screen keeps the mountain/lake mark, including a compact mark in short terminals, prompt and project/branch. The coding session has a Lakeside composer and workspace rail. Window titles use Lakeside Code.
**Inspect project** and **Review changes** fill editable prompts, with equivalent
`/inspect-project` and `/review-changes` palette commands. Agent panels appear
when configured peers or a configuration error need attention. `/agents` inspects
those peers; `/handoffs` shows durable delegated work and refreshes known results.

`/workbench` opens the real working-tree diff, recorded shell commands and their
outputs, or native MCP connection status. Press `1`, `2`, `3` inside it to switch
views. The diff includes changes made outside this session, including untracked
files when the engine can produce their patch. Command completion is not a claim that all tests passed. `/connections`
opens connection status directly. `/validate-changes` prepares focused validation. Resume opens the native session picker. Review
and validation controls prepare editable prompts in the current session and
preserve existing drafts.

`lakeside code --preview` shows explicitly simulated Changes, Review and Checks
views without model calls or project edits. Press `1`, `2`, `3` to switch views
and `Esc` to return to coding. The delegated-review rail collapses below 110
columns. The real conversation, code/diff rendering and keyboard controls use
the upstream engine.

Generated TUI launch configuration lives in
`~/.config/lakeside-code/terminal.generated.json`; global/project OpenCode
configuration still loads. The plugin installs its bundled theme through the
engine's theme interface. UI source assets are staged in a content-addressed
`tui-runtime` directory beside the generated configuration so installed-package
JSX uses the host's Solid renderer. Sessions/authentication use OpenCode's normal storage.
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
- `/design-system` covers visual tokens, typography, components, density and motion.
- `/ux-design` covers complete task flows, state transitions and recovery.
- `/accessible-design` covers keyboard operation, focus, semantics and readable states.
- `/terminal-design` covers adaptive terminal layouts, honest live state and PTY validation.
- `/design-review` inspects the rendered result and fixes concrete usability and visual defects.

Skills are registered with the engine's native skill tool, so the agent can load
them as needed. Owner and repository instructions take precedence. Custom skill
paths and slash commands remain available. `lakeside code skills` lists the
bundled skills and their pinned sources; `lakeside code doctor` checks their presence.
Keir's `apps/agent/skills` directory is the source of truth for the six pinned coding skills. Five first-party design skills live in `apps/cli/design-skills`, with separate provenance and the repository license. Both sets ship in the package.

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

## Work integrations and recovery

Integrations are disabled by default. Opt in independently:

```sh
lakeside code workflow enable github
lakeside code workflow enable kanban
lakeside code workflow enable tickets
lakeside code workflow
lakeside code workflow disable tickets
```

This persists workflow consent in private `workflow.json`. It instructs every
selected model to read linked acceptance criteria, update meaningful progress and
attach evidence using available authenticated GitHub CLI or MCP tools. It does
not install credentials, select a board, invent ticket endpoints, or enforce a
transactional write protocol. Connect the relevant tools and identify the task.
Explicit owner instructions and existing permissions still apply.

`workflow_checkpoint` saves session-scoped task, state, evidence and next action
outside the model context. `workflow_status` reads it. The latest checkpoint is
included on every model turn and during compaction, so an API model change keeps
the recovery context. Records are model reports and require reconciliation with
the actual repository and remote state. Uncertain external effects must be read
back before retrying. This is recovery scaffolding, not exactly-once delivery for
arbitrary shell or MCP writes. Native CLI backends are experimental in 0.1.3 and have their own explicit selection, permission handling and durable run records; see below.

## Connect studio MCP tools

Peers and MCP servers are separate connections. Add an existing reachable server:

```sh
lakeside code mcp add --id support --url https://your-gateway.example/mcp --token-env SUPPORT_TOKEN
lakeside code mcp
```

Set the named environment variable in the shell before launching coding. Only its
name is stored; credential values are resolved by the engine. Missing credentials
disable that connection. HTTPS or loopback HTTP is required; URL credentials and
query tokens are rejected. Without `--token-env`, the native engine can negotiate
OAuth with servers that support it. Existing native MCP settings take precedence
when ids collide. Restart coding after configuration changes and use
`/connections` to inspect actual connection state.

A VPS localhost URL points at your PC when used on your PC. Use an existing secure
gateway or authenticated SSH tunnel for private services. No studio credentials,
public gateway or remote tunnel are installed automatically by this command.

## Validate

```sh
npm run test:cli                 # from the monorepo root
npm --prefix apps/cli run typecheck:contracts
node apps/cli/smoke.mjs          # actual engine, no provider calls
```

CI packs and installs the package outside the checkout, checks its bundled engine
and registers six coordination tools, two recovery tools and eleven built-in skills.
An authenticated loopback MCP fixture verifies real engine tool discovery. A real
PTY check opens the installed preview, compact home and workbench. Tests cover HTTP protocols, durable
handoffs, cancellation, conservative recovery and startup with ESM dependencies.

Upstream: [server](https://opencode.ai/docs/server/),
[plugins](https://opencode.ai/docs/plugins/),
[TUI interface](https://github.com/anomalyco/opencode/blob/v1.19.0/packages/plugin/src/tui.ts).

## Experimental native backends (0.1.3)

API mode is the default. Native mode uses ACP and an independently selected
installed adapter. It does not extract tokens or silently choose another backend.
Install and sign in to the backend on the coding PC before use:

- Claude: the maintained `claude-agent-acp` adapter from `@agentclientprotocol/claude-agent-acp`.
- Codex: the maintained `codex-acp` adapter from `@agentclientprotocol/codex-acp`.
- Gemini: an installed Gemini CLI with `gemini --acp` support.

Authentication, account eligibility and tool execution remain with that backend.
These are optional dependencies, not installed or authenticated by Lakeside Code.
The native view currently supports text input, streaming text/tool status and
permission selection. A Linux PTY fixture verified text input, permission selection, an actual file edit
and streamed completion. Paid vendor sessions and native Windows backend behavior
remain unverified. API session controls do not change native sessions.

```sh
lakeside code ./project --backend api --model provider/model
lakeside code ./project --backend claude
lakeside code ./project --backend codex
lakeside code ./project --backend gemini
lakeside code backends
lakeside code runs
lakeside code ./project --backend codex --resume-run RUN_UUID
lakeside code ./project --backend gemini --carry RUN_UUID
```

`--model` in native mode requires advertised session model configuration; missing
support fails instead of substituting a model. To point at a different ACP
executable, use `backends add --id NAME --command EXECUTABLE --args JSON_ARRAY`.
Arguments are passed separately, without a shell command string. Normal engine
flags beyond project/model require API mode.

Native prompt ids are durable and deduplicated in the same run. Intent is saved
before dispatch. Lost final responses remain uncertain. Resume loads the original
backend/session and never repeats a prior prompt automatically. Unsupported load
capability fails explicitly. A live run has one process owner; abandoned leases
expire after the lock library's stale interval. Cancellation is a request until
the backend returns its final cancellation response. A completed native turn is
not proof that the coding task or validation is finished.

`--carry` explicitly transfers a bounded visible task history to a new backend;
private reasoning and provider authentication are not transferred. API sessions
can carry a native run, and native sessions can carry an API session that has a
`workflow_checkpoint`. Native records live in the client state directory under
`native-runs`. MCP connection configuration is forwarded only when HTTP MCP
support is advertised. Missing-token connections are omitted; this does not
establish successful server authentication. Inspect the native backend's MCP
status before claiming tool access.

The ACP filesystem proxy permits project access and read-only built-in skill
libraries. It does not provide an OS sandbox or restrict a backend's independent
shell tools. Native backend permissions and OS isolation still apply.
