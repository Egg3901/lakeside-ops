#!/usr/bin/env bash
# Periodic Semgrep security audit. Runs the Semgrep OSS engine via Docker
# (license-clean on private code), summarizes by severity, posts to Discord.
# Never gates — it's an audit. Usage: run-audit.sh [REPO_PATH]
set -uo pipefail
REPO="${1:-/root/a-house-divided}"
OUT_DIR="/var/lib/ahd-semgrep"; mkdir -p "$OUT_DIR"
TS=$(date -u +%Y%m%dT%H%M%SZ)
JSON="$OUT_DIR/results-$TS.json"; LATEST="$OUT_DIR/latest.json"
RULES_DIR="$(cd "$(dirname "$0")" && pwd)"
WEBHOOK=$(grep -m1 '^DISCORD_OPS_WEBHOOK_URL=' /root/ahd-ops-dashboard/.env 2>/dev/null | cut -d= -f2- | tr -d '"')

echo "[semgrep] scanning $REPO -> $JSON"
nice -n 15 docker run --rm --memory 3g \
  -v "$REPO":/src:ro -v "$RULES_DIR":/rules:ro \
  semgrep/semgrep semgrep scan \
    --config=p/security-audit --config=p/secrets --config=p/owasp-top-ten \
    --config=/rules/ahd-rules.yml \
    --metrics=off --json --quiet --timeout 90 /src > "$JSON" 2>/dev/null
cp -f "$JSON" "$LATEST" 2>/dev/null

python3 - "$JSON" "${WEBHOOK:-}" "$REPO" <<'PY'
import sys, json, collections, urllib.request
path, webhook, repo = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    data = json.load(open(path))
except Exception:
    print("[semgrep] no parseable results"); sys.exit(0)
results = data.get("results", [])
sev = collections.Counter(r.get("extra", {}).get("severity", "INFO") for r in results)
byrule = collections.Counter(r.get("check_id", "?").split(".")[-1] for r in results)
errors, warns, info = sev.get("ERROR", 0), sev.get("WARNING", 0), sev.get("INFO", 0)
top = "\n".join(f"• {n}× `{rid}`" for rid, n in byrule.most_common(6))
print(f"[semgrep] {len(results)} findings — {errors} error / {warns} warning / {info} info")
print(top or "  (clean)")
if webhook:
    icon = "🔴" if errors else ("🟠" if warns else "🟢")
    content = f"{icon} **Semgrep audit — {repo}**\n**{len(results)}** findings · {errors} error / {warns} warning / {info} info\n{top or 'clean ✓'}"
    try:
        req = urllib.request.Request(webhook, data=json.dumps({"content": content[:1900]}).encode(), headers={"Content-Type": "application/json", "User-Agent": "ahd-semgrep/1.0"})
        urllib.request.urlopen(req, timeout=10); print("[semgrep] posted to Discord")
    except Exception as e:
        print("[semgrep] discord post failed:", e)
PY
echo "[semgrep] done."
