# Lakeside Code

A local coding terminal built on OpenCode 1.19.0. Run it on Linux or in Ubuntu
under WSL2 on Windows. Keep Linux projects in the WSL filesystem for best I/O
performance. Native PowerShell and macOS have not been validated in this release.

Lakeside Code retains OpenCode's coding tools, sessions, model selection,
permissions, compaction and diff viewer. Its own terminal plugin adds the
Lakeside identity, Midnight theme, project launch actions and connected-agent
activity. It is separate from Keir, which can be configured as a remote peer.
No portal account, Rust harness build or VPS connection is required for local use.

## Run

Install Node.js 22+ and the pinned OpenCode release, then run from this checkout:

```sh
npm install --global opencode-ai@1.19.0
npm --prefix apps/cli ci --ignore-scripts
node bin/lakeside.js code /path/to/project
# Or, after npm link:
lakeside code /path/to/project
```

Existing OpenCode provider authentication and project instructions apply.
Use `/connect` to configure a provider if needed. No provider credential is
bundled or copied from another machine. All normal OpenCode arguments pass through:

```sh
lakeside code /path/to/project --continue
lakeside code /path/to/project --session SESSION_ID
lakeside code /path/to/project --model provider/model
```

The launcher requires exactly 1.19.0 because it uses that release's TUI plugin
interface. `LAKESIDE_OPENCODE_BIN` selects a separate executable. It disables
automatic engine updates for this launch; your normal OpenCode installation is
not reconfigured. Compatibility with a newer release must be checked before
changing the pin.

Generated TUI launch configuration lives in
`~/.config/lakeside-code/terminal.generated.json` (or
`LAKESIDE_CODE_CONFIG_DIR`). Existing global/project OpenCode configuration still
loads. The terminal plugin installs its bundled theme through OpenCode's theme
interface. Local sessions and provider authentication use OpenCode's normal
storage. `--name` or `LAKESIDE_CODE_NAME` changes the displayed client name.

## Explore the design

```sh
npm run code:preview
# Or inside Lakeside Code:
# /preview
```

This renders a real terminal route with separate Changes, Review and Checks
views. Click the tabs or press `1`, `2`, `3` to switch views, and press `Esc`
or **close preview** to enter the real home screen. All task activity,
diffs and test counts on the preview route are
explicitly simulated. It never submits a prompt or edits project files.
The agent rail collapses below 110 terminal columns. The normal conversation,
editor, keyboard controls and diff viewer remain OpenCode's implementation.

The home screen keeps the logo, prompt and current project/branch. **Inspect
project** and **Review changes** fill editable prompts; both are also available
through the command palette or `/inspect-project` and `/review-changes`.
The peer panel appears only when peers are configured or their configuration
needs attention. `/agents` remains available when you want to inspect it.

## Connect agents

Set `LAKESIDE_CODE_PEERS` to a private JSON file outside your repository:

```json
[
  {
    "id": "vps-keir",
    "name": "Keir on VPS",
    "kind": "keir",
    "url": "https://your-owner-portal.example.com",
    "tokenEnv": "MY_KEIR_SESSION",
    "allowSubmit": true
  },
  {
    "id": "local-reviewer",
    "name": "Local reviewer",
    "kind": "opencode",
    "url": "http://127.0.0.1:4096",
    "directory": "/home/you/projects/example/worktrees/review",
    "tokenEnv": "MY_LOCAL_OPENCODE_PASSWORD"
  }
]
```

URLs must be HTTPS origins, except loopback HTTP. Credentials are referenced by
environment-variable name, never stored in the peer file. Keir uses an existing
owner session bearer token. OpenCode peers use HTTP Basic auth with username
`opencode` and the password from the named variable. To connect a remote private
endpoint, use an authenticated HTTPS route or a loopback SSH tunnel. This client
does not expose VPS loopback MCP ports or change remote services.

`/agents` opens the peer view. Click a connected peer and a task to inspect its
result. The live rail refreshes every ten seconds and marks unreachable peers
offline; local coding continues. Peers represent configured server interfaces,
not discovery of arbitrary Claude, Codex or other terminal processes.

The model receives three coordination tools:

* `agent_status`: read configured peer activity.
* `agent_handoff`: submit a task to a Keir peer with `allowSubmit: true`.
* `agent_result`: retrieve a known task, including completed results.

Handoffs carry the repository, branch, base commit, goal, allowed scope and
expected deliverable. The default handoff permission is `ask`; existing explicit
user permission settings still apply. No worktree, branch or patch is copied
automatically. The receiving agent needs access to the stated repository and
commit. Return and review a PR, commit or patch before integrating changes.
OpenCode peers support inspection and result retrieval in this release;
submission and cancellation through these adapters are not implemented yet.

Dispatch intent and acceptance are recorded under
`~/.local/state/lakeside-code/handoffs/`, respecting `XDG_STATE_HOME`. A receipt
means **accepted**, never completed. A lost response records **uncertain** with
the client id and original scope; it is never automatically retried. Inspect
the remote task/thread before sending again. On a Keir server, that client id
is also the message deduplication key. Automatic reconciliation is not yet
implemented.

## Validation

```sh
npm run test:cli
```

Tests cover launch configuration, preserved permissions, real HTTP session
inspection, offline peers and durable/uncertain handoffs. Terminal smoke checks
use the installed pinned engine with isolated XDG directories and no model calls.
An actual authenticated coding task and PC-to-VPS handoff still need validation
on the owner's configured installation.

Upstream interfaces:
[TUI plugin source](https://github.com/anomalyco/opencode/blob/v1.19.0/packages/plugin/src/tui.ts),
[server](https://opencode.ai/docs/server/),
[plugins](https://opencode.ai/docs/plugins/).
