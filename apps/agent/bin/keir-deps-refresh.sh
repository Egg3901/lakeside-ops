#!/usr/bin/env bash
# Keep Keir's read-only sandbox dependency mirror on origin/main's lockfile.
# Runs detached from keir-operator when the lockfile changes; flock makes
# concurrent triggers a no-op.
set -euo pipefail
REPO=/root/projects/AHDGame
WT=$REPO/worktrees/keir-deps
exec 9>/run/keir-deps-refresh.lock
flock -n 9 || exit 0
git -C "$REPO" fetch --quiet origin main
want=$(git -C "$REPO" rev-parse origin/main:package-lock.json)
have=$(git -C "$WT" rev-parse HEAD:package-lock.json)
[[ "$want" == "$have" && -f "$WT/node_modules/.package-lock.json" ]] && exit 0
git -C "$WT" checkout --detach --quiet origin/main
cd "$WT"
HUSKY=0 timeout 1200 npm ci --no-audit --no-fund
echo "[keir-deps] refreshed to $(git -C "$WT" rev-parse --short HEAD)"
