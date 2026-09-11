/*
 * RizzReply brain v4.1 regression — hook mode + opinion tweet.
 * Usage: node scripts/rizz_brain_regression.mjs
 */
const BASE = process.env.RIZZ_BASE || "http://127.0.0.1:3000";

async function ask(body) {
  const res = await fetch(`${BASE}/api/rizz`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

console.log("=== regression: hook mode (own draft) ===");
const hook = await ask({
  tweet:
    "just crossed 1000 users on my side project. huge thanks to everyone who tried it early and broke things so I could fix them. more coming.",
  mode: "hook",
  tone: "hype",
  length: "short",
  count: 3,
});
if (hook.variants) hook.variants.forEach((v, k) => console.log(`  v${k + 1}: ${v}`));
else console.log("ERROR:", JSON.stringify(hook));

console.log("\n=== regression: opinion tweet (no ask) ===");
const opinion = await ask({
  tweet:
    "Hot take: most startups don't die from competition, they die from founders quitting too early.",
  mode: "reply",
  tone: "auto",
  author: "paulg",
  count: 3,
  length: "normal",
});
if (opinion.variants) opinion.variants.forEach((v, k) => console.log(`  v${k + 1}: ${v}`));
else console.log("ERROR:", JSON.stringify(opinion));
