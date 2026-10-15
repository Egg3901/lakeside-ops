# Lakeside Ops

**Keir for your own stack.** A private agent workspace across the web, desktop,
iPhone, iPad and the `lakeside` command line.

One repository, two deployment modes:

| Mode | Experience | Authentication |
| --- | --- | --- |
| Standalone | Keir conversations, project investigation, task history and cancellation | Your installation's local owner account |
| Lakeside | Studio dashboard, support desk and configured game services | Existing studio auth and role checks |

Standalone is the default for a new installation. It does not start Lakeside
services, load their routes, connect to their databases, or require Lakeside SSO.
The desktop client opens the Keir agent workspace, not the studio dashboard.

## Get started

The agent server currently targets **Linux**, Node.js 22+, Rust 1.91+, Git and
GNU `timeout`. The harness keeps a 6 GiB available-memory floor. Install and sign
in to a supported provider CLI on the server first. Desktop clients run on
macOS, Windows and Linux; iOS builds need macOS and Xcode.

```sh
git clone https://github.com/lakesidegamedev/lakeside-ops.git
cd lakeside-ops
npm run build:agent
# Replace the route with a provider/model available to your subscription.
node bin/lakeside.js init --project /absolute/path/to/your/repo --route 'provider:model@medium'
node bin/lakeside.js doctor
node bin/lakeside.js serve
```

`init` prompts for a password without echoing it. Visit <http://127.0.0.1:9724>.
There are no mandatory npm dependencies for the standalone server. Use
`npm link` if you want `lakeside` on your PATH; otherwise `node bin/lakeside.js`
works for every command.

For a remote server, pass `--url https://keir.your-domain.example` to `init` and
put an HTTPS reverse proxy in front of the loopback listener. Keep provider
logins, configuration and state on your own server. Nothing connects to a
Lakeside account or service in standalone mode.

See [installation](docs/INSTALL.md), [clients and CLI](docs/CLIENTS.md),
[architecture](docs/ARCHITECTURE.md), and [migration](docs/MIGRATION.md).

## Repository

| Directory | Contents |
| --- | --- |
| `apps/web` | Keir portal and optional studio dashboard |
| `apps/agent` | Keir runtime, policy modules and Rust task harness |
| `apps/desktop` | Desktop Keir app with isolated sessions per server |
| `apps/ios` | Native SwiftUI app and shared protocol package |
| `bin` | `lakeside` setup, portal, auth and task commands |
| `config` | Public setup examples; actual configuration stays outside Git |
| `docs` | Installation, architecture and contribution guidance |

## Current boundaries

Standalone uses the real Keir conversation/task store and Rust provider harness.
Portal tasks currently receive a **read grant** over the first configured
project, plus any explicitly configured read-only MCP integrations. Coding work
is available through `lakeside agent run --grant coding --cwd <registered-worktree>`.
Tasks cannot publish, deploy or modify external systems through the standalone
portal. Studio-specific approval adapters, scheduled watches, push delivery,
goals and feed are not advertised as standalone capabilities.

The iOS app uses the server's capability response to hide studio sections. Set
its server URL before building for your own installation. Desktop connects to
your chosen server at first launch. Both use the same portal account.

## Development

```sh
npm test
node --test apps/desktop/policy.test.js
npm --prefix apps/agent ci && npm run test:agent
npm --prefix apps/web ci && npm run test:web
npm run test:rust
# On macOS:
swift test --package-path apps/ios/Core
```

CI checks the standalone portal, authentication, agent, web regressions, Rust,
source secrets and the iOS app. Desktop packaging is a separate manual workflow.
See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## License

Source available with permission to build, privately modify and self-host for
your own operations. See [LICENSE.md](LICENSE.md). The imported dashboard keeps
its [MIT license](apps/web/LICENSE), and vendored components retain their licenses.
