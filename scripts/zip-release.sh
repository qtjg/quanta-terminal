#!/bin/sh
# zip-release.sh — build a release zip of quanta-terminal sources (no build
# artifacts, no node_modules, no media screenshots) into download/.
#
# usage: scripts/zip-release.sh [version]
#   version defaults to the version field of package.json

set -eu

cd "$(dirname "$0")/.."

VERSION="${1:-$(node -e 'console.log(require("./package.json").version)')}"
OUT="download"
NAME="quanta-terminal-${VERSION}.zip"

mkdir -p "$OUT"

# zip is optional — fall back to tar.gz when zip is missing
if command -v zip >/dev/null 2>&1; then
  zip -qr "$OUT/$NAME" . \
    -x "node_modules/*" ".next/*" ".git/*" "download/*" "upload/*" "scripts/*.png" \
       "dev.log" "server.log" "*.tsbuildinfo" "android-sdk/*" "tool-results/*"
  echo "✔ built $OUT/$NAME ($(du -h "$OUT/$NAME" | cut -f1))"
else
  NAME="quanta-terminal-${VERSION}.tar.gz"
  tar -czf "$OUT/$NAME" \
    --exclude="node_modules" --exclude=".next" --exclude=".git" --exclude="download" \
    --exclude="upload" --exclude="*.png" --exclude="dev.log" --exclude="server.log" \
    --exclude="*.tsbuildinfo" --exclude="android-sdk" --exclude="tool-results" .
  echo "✔ built $OUT/$NAME (zip not installed — tar fallback, $(du -h "$OUT/$NAME" | cut -f1))"
fi
