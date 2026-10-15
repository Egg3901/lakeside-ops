#!/usr/bin/env bash
# Verify open-source genericization success criteria (local checks).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "== unit tests =="
npm run test:unit

echo "== src/ branding scrub =="
if rg -n "Lakeside|A House Divided|ahousedivided" src/ --glob '*.js' --glob '!*.test.js' ; then
  echo "FAIL: Lakeside/AHD strings still in src/" >&2
  exit 1
fi
echo "ok"

echo "== hardcoded absolute paths in app JS =="
if rg -n '["'\'']/(root|var/www|srv)/' --glob '*.js' -g '!node_modules' -g '!**/*.test.js' -g '!**/*-fixtures.js' -g '!mcp/**' -g '!scripts/**' -g '!config/**' -g '!plans/**' ; then
  echo "FAIL: hardcoded /root|/var/www|/srv paths remain" >&2
  exit 1
fi
echo "ok"

echo "== LICENSE + README =="
test -f LICENSE && test -f README.md && test -f docs/SELF_HOSTING.md
echo "ok"

echo "== example tenant config loads =="
node -e "
const fs=require('fs');const os=require('os');const path=require('path');
const {loadConfig,resetConfigCache}=require('./src/core/config');
const {listGames}=require('./src/services/projectRegistry');
resetConfigCache();
const cfg=loadConfig({configPath:path.join('config','dashboard.example.yaml'), force:true});
if(!cfg.projects || cfg.projects.length<1) throw new Error('no projects');
console.log('example tenant', cfg.tenant.shortName, 'projects', cfg.projects.map(p=>p.key).join(','));
"

echo "== feature flag gate symbols =="
rg -n 'featureDisabled\(\"(codeAgent|ideas|tickets|wikiExport|discordInsights|backups|dbBrowser|agentsPage|statusPage)\"\)' server.js >/dev/null
echo "ok"

echo "== innerHTML safety ratchet =="
node scripts/check-innerhtml.js

echo "All success-criteria checks passed."
