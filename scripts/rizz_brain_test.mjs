/*
 * RizzReply brain relevance test (Task 68).
 * Fires question-type tweets at /api/rizz and prints the variants so we can
 * judge on-topic-ness before/after the prompt v4 fix.
 * Usage: node scripts/rizz_brain_test.mjs [baseline|fixed]
 */
const BASE = process.env.RIZZ_BASE || "http://127.0.0.1:3000";

const CASES = [
  {
    id: "en-question-language",
    author: "levelsio",
    tweet:
      "Serious question: what's the best programming language to learn in 2026 if you want to ship fast as a solo dev? Not for jobs, for building.",
  },
  {
    id: "en-question-remote",
    author: "dhh",
    tweet:
      "Remote work 3 years in: my focus is shot, my coffee bill is doubled, my dog is my closest colleague. How is everyone else actually surviving this?",
  },
  {
    id: "hinglish-question",
    author: "kunalb11",
    tweet:
      "Bhai MVP launch se pehle kaun sa analytics tool use karna chahiye? Simple wala batao, overkill nahi chahiye. Suggestions?",
  },
  {
    id: "en-invite",
    author: "XDevelopers",
    tweet:
      "Drop a link to the last thing you shipped. Reply with your project, I'll retweet the 10 best ones tomorrow.",
  },
];

const TONES = ["auto", "auto", "witty", "auto"]; // mirror real FULL AUTO usage

async function ask(c, tone) {
  const res = await fetch(`${BASE}/api/rizz`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tweet: c.tweet,
      mode: "reply",
      tone,
      author: c.author,
      count: 3,
      length: "normal",
    }),
  });
  const j = await res.json();
  return j;
}

const label = process.argv[2] || "run";
const onlyId = process.argv[3] || null; // optional: run one case by id
const cases = onlyId ? CASES.filter((c) => c.id === onlyId) : CASES;
const tonesMap = Object.fromEntries(CASES.map((c, i) => [c.id, TONES[i]]));
console.log(`\n=== RizzReply brain relevance test — ${label} ===`);
for (const c of cases) {
  const tone = tonesMap[c.id];
  const j = await ask(c, tone);
  console.log(`\n--- [${c.id}] tone=${tone} status=${res_ok(j)}`);
  if (!j.variants) {
    console.log("ERROR:", JSON.stringify(j));
    continue;
  }
  j.variants.forEach((v, k) => console.log(`  v${k + 1}: ${v}`));
}

function res_ok(j) {
  return j.variants ? "ok" : "FAIL";
}
