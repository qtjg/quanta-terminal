#!/bin/sh
# repo-audit.sh — one command health & hygiene report for a repo working copy.
# Runs the ops trio: sync-check (drift), verify-attribution (graph credit),
# healthcheck (app up). Non-fatal per section; overall exit reflects failures.
#
# usage: scripts/repo-audit.sh [url-for-healthcheck]

set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

FAILED=0

echo "════ repo audit — $(date -u '+%Y-%m-%d %H:%M:%SZ') ════"
echo

echo "── 1/3 git sync ──"
sh scripts/sync-check.sh || FAILED=1
echo

echo "── 2/3 commit attribution ──"
sh scripts/verify-attribution.sh || FAILED=1
echo

echo "── 3/3 app health ──"
sh scripts/healthcheck.sh "${1:-http://127.0.0.1:3000/}" || FAILED=1
echo

if [ "$FAILED" = "0" ]; then
  echo "AUDIT PASS ✅"
  exit 0
fi
echo "AUDIT: 1+ section(s) failed — see above ❌"
exit 1
