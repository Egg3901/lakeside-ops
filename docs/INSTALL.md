# Install an independent Keir

The server runs on Linux. Use Node.js 22 or later, Rust 1.91 or later, Git and
GNU coreutils, a C compiler, pkg-config and OpenSSL development headers. On
Ubuntu/Debian, install the native build prerequisites with
`sudo apt-get install build-essential pkg-config libssl-dev`. Leave at least 6 GiB of memory available when running a task.
Use a dedicated unprivileged Unix account, not the studio's production account.

1. Clone this repository and run `npm run build:agent`.
2. Install a supported provider CLI (`claude`, `codex`, `muse` or `agy`) and sign
   in under the same Unix account that will run Keir. Provider selection is
   explicit; an unavailable provider fails instead of silently changing models.
3. Run `node bin/lakeside.js init --project /absolute/repo --route provider:model@medium`.
   This prompts for a password of at least 12 characters. Use `--password-stdin`
   only with input from a secure source, never a command containing the password.
4. Run `node bin/lakeside.js doctor`. It checks the actual registered project,
   config and provider availability without starting a model task.
5. Run `node bin/lakeside.js serve` and sign in at `http://127.0.0.1:9724`.

No MongoDB, Discord bot, Lakeside identity, API key or studio MCP is required.
Standalone is single-owner: browser, desktop, CLI and native sessions belong to
that installation's owner. It is not a shared multi-tenant service.

## Configuration and state

`init` creates private files under `$XDG_CONFIG_HOME/lakeside` (normally
`~/.config/lakeside`). `LAKESIDE_CONFIG_DIR` overrides that directory.

- `lakeside.json`: project registry, agent route and state directory.
- `portal.json`: portal origin, owner label and password hash. Passwords are
  salted with scrypt; the plaintext password is never saved.
- `client.json`: created by `lakeside login`, contains one origin-bound session.

State defaults to `$XDG_STATE_HOME/lakeside`, normally `~/.local/state/lakeside`.
It contains the harness SQLite database, durable portal ledger, notebook,
sessions and traces. Back it up separately from the checkout. Traces and
conversations are private and must never be committed.

Use [config/lakeside.example.json](../config/lakeside.example.json) as the
reference schema. Paths must be absolute. Unknown keys fail validation. A custom
registry replaces the built-in Lakeside registry; unknown projects never fall
back to a studio project. `LAKESIDE_STATE_DIR` overrides harness storage.

The CLI's public name is `lakeside`. The raw Rust binary remains `lakeside`
inside its build directory; services can locate it through `LAKESIDE_AGENT_BIN`.
Do not install the raw binary over the public CLI.

## Remote access

Set the actual HTTPS origin with `init --url https://keir.example.com`. For an
existing install, edit `origin` in private `portal.json`, restart, and sign clients
in again. The portal validates Host and Origin against this exact origin. The
reverse proxy must preserve Host and use HTTPS to clients. Bind the Node process
to loopback (the default); `PORT` selects a different listener port.

Example Caddy configuration:

```caddy
keir.example.com {
    reverse_proxy 127.0.0.1:9724
}
```

Configure a user service to run `node /path/to/lakeside-ops/bin/lakeside.js serve`
under the same Unix account and HOME used during init and provider sign-in.
Restarting the service preserves sessions and messages. An interrupted running
task becomes blocked and requires inspection before retrying.

## Your tools

Optional `mcp_config` is an absolute path to a Claude-style JSON file containing
`mcpServers.<name>.url`. Only local HTTP MCP servers are supported by this adapter.
Set `mcp_read_tools` to exact server/tool lists and supply a read-scoped
`LAKESIDE_MCP_TOKEN` through your service environment. Put server names and tool
schemas in your custom `brief_file` so the model knows how to call them.

```json
{
  "mcp_config": "/home/ops/.config/lakeside/mcp.json",
  "mcp_read_tools": { "metrics": ["health", "query_metrics"] },
  "brief_file": "/home/ops/.config/lakeside/brief.md"
}
```

These are additional fields in `lakeside.json`, not a complete config. The
server must enforce read scope too. Omit them for a repository-only agent.
`lakeside agent run --no-network ...` disables these MCP connections; it does
not remove the provider's own network requirement.

## Lakeside studio mode

Existing studio installations run `LAKESIDE_MODE=lakeside npm --prefix apps/web start`
with their existing dashboard configuration and installed component dependencies.
They continue to run the full operator from `apps/agent/operator.js` through
pinned releases. The consolidation does not restart or replace those services.
Legacy Discord/support integrations remain studio adapters, not independent
installation prerequisites. Keep the studio's local YAML and environment files
outside release source.

## Enable coding in the portal

The default portal grant is read-only. To enable reversible local code work,
create a clean registered Git worktree for the first configured project. Add
`"grant": "coding"` and `"worktree": "/absolute/path/to/worktree"` to private
`portal.json`, then restart the portal. The harness refuses the main checkout,
unregistered worktrees and dirty starting trees. Review and commit each result
before starting another coding task. No push, deployment or other external effect
adapter is added by this setting. The same Unix-account isolation guidance as
CLI coding applies.
