// Brain v4 ASK-LOCK test — the exact field-report scenario from MAYANK's screenshot
const BASE = "http://127.0.0.1:3000";

const FULL =
  "Building in public is free advertisement for your startup\n\nDrop your link below 👇\n\ni'll tell you in one sentence what you should be posting about.";
// What the v0.7.0 panel actually captured (screenshot) — ask missing entirely
const TRUNCATED =
  "Building in public is free advertisement for your startup\n\nDrop your link below";

// Generic-pivot detector: does any variant ask a question that ignores the ask?
function pivotHit(v) {
  const bad =
    /(most excited about (building|sharing)|what are you (building|working on)|what.*(excit\w+|building) right now|your strategy for what to share|what's working for you)/i;
  return bad.test(v);
}
// JOIN detector: first sentence participates in the invite in first person
function joinHit(v) {
  return /(mine|my link|dropping|link below|in the (replies|bio|line|queue)|^in\b|\bin\b.*👀|👇|hit me|one sentence|one-liner|count me|adding mine|here's mine|rizzreply|ready)/i.test(
    v.split(/[.!?]/)[0]
  );
}

async function run(label, tweet, extra = {}) {
  const t0 = Date.now();
  const r = await fetch(`${BASE}/api/rizz`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tweet,
      mode: "reply",
      tone: "auto",
      author: "uriel_builds",
      count: 3,
      ...extra,
    }),
  });
  const j = await r.json().catch(() => null);
  console.log(`\n=== ${label} (${((Date.now() - t0) / 1000).toFixed(1)}s, status ${r.status}) ===`);
  if (!j || !j.variants) return console.log("ERROR:", j && j.error);
  let joins = 0;
  j.variants.forEach((v, i) => {
    const pivot = pivotHit(v);
    const join = joinHit(v);
    if (join) joins++;
    console.log(
      `  [${i + 1}]${pivot ? " ❌PIVOT" : ""}${join ? " ✅joins" : " ➖no-join"} | ${v}`
    );
  });
  if (label.startsWith("CONTROL")) {
    console.log(`  → CONTROL (info only): ${joins}/3 joined-style, questions legal here`);
    return;
  }
  console.log(
    joins >= 2 && joins === j.variants.filter((v) => !pivotHit(v)).length
      ? `  → ASK-LOCK PASS (${joins}/3 join, 0 pivot)`
      : `  → ASK-LOCK FAIL (${joins}/3 join)`
  );
}

await run("FULL tweet (v0.8.1 extension will send this)", FULL);
await run("TRUNCATED tweet (v0.7.0 bug — Brain must still engage 'drop your link')", TRUNCATED);
await run("FULL + bio (MAYANK's real setup once 🧠 is filled)", FULL, {
  bio: "Building RizzReply — AI reply copilot for X",
});
await run("CONTROL: tweet with NO explicit ask (smart question must stay legal)", "Shipped our new landing page today. 3 weeks of nights and weekends. Still not sure if the hero copy lands.");
