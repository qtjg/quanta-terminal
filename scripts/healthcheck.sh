#!/bin/sh
# quanta-terminal local healthcheck — probe the dev/prod server the same way
# the production keep-alive does. Exit 0 = healthy, 1 = down.
#
# usage: scripts/healthcheck.sh [url] [timeout-seconds]
#   url    defaults to http://127.0.0.1:3000/
#   exit codes: 0 healthy · 1 unhealthy · 2 bad arguments

URL="${1:-http://127.0.0.1:3000/}"
TIMEOUT="${2:-10}"

case "$URL" in
  http://* | https://*) ;;
  *) echo "✖ url must start with http:// or https:// (got: $URL)" >&2; exit 2 ;;
esac

CODE=$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' --max-time "$TIMEOUT" "$URL" 2>/dev/null)

if [ "$CODE" = "200" ]; then
  echo "OK $CODE — app healthy at $URL"
  exit 0
fi

echo "DOWN $CODE — app not healthy at $URL"
echo "hint: (setsid nohup bun run dev > /dev/null 2>&1 &) ; sleep 15; then re-run this check" >&2
exit 1
