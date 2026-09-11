#!/bin/sh
# contrib-stats.sh — per-author commit stats for this repository (or any repo).
# Uses the GitHub REST API; reads the token from GITHUB_TOKEN or the gh CLI config.
#
# usage: scripts/contrib-stats.sh [owner/repo] [sha-or-branch]
#   owner/repo   defaults to the origin of the current repository
#   ref          defaults to the repo's default branch

set -eu

REPO="${1:-}"
REF="${2:-}"

if [ -z "$REPO" ]; then
  REPO=$(node -e '
    const { execSync } = require("child_process");
    try {
      const url = execSync("git remote get-url origin", { encoding: "utf8" }).trim().replace(/\.git\/?$/, "");
      const m = url.match(/github\.com[:\/]([^\/]+)\/([^\/]+)$/);
      if (m) process.stdout.write(m[1] + "/" + m[2]);
    } catch {}
  ')
  [ -n "$REPO" ] || { echo "✖ pass owner/repo or run inside a repo with a GitHub origin" >&2; exit 2; }
fi

TOKEN="${GITHUB_TOKEN:-}"
AUTH=""
[ -n "$TOKEN" ] && AUTH="Authorization: Bearer $TOKEN"

[ -n "$REF" ] || REF=$(curl -fsSL ${AUTH:+-H "$AUTH"} "https://api.github.com/repos/$REPO" | node -e '
  let d = ""; process.stdin.on("data", (c) => (d += c)).on("end", () => {
    try { process.stdout.write(JSON.parse(d).default_branch || "main"); } catch { process.stdout.write("main"); }
  });
')

echo "▲ contrib stats for $REPO@$REF (first 100 commits)"
echo

curl -fsSL ${AUTH:+-H "$AUTH"} "https://api.github.com/repos/$REPO/commits?sha=$REF&per_page=100" | node -e '
  let d = "";
  process.stdin.on("data", (c) => (d += c)).on("end", () => {
    let list;
    try { list = JSON.parse(d); } catch { console.error("✖ bad API response"); process.exit(1); }
    if (!Array.isArray(list)) { console.error("✖ API error:", (list && list.message) || d.slice(0, 120)); process.exit(1); }
    const byAuthor = new Map();
    const byEmail = new Map();
    for (const c of list) {
      const login = c.author && c.author.login || (c.commit && c.commit.author && c.commit.author.name) || "(unknown)";
      const email = c.commit && c.commit.author && c.commit.author.email || "?";
      byAuthor.set(login, (byAuthor.get(login) || 0) + 1);
      byEmail.set(email, (byEmail.get(email) || 0) + 1);
    }
    console.log("  by GitHub login:");
    [...byAuthor.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`    ${String(v).padStart(4)}  ${k}`));
    console.log("\n  by author email (graph counts need a linked email):");
    [...byEmail.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`    ${String(v).padStart(4)}  ${k}`));
    console.log("\n  graph rules: linked email + non-fork repo + default branch.");
    console.log("  linked noreply format: <id>+<login>@users.noreply.github.com");
  });
'
