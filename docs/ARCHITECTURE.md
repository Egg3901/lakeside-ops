# Architecture

`lakeside serve` starts the standalone portal with the installation's private
configuration. It does not import the full studio `server.js` or `operator.js`.

```text
Web / Desktop / iOS / CLI
          |
          | owner session, pinned origin
          v
Standalone portal (apps/web/portal)
          |
          | authenticated in-process dispatch
          v
Keir conversation + durable task store (apps/agent)
          |
          | bounded subprocess, explicit route and read grant
          v
Rust harness -> provider CLI -> per-attempt tool endpoint
          |
          v
Registered project + explicitly allowed local read tools
```

The standalone runtime reuses the app-channel protocol, thread/task views,
ledger and notebook. It serializes activations, deduplicates message retries,
aborts active subprocesses on cancellation, suppresses late cancelled replies,
and records a restart-interrupted task as blocked. It never automatically retries
an interrupted task. Actual provider output, not an accepted queue entry, marks
a task completed.

Local auth uses scrypt password hashes, random seven-day sessions stored as
SHA-256 hashes, HTTP-only same-site cookies and an explicit portal origin.
Mutations check Origin; non-browser JSON requests can authenticate through the
same session token. Logout revokes the token. Studio SSO is not loaded.

Desktop uses an origin-specific Electron session, sandbox and context isolation.
Remote content gets no Node or preload API. iOS uses the same native app protocol
with an installation-specific HTTPS URL and a separate Keychain credential per
independent host. Its capability response hides studio-only surfaces.

`lakeside agent` exposes the lower-level task runner for explicit coding and
other bounded work. The portal intentionally starts with a read grant. New
external-effect adapters need explicit authority, reviewable inputs and durable
receipts; adding a tool name to a prompt does not grant authority.

Lakeside mode retains existing studio code and integrations under the component
directories. Its services keep their pinned releases until a separate tested
release cutover. The monorepo is the source location, not an instruction to
restart a running service.
