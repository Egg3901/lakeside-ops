# Self-hosting the Ops Dashboard

This dashboard is **config-driven**. A fresh install needs:

1. Node.js 20+
2. A MongoDB URI (optional until you enable DB features)
3. `config/dashboard.yaml` (copy from `config/dashboard.example.yaml`)
4. `.env` (copy from `.env.example`)

## Quick start

```bash
cp config/dashboard.example.yaml config/dashboard.yaml
cp .env.example .env
# edit TENANT_*, PRIMARY_PROJECT_KEY, MONGODB_URI, OPS_PASSWORD_HASH / OPS_USERS
npm install
npm start
# → http://127.0.0.1:9724/api/health
```

## Configuration layers

| Layer | Purpose |
|-------|---------|
| `config/dashboard.yaml` | Tenant name, project registry, status probes, finder roots, feature defaults |
| `config/dashboard.local.yaml` | Gitignored local overrides |
| Environment variables | Secrets + path overrides; always win over YAML |

For deployments that replace the application directory, set `OPS_SESSIONS_FILE`
and `PUBLISHED_REPORTS_DIR` to persistent paths. This keeps sign-ins and
published reports available across releases.

Feature flags: set `ENABLE_CODE_AGENT=false` (etc.) or `features.codeAgent: false` in YAML.

## Paths

Never rely on box-specific defaults. Set:

- `BACKUP_DIR`
- `PROJECTS_ROOT` / `FINDER_ROOTS`
- `HERMES_SKILLS_DIR` / `PROJECT_SKILLS_DIR`
- `SANDBOX_DIR`

## SSO

Prefer `SSO_BASE_URL` + `SSO_INTERNAL_TOKEN`. The older `LAKESIDE_AUTH_*` names remain aliases for one release cycle.

## Docker (coming)

`Dockerfile` / `docker-compose.yml` land in a later phase. Until then, run under systemd or `node server.js` behind your reverse proxy.

## Security notes

- Keep `.env` and `.sessions.json` out of git (already gitignored).
- Prefer `OpsDom.setText` / `OpsDom.el` over `innerHTML` in new UI code.
- Semgrep rules live in `security/semgrep/ops-dash-rules.yml` and run in CI.
