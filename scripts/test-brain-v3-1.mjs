/*
 * Brain v3.1 regression — autopilot pack (v0.7.0)
 * 1. tone:"auto" accepted, 3 variants
 * 2. agent preset directive (funny) steers output
 * 3. custom agent directive verbatim
 * 4. backward compat: old payload shape (no agent) still 200
 * 5. auto tone + agent combined (full auto payload)
 */
const BASE = process.env.RIZZ_BASE || "http://localhost:3000";

async function call(payload) {
  const res = await fetch(`${BASE}/api/rizz`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${extra}`); }
}

const TWEET =
  "after 2 years of renting I finally bought my first house. 28 and debt-free except the mortgage lol. mom cried when I showed her the keys";

// 1. tone auto
{
  const { status, data } = await call({ tweet: TWEET, mode: "reply", tone: "auto", length: "normal" });
  const v = data.variants || [];
  check("tone:auto → 200 + 3 variants", status === 200 && v.length === 3, JSON.stringify(data).slice(0, 160));
  check("tone:auto echoes tone=auto", data.tone === "auto");
}

// 2. preset directive: funny
{
  const { status, data } = await call({
    tweet: TWEET, mode: "reply", tone: "witty", length: "normal",
    agent: "Be genuinely funny: one clever joke or witty observation grounded in the tweet's actual content",
  });
  const v = data.variants || [];
  check("agent:funny → 200 + 3 variants", status === 200 && v.length === 3, JSON.stringify(data).slice(0, 160));
  check("funny: grounded (mentions house/mom/debt/mortgage or asks)", v.some(x =>
    /house|mom|debt|mortgage|keys|rent/i.test(x)), v.join(" | ").slice(0, 200));
}

// 3. custom directive
{
  const { status, data } = await call({
    tweet: TWEET, mode: "reply", tone: "auto", length: "short",
    agent: "End every variant with ONE short question about the house",
  });
  const v = data.variants || [];
  check("custom directive → 200 + 3 variants", status === 200 && v.length === 3);
  check("custom: questions present", v.filter(x => /\?/.test(x)).length >= 2, v.join(" | ").slice(0, 200));
}

// 4. backward compat — v0.5.0-era payload (no agent, plain tone)
{
  const { status, data } = await call({ tweet: "shipping beats waiting for perfect", mode: "reply", tone: "witty" });
  check("legacy payload → 200 + variants", status === 200 && (data.variants || []).length >= 1, JSON.stringify(data).slice(0, 120));
}

// 5. full auto combo: auto tone + mission + bio + length dial
{
  const { status, data } = await call({
    tweet: TWEET, mode: "reply", tone: "auto", length: "short", count: 2,
    bio: "building a personal finance tracker for first-time home buyers",
    agent: "Lead with or include ONE smart, specific question about the tweet that moves the conversation forward",
  });
  const v = data.variants || [];
  check("full-auto combo → 200 + 2 variants", status === 200 && v.length === 2, JSON.stringify(data).slice(0, 160));
  check("full-auto short: punchy", v.every(x => x.length <= 160), v.map(x => x.length).join(","));
}

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
