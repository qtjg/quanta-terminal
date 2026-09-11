#!/bin/bash
# Measures how long the z-ai builtin lane stays 429 — polls every 30s, max 12 min.
# Logs each probe result with timestamp to stdout.
for i in $(seq 1 24); do
  ts=$(date '+%H:%M:%S')
  code=$(curl -s --noproxy '*' -o /tmp/qprobe.json -w '%{http_code}' -X POST \
    http://127.0.0.1:3000/api/quanta/chat -H 'Content-Type: application/json' \
    -d '{"question":"reply with the single word: ok"}' --max-time 90)
  ok=$(python3 -c "import json;d=json.load(open('/tmp/qprobe.json'));print('OK' if d.get('ok') else d.get('error','?')[:60])" 2>/dev/null)
  echo "[$ts] probe#$i HTTP:$code $ok"
  if [ "$code" = "200" ]; then
    echo "[$ts] >>> QUOTA RECOVERED at probe#$i"
    exit 0
  fi
  sleep 30
done
echo ">>> quota still busy after 12min of probes"
exit 1
