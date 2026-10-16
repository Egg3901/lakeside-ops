# Lakeside Code changelog

## Unreleased

- Add `lakeside code update` and `--check` for Windows and WSL packaged installs, with checksum verification, configurable release repository, preview/stable channels and pinned rollback tags. Preserve user configuration and require GitHub authentication for private releases.

## 0.1.3 (experimental, not released)

- Add configurable optional remote profiles: generic MCP or Keir deployments, token-file references, bearer/cookie authentication and connection names, preserving standalone coding and existing provider configuration.
- Add owner-authenticated Keir desktop read capabilities, shared knowledge/skills, task coordination, redacted environment inspection and server-side Sentry reads.
- Configure or disable default bundled skills while retaining on-demand skills.
- Prevent logo rows from shrinking, show a clear compact mountain and display remote setup status.

- Start outside a repository and load multiple project contexts during a session. API tools and native local commands retain scoped instructions across resume; native file access includes explicitly loaded project roots.

- Translate local Windows checkout paths in WSL with `wslpath`, preserving project aliases and remote directory semantics.
- Authenticate Keir peers with the owner session cookie expected by the live gateway; reject malformed session tokens.
- Poll VPS task metadata without repeatedly downloading private conversation history.
- Add `/reconnect`, connection latency and expired-session guidance for VPS peers.
- Retain clearly stale task snapshots across connection drops; credential changes or access failures clear them. Reconnect never resubmits work.

- Add explicitly selected API or native ACP backends, with Claude/Codex/Gemini adapter presets.
- Add a separate native conversation view and authenticated loopback bridge.
- Persist native prompt intent and ids, deduplicate retries, and retain uncertain outcomes.
- Add native permission forwarding, project file access, scoped skill reads, resume and explicit task transfer.
- Typecheck transport, storage, permissions, lifecycle and native workflow contracts.
- Native vendor acceptance, automated native UI coverage, Windows backend validation and release readiness remain pending.

## 0.1.2 (preview)

- Split terminal views, workflow policy, recovery storage and MCP configuration into focused modules.
- Add a compact logo, Lakeside session composer, workspace actions and terminal titles.
- Add live repository diff, recorded command outputs, resume and MCP connection views.
- Add opt-in GitHub, kanban and ticket workflow guidance, plus durable recovery tools shared across model changes.
- Add secure MCP configuration with environment credential references and missing-credential handling.
- Add five first-party design skills covering systems, UX, accessibility, terminals and rendered reviews.
- Strictly typecheck workflow/storage/connection contracts and validate persisted inputs at runtime.

## 0.1.1

- Bare `lakeside` opens coding in the current folder; explicit `lakeside code` remains available.
- Accept absolute Windows worktree paths when configuring peer agents.
- Check the native PowerShell installer, engine, skills and terminal on Windows CI.
- Exercise preview and coding home through the Windows ConPTY interface.

## 0.1.0 (prototype)

- Installable coding CLI with its own pinned OpenCode engine and startup checks.
- Mountain/lake identity, blue/steel-grey terminal, useful project shortcuts and
  responsive Changes, Review and Checks preview.
- Configured Keir and OpenCode peer inspection, scoped task submission and results.
- Durable handoff history, conservative recovery and confirmed cancellation.
- `doctor`, `peers` and `handoffs` commands plus in-session coordination tools.
- Package installation and actual engine/plugin validation in CI.

- Bundle Keir’s Ponytail, review, debugging, TDD, verification and frontend skills, including references, licenses and native slash commands.
