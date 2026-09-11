#!/bin/sh
# verify-attribution.sh — make sure every commit on the default branch is
# attributed to the GitHub account that should get graph credit.
#
# usage: scripts/verify-attribution.sh [expected-email] [remote]
#   expected-email  defaults to GIT_AUTHOR_EMAIL / GIT_COMMITTER_EMAIL env,
#                   or the repo-local git config user.email
#   remote          defaults to origin

set -eu

EXPECTED="${1:-}"
REMOTE="${2:-origin}"

if [ -z "$EXPECTED" ]; then
  EXPECTED="${GIT_COMMITTER_EMAIL:-$(git config user.email || true)}"
fi
[ -n "$EXPECTED" ] || { echo "✖ no expected email — pass one or set git config user.email" >&2; exit 2; }

DEFAULT_BRANCH=$(git remote show "$REMOTE" 2>/dev/null | sed -n 's/.*HEAD branch: //p' || echo main)
SHA="${REMOTE}/${DEFAULT_BRANCH}"

git fetch -q "$REMOTE" "$DEFAULT_BRANCH" 2>/dev/null || true

echo "▲ verifying attribution on $SHA (expecting author email: $EXPECTED)"
echo

BAD=$(git log "$SHA" --format='%H%x09%ae%x09%ce%x09%s' -100 | awk -v e="$EXPECTED" '$2 != e || $3 != e')

if [ -z "$BAD" ]; then
  echo "  ✔ last 100 commits: author & committer email all match"
  exit 0
fi

echo "  ✖ commits NOT attributed to $EXPECTED:"
echo "$BAD" | while IFS='	' read -r h ae ce s; do
  printf '    %s  author=%s committer=%s  %s\n' "${h#???????}" "$ae" "$ce" "$s"
done
echo
echo "fix: git config user.name / user.email, then rewrite history"
echo "     (git filter-branch --env-filter or git rebase --exec 'git commit --amend --reset-author')"
exit 1
