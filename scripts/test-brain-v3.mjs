#!/usr/bin/env node
/* RizzReply Brain v3 regression suite — hits local /api/rizz directly. */
const BASE = "http://127.0.0.1:3000/api/rizz";

async function call(name, payload) {
  const t0 = Date.now();
  try {
    const res = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);
    const ms = Date.now() - t0;
    const variants = (data && data.variants) || [];
    const ok = res.ok && variants.length > 0;
    console.log(
      `\n[${ok ? "PASS" : "FAIL"}] ${name} — ${res.status} (${ms}ms, ${variants.length} variants)`
    );
    variants.forEach((v, i) =>
      console.log(`   ${i + 1}. (${v.length}c) ${v.slice(0, 110)}${v.length > 110 ? "…" : ""}`)
    );
    if (!ok) console.log("   body:", JSON.stringify(data).slice(0, 300));
    return { ok, variants };
  } catch (e) {
    console.log(`\n[FAIL] ${name} — threw: ${e.message}`);
    return { ok: false, variants: [] };
  }
}

const INVITE =
  "We're building an AI note-taking app for students. Drop an emoji and I'll DM you early access, or tell me what you're building!";

(async () => {
  console.log("=== Brain v3 regression ===");

  // 1. Old-shape compatibility (v0.5.0 extension payload — MUST keep working)
  await call("compat: old shape (tweet/mode/tone only)", {
    tweet: INVITE,
    mode: "reply",
    tone: "witty",
  });

  // 2. New tone: genz
  await call("new tone: genz", {
    tweet: INVITE,
    mode: "reply",
    tone: "genz",
  });

  // 3. New tone: professional
  await call("new tone: professional", {
    tweet: INVITE,
    mode: "reply",
    tone: "professional",
  });

  // 4. Length: short
  const short = await call("length: short", {
    tweet: INVITE,
    mode: "reply",
    tone: "witty",
    length: "short",
  });
  const shortOk = short.variants.every((v) => v.length <= 140);

  // 5. Bio memory — first person allowed, linter skipped
  await call("bio memory: first-person flex", {
    tweet: INVITE,
    mode: "reply",
    tone: "hype",
    bio: "I'm building a fitness app for busy developers called FitLoop",
  });

  // 6. count: 1 (per-variant re-roll path)
  await call("count: 1 (re-roll)", {
    tweet: INVITE,
    mode: "reply",
    tone: "witty",
    count: 1,
  });

  // 7. Quote mode normal
  await call("quote mode", {
    tweet:
      "Hot take: most AI agents fail not because of the model but because nobody designed the failure paths.",
    mode: "quote",
    tone: "expert",
  });

  // 8. Hook mode with bio — first person preserved
  await call("hook mode + bio", {
    tweet:
      "I spent 6 months learning in public. Here is what actually worked and what was a waste of time.",
    mode: "hook",
    tone: "witty",
    bio: "indie dev, building in public",
  });

  // 9. Language match — Hindi/Hinglish tweet should get a Hindi/Hinglish reply
  await call("language match: Hinglish tweet", {
    tweet:
      "AI tools ka sabse bada problem: sab promise karte hai, kuch hi deliver karte hai. Aapka experience kya hai?",
    mode: "reply",
    tone: "friendly",
  });

  console.log(`\n=== short-length check: ${shortOk ? "PASS (≤140c)" : "WARN (over 140c)"} ===`);
})();
