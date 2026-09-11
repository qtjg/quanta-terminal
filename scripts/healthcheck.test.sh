#!/bin/sh
# scripts/healthcheck.test.sh — self-test for scripts/healthcheck.sh.
# Spins throwaway HTTP servers on random ports and asserts exit codes + output.

set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$ROOT/scripts/healthcheck.sh"
FAILED=0

check() {
  if [ "$2" = "$3" ]; then
    echo "  ✔ $1"
  else
    echo "  ✖ $1 (expected: $2, got: $3)"
    FAILED=1
  fi
}

start_server() { # $1=http_code → prints "port pid"
  node -e "
    const http = require('http');
    const code = Number(process.argv[1]);
    const srv = http.createServer((req, res) => { res.writeHead(code, {'Content-Type':'text/plain'}); res.end('probe'); });
    srv.listen(0, '127.0.0.1', () => { console.log(srv.address().port); });
    const t = setTimeout(() => process.exit(0), 15000);
    process.on('SIGTERM', () => { clearTimeout(t); process.exit(0); });
  " "$1" 2>/dev/null
}

# --- healthy server (200) ---
OUT=$(start_server 200)
PORT=$(echo "$OUT" | head -1)
SRV_PID=""
# node one-shot above exits after 15s; re-spawn a persistent one for the request window
node -e "
  const http = require('http');
  const srv = http.createServer((req, res) => { res.writeHead(200); res.end('probe'); });
  srv.listen($PORT, '127.0.0.1', () => {});
  setTimeout(() => process.exit(0), 8000);
" &
SRV_PID=$!
sleep 0.5

sh "$SCRIPT" "http://127.0.0.1:$PORT/" >/dev/null 2>&1
check "200 server → exit 0" 0 $?
sh "$SCRIPT" "http://127.0.0.1:$PORT/" 2>/dev/null | grep -q "^OK 200"
check "200 server → OK line" 0 $?
kill $SRV_PID 2>/dev/null
wait $SRV_PID 2>/dev/null

# --- unhealthy server (500) ---
node -e "
  const http = require('http');
  const srv = http.createServer((req, res) => { res.writeHead(500); res.end('nope'); });
  srv.listen(0, '127.0.0.1', () => console.log(srv.address().port));
  setTimeout(() => process.exit(0), 8000);
" > /tmp/hc500.port &
SRV_PID=$!
sleep 0.5
PORT500=$(cat /tmp/hc500.port | head -1)
sh "$SCRIPT" "http://127.0.0.1:$PORT500/" >/dev/null 2>&1
check "500 server → exit 1" 1 $?
kill $SRV_PID 2>/dev/null
wait $SRV_PID 2>/dev/null
rm -f /tmp/hc500.port

# --- dead port (connection refused) ---
sh "$SCRIPT" "http://127.0.0.1:1/" >/dev/null 2>&1
check "dead port → exit 1" 1 $?

# --- bad argument ---
sh "$SCRIPT" "ftp://nope/" >/dev/null 2>&1
check "non-http url → exit 2" 2 $?

if [ "$FAILED" = "0" ]; then
  echo "healthcheck tests: ALL PASSED ✅"
  exit 0
fi
echo "healthcheck tests: FAILED ❌"
exit 1
