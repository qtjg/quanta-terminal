/*
 * Live E2E of the /rizz/batch page loop (Task 72).
 * Simulates EXACTLY what the batch page does per item:
 *   1. POST /api/rizz/fetch  {url: id}          -> tweet text + author
 *   2. POST /api/rizz/thread {url: id}          -> parents (slice(0,-1), last 2)
 *   3. POST /api/rizz {tweet, mode:reply, tone:auto, length:normal, author,
 *                      thread, style}            -> variants (+ nextMove)
 * The parallel pass was upstream-quota-gated when it tried this — this run
 * proves (or breaks) the full loop end-to-end.
 */
const BASE = "http://127.0.0.1:3000";

const TARGETS = ["20", "2098041301530706352"]; // jack's first tweet + a live one

const j = async (path, body) => {
  const r = await fetch(path === "rizz" ? `${BASE}/api/rizz` : `${BASE}/api/rizz/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let d;
  try {
    d = await r.json();
  } catch {
    d = { parseError: true };
  }
  return { status: r.status, d };
};

let pass = 0;
let fail = 0;

for (let i = 0; i < TARGETS.length; i++) {
  const id = TARGETS[i];
  console.log(`\n=== ITEM #${i + 1} (id ${id}) ===`);

  // step 1: fetch
  const f = await j("fetch", { url: id });
  if (!f.status || f.status !== 200 || !f.d.ok || !f.d.text) {
    console.log(`  FETCH  ✗ (${f.status}) ${JSON.stringify(f.d).slice(0, 160)}`);
    fail++;
    continue;
  }
  const tweetText = f.d.text.slice(0, 1200);
  const author = f.d.author || "";
  console.log(
    `  FETCH  ✓ author=${author || "-"} text="${tweetText.slice(0, 90).replace(/\n/g, " ")}…"`
  );

  // step 2: thread (silent best effort)
  let threadCtx = [];
  try {
    const t = await j("thread", { url: id });
    if (t.status === 200 && t.d.ok && Array.isArray(t.d.chain)) {
      threadCtx = t.d.chain
        .slice(0, -1)
        .map((c) => ({ author: String(c.author || ""), text: String(c.text || "") }))
        .filter((c) => c.text)
        .slice(-2);
    }
  } catch {
    /* single-tweet mode */
  }
  console.log(`  THREAD ✓ parents=${threadCtx.length}`);

  // step 3: generate (batch page body shape)
  const g = await j("rizz", {
    tweet: tweetText,
    mode: "reply",
    tone: "auto",
    length: "normal",
    author,
    thread: threadCtx,
    style: "",
  });
  if (g.status !== 200 || !Array.isArray(g.d.variants) || !g.d.variants.length) {
    console.log(
      `  GEN    ✗ (${g.status}) ${String(g.d.error || JSON.stringify(g.d)).slice(0, 200)}`
    );
    fail++;
    continue;
  }
  console.log(`  GEN    ✓ ${g.d.variants.length} variants`);
  g.d.variants.forEach((v, k) =>
    console.log(`    v${k + 1}: ${v.slice(0, 110).replace(/\n/g, " ")}`)
  );
  if (g.d.nextMove) console.log(`    👉 nextMove: ${g.d.nextMove}`);
  pass++;
}

console.log(`\n=== RESULT: ${pass}/${TARGETS.length} items full-loop OK, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
