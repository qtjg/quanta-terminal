#!/bin/sh
# sync-check.sh — is the local working copy in sync with origin?
# Prints one verdict line: SYNCED / AHEAD n / BEHIND n / DIVERGED (a=n b=m) / NO-REMOTE.
# Exit codes: 0 synced, 1 out of sync, 2 usage/remote problems.

set -eu

REMOTE="${1:-origin}"
BRANCH=$(git rev-parse --abbrev-ref HEAD)

URL=$(git remote get-url "$REMOTE" 2>/dev/null) || { echo "NO-REMOTE — no '$REMOTE' configured"; exit 2; }

git fetch -q "$REMOTE" "$BRANCH" 2>/dev/null || { echo "DIVERGED (fetch failed for $REMOTE/$BRANCH — check network/credentials)"; exit 1; }

LOCAL=$(git rev-parse HEAD)
UPSTREAM=$(git rev-parse "$REMOTE/$BRANCH" 2>/dev/null || echo "")
DIRTY=$(git status --porcelain | wc -l | tr -d ' ')

if [ -z "$UPSTREAM" ]; then
  echo "NO-UPSTREAM — origin/$BRANCH does not exist yet (never pushed?)"
  exit 1
fi

if [ "$LOCAL" = "$UPSTREAM" ]; then
  echo "SYNCED — $BRANCH == $REMOTE/$BRANCH ($(git rev-parse --short HEAD))${DIRTY:+ — NOTE: $DIRTY uncommitted file(s)}"
  exit 0
fi

AHEAD=$(git rev-list --count "$REMOTE/$BRANCH..HEAD")
BEHIND=$(git rev-list --count "HEAD..$REMOTE/$BRANCH")

if [ "$AHEAD" -gt 0 ] && [ "$BEHIND" -gt 0 ]; then
  echo "DIVERGED — ahead $AHEAD, behind $BEHIND (another instance/workflow pushed). Rebase before push!"
  exit 1
fi
if [ "$AHEAD" -gt 0 ]; then
  echo "AHEAD $AHEAD — push pending"
  exit 1
fi
echo "BEHIND $BEHIND — pull before working"
exit 1
