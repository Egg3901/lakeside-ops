# Contributing

## Principles

1. **Config over hardcoding** — projects, branding, paths, and feature toggles belong in `config/dashboard.yaml` or env vars.
2. **No box-specific paths** in source (`/root/...`, `/var/www/...`, `/srv/...`).
3. **No secrets in the tree** — use `.env` (gitignored).
4. **Prefer safe DOM** — use `src/ui/safeDom.js` (`OpsDom`) instead of raw `innerHTML` / `eval` / `new Function`.
5. **Async shell** — avoid `execSync`/`spawnSync` on request paths.

## Dev workflow

```bash
npm install
npm run test:unit
# full suite (existing node:test files):
npm test
```

Work on a branch/worktree; keep production `main` running until the phase is verified.

## Pull requests

- Reference the open-source plan: `plans/open-source-genericization-plan.md`
- Include a short test plan for any route/config change
- Semgrep CI must pass (`.github/workflows/semgrep.yml`)
