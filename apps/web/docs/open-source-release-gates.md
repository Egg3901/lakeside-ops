# Public repository release gates

Checked after the v4 production cutover on 2026-09-23. Keep the existing repository private until all gates below pass. A public export must start with a **new git history**: the private history contains an old credential-shaped MongoDB example that was replaced in PR #172.

## Current results

- `npm test`: 550 tests passed after the broader v4 UX pass. Rerun before export.
- `npm run verify:opensource`: unit tests, production `src/` branding, configured path defaults, documentation files, example tenant config, feature gates, and the HTML safety ratchet pass. The hardcoded path check excludes test-only visual fixtures.
- `node scripts/check-innerhtml.js`: 52 runtime interpolation sites meet the current budget of 52. The script is a source heuristic and can miss dynamic HTML assembled outside an assignment. A passing budget is not a public-release security review. Continue auditing API and WebSocket data paths, especially generated markup helpers and URLs.
- A scan of 425 tracked files for common token, private-key, JWT, and URI-with-userinfo shapes found one credential-shaped MongoDB example and three obvious test/documentation examples. The MongoDB example was replaced in PR #172. This scan does not prove the tree contains no secrets.
- `public/lakeside-landing.html`, `public/lakeside-mark.svg`, `config/code-agent-ahd.md`, and the tenant-specific `config/dashboard.yaml` still contain Lakeside assets or configuration. The public export needs a generic config and an explicit allowlist.

## Release steps

1. Keep tenant-specific paths in config/env values. Recheck every new production file with `npm run verify:opensource`.
2. Remove or safely construct the remaining dynamic HTML and review WebSocket/API data paths manually. Lower the ratchet as findings are resolved; do not treat its current budget as proof of safety.
3. Verify a fresh clone with only `dashboard.example.yaml` and `.env.example`, including the Docker path and three configured projects.
4. Build a clean-history, allowlisted public export. Exclude private reports, tenant configuration, local runtime data, and Lakeside assets. Scan the export again before publication.
5. Publish only that verified export; do not flip the current private repository to public because its history retains the removed connection string.
