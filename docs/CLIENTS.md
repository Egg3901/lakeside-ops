# Clients

## Desktop Keir app

```sh
npm --prefix apps/desktop ci
npm run desktop
```

Enter your portal's HTTPS origin, then sign in with your installation password.
The desktop app opens directly into Keir's conversation and task workspace.
Each origin has a separate persistent browser session. Remote content has no
Node integration, preload bridge or filesystem access. Navigation and redirects
stay on the selected origin. The local connect screen exposes only server
selection. Use the Keir menu to connect to a different installation.

Run the manual **Desktop Keir** workflow to package macOS, Windows and Linux
artifacts, or `npm --prefix apps/desktop run dist` on the target OS. These are
unsigned development distributions unless your own signing is configured.
They are not silently uploaded to a store or release.

## iPhone and iPad

The native app needs Xcode 26 and XcodeGen. In `apps/ios/project.local.yml`:

```yaml
include: project.yml
settings:
  base:
    OPS_SERVER_URL: https://keir.example.com
```

Then, from `apps/ios`:

```sh
swift scripts/icons.swift
xcodegen generate --spec project.local.yml
bash scripts/simulator.sh LakesideOps
```

Use your own bundle identifiers and signing team for distributing your build.
The app pins requests to your configured HTTPS origin and isolates Keychain
credentials for independent hosts. Standalone mode shows Keir instead of studio
service tabs. The existing Lakeside TestFlight workflow and secrets stay attached
to the canonical GitHub repository.

## Command line

`npm link` installs the public `lakeside` command from the checkout.

```sh
lakeside init --project /path/to/repo --route provider:model@medium
lakeside doctor
lakeside serve
lakeside login --url https://keir.example.com
lakeside chat "Inspect the authentication module"
lakeside tasks
lakeside logout
```

Chat returns a durable job ID; use the portal or `tasks` to follow execution.
CLI sessions have the same seven-day expiry and logout revocation as browser
sessions. `--password-stdin` keeps secrets out of process arguments.

The lower-level harness is available through `lakeside agent`:

```sh
lakeside agent run --project my-project --prompt-file question.md --grant read --json
lakeside agent tasks
lakeside agent show ATTEMPT_ID
```

For coding, create a separate registered Git worktree, start with a clean tree,
and pass `--grant coding --cwd /path/to/worktree --role coder`. The actual diff
and execution trace are saved for review. Shell grants run with your Unix user's
authority. Worktree checks and command guards are not an OS security boundary;
use a dedicated account/container for untrusted code and do not expose secrets
to the worker environment.
