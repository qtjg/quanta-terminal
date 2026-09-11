#!/bin/bash
# Polls the AI lane every 120s (up to 60 min). On first 200, immediately runs
# the REAL /api/rizz end-to-end generate test and logs the outcome.
for i in $(seq 1 30); do
  ts=$(date '+%H:%M:%S')
  code=$(curl -s --noproxy '*' -o /tmp/qprobe2.json -w '%{http_code}' -X POST \
    http://127.0.0.1:3000/api/quanta/chat -H 'Content-Type: application/json' \
    -d '{"question":"reply with the single word: ok"}' --max-time 90)
  echo "[$ts] watch#$i HTTP:$code"
  if [ "$code" = "200" ]; then
    echo "[$ts] >>> AI LANE RECOVERED — running real /api/rizz e2e"
    rcode=$(curl -s --noproxy '*' -o /tmp/rizz-e2e.json -w '%{http_code}' -X POST \
      http://127.0.0.1:3000/api/rizz -H 'Content-Type: application/json' \
      -d '{"tweet":"Orange iPhone 17 Pro Max > Burgundy iPhone 17 Pro Max. I am not even open to debate.","mode":"reply","tone":"witty","length":"normal","count":3}' \
      --max-time 360)
    variants=$(python3 -c "import json;d=json.load(open('/tmp/rizz-e2e.json'));print(len(d.get('variants',[])),'variants — first:',(d.get('variants') or [d.get('error','?')])[0][:80])" 2>/dev/null)
    echo "[$ts] >>> E2E RESULT: HTTP:$rcode $variants"
    exit 0
  fi
  sleep 120
done
echo ">>> AI lane still dry after 60min of watching"
exit 1
