# RizzReply — personal X copilot (v0.12.0)

Floating AI copilot for x.com with **Auto-write Agent**: click ✨ →
🤖 Auto-write → it reads the tweet on your screen, the Brain picks the
best tone, writes the reply, and drops it into the reply box. You press
Post. That's the whole flow.

v0.12.0 post pack:
- **🚀 POST MODE — the tool now tweets for you.** New **Post** pill:
  give it a topic, an idea or a rough draft — it writes ORIGINAL
  scroll-stopping tweets (hook-first, concrete, shareable, zero
  engagement-bait cringe) with your Big Brain baked in.
- **🚀 Post it (FULL SEND)** — one button: opens the tweet composer,
  types the post and presses X's own Post button. One post per click —
  you picked the text, the tool ships it. (Post + Hook modes; a reply
  box can never hijack your standalone post.)
- **💡 Next-move bar** — every batch now shows the Brain's traction
  move (first-hour reply plan, quote-tweet angle, who to send it to).
v0.11.0 big brain pack:
- **🧠 Big Brain drawer** — 4 fields: 👤 Who I am / 🗣 How I talk
  (paste real replies — your rhythm gets mirrored) / 🏆 Flex zone
  (TRUE wins it may drop when invited) / 🚫 Never say (personal hard
  bans). Replies act like YOU, not a ghostwriter.
v0.9.0 batch pack:
- **📋 Batch queue (PC)** — scroll your feed, hit **📋 Queue → ＋ Add current**
  to park any tweet (max 10, deduped, saved on your machine). Later open them
  from the drawer one by one — **Open ↗** loads the tweet, **🤖 Auto-write**
  does the full read → thread → generate → auto-type dance. Android twin:
  the ⚡ Batch page on the PWA (paste up to 10 links at once).
- **Fixed** — a broken selector silently killed status-ID capture from the
  feed (full-read + thread context degraded there); version stamp now
  matches the manifest so updates always take.
v0.8.2 autonomy pack:
- **🧵 Thread comprehension** — the agent walks the reply chain (keyless) so the Brain sees the WHOLE conversation, not just the last tweet
- **🧠 Voice memory** — every reply you auto-type or copy is remembered on your device (max 30); new ones match YOUR rhythm and slang
v0.8.1 comprehension pack:
- agent now FULL-READS the tweet (keyless API by status ID) before writing — no more replying to half a tweet
- Brain v4 answers the tweet's actual ask (question / "drop your link" / CTA) instead of pivoting to generic questions
- quoted-tweet cards can no longer hijack the captured text; emojis preserved
- **🤖 Auto-write agent** — one tap: screen read → 🎲 auto tone →
  generate → types variant 1 into the reply box
- **Changeable missions** — the agent doesn't have to "reply to this
  tweet". Tap the ▾ next to it and pick a mission: 💬 Reply /
  ❓ Ask a smart question / 💡 Add value / 😂 Be funny / 🔥 Hype them up /
  🤨 Respectful pushback / ✍️ Custom (your own instruction, saved)
- **🎲 Auto tone** — new tone pill: the Brain reads the tweet's type and
  register and picks the best tone itself (playful → witty, launch →
  hype, business → professional, slangy → genz …). Works for the agent
  AND for manual generation.

v0.6.0 smart pack:
- **🧠 My bio (memory)** — tell the Brain once what you actually build;
  replies may then flex it in first person, truthfully. No bio = the
  anti-fabrication rules stay at full force. Saved on your machine.
- **Length dial** — ⚡ One-liner / 💬 Normal / 📝 Detailed
- **2 new tones** — 🧢 GenZ and 💼 Pro (join Witty/Expert/Hype/Friendly/Savage)
- **↻ per-variant re-roll** — hate one option? Re-roll just that card
- **🕘 History** — your last 15 generations, one-click copy from the panel
- **Auto language match** — Hindi tweet → Hindi reply, Hinglish → Hinglish,
  Spanish → Spanish (server-side, works for every install instantly)
Plus v0.5.0: ⚡ auto-type in every mode (Reply / Quote / Hook), draggable
✨ bubble, 📥 use my draft, 🔄 regenerate 3 more, Alt+R toggle.
Plus v0.4.x: screen-reading Agent mode, 3-strategy typing engine,
background auto-injection that auto-replaces stale panels, and Brain v2
on the server (tweet-type detection, anti-fabrication rules).

Copilot, not autopilot — with ONE exception you control: **🚀 Post it**
presses Post on the exact text you clicked it for (Post/Hook modes
only). It never auto-likes, auto-follows, or batch-spams — mass
automation is how accounts get flagged. Your feed stays human.

## Upgrading from an older version (do it CLEAN)

1. `brave://extensions` → RizzReply → **Remove**
2. Download the fresh zip and extract it
3. Open the extracted folder — you must see `manifest.json` directly
   inside it (if you see another folder, go one level deeper)
4. `brave://extensions` → **Load unpacked** → pick that folder
5. Open x.com — the bubble appears on ALL open tabs within ~2 seconds.
   No F5 needed, ever again (background injector handles it).

## Install (PC — Chrome / Edge / Brave)

1. Unzip this folder somewhere permanent
2. Open `chrome://extensions` (Edge: `edge://extensions`)
3. Turn on **Developer mode** (top right)
4. Click **Load unpacked** → select this folder
5. Open https://x.com → look for the ✨ bubble (bottom-right)

## Use it — Auto-write agent flow (easiest)

1. Open any tweet (or scroll your timeline so one is on screen)
2. Click the ✨ bubble (or press **Alt+R**) — the panel shows
   `🎯 locked on @user`
3. (Optional) Tap **▾** next to the agent button → choose the mission
   (❓ Question, 😂 Funny, 💡 Add value … or write a custom one)
4. Hit **🤖 Auto-write** — it reads the tweet, picks the best tone,
   generates and **types the reply into the box by itself**
5. You press **Post**

## Manual flow (more control)

- **Hover** any tweet to capture it, or paste it manually — or hit
  **📥 use my draft** to pull what's already in your reply box
- Pick a **Mode**: Reply / Quote / Hook / **Post** · **Tone**: 🎲 Auto → Savage
- **✨ Generate 3 options**, then:
  - **🚀 Post it** (Post + Hook): types it into the tweet composer AND
    presses Post — full send in one click
  - **⚡ Auto-type** works in every mode: Reply → reply box, Quote →
    quote composer (opens it for you), Hook/Post → Post composer
  - **🔄 regenerate 3 more** for a fresh batch anytime
  - Copy always there as the safe fallback

## Farming followers & views (Post mode flow)

1. Click ✨ → **Post** pill
2. Type a topic ("why I build at 6am", "what shipping taught me today")
3. **✨ Generate 3 options** — hook-first posts built for the repost
4. Hit **🚀 Post it** on the winner — composer opens, types, posts
5. Follow the **💡 Next** bar: the first hour of replies is where
   traction is farmed

## Android / iPhone

Open the companion web panel on your phone and "Add to Home screen":
https://preview-chat-e4ce03b0-621a-4e60-9074-8481e7bfe67b.space-z.ai/rizz

Copy tweet text on the X app → paste in the panel → **⚡ Full auto** →
the best variant is already on your clipboard — just paste it back.
Android floating-bubble APK also available on that page.

## Requirements

- Internet connection to the RizzReply backend (AI runs server-side)
- No API keys, no sign-up, nothing to configure — personal build

## Troubleshoot

- **Bubble missing?** Check the extension card shows **0.12.0**. On x.com
  press F12 → Console — you should see
  `[RizzReply] v0.12.0 injected ✓`. No line = not injected: screenshot
  the extension's Details → Errors page.
- **Bubble in the way?** Just **drag it** somewhere else — it stays there.
- **Auto-type fails?** Click once INSIDE the reply box (cursor blinks
  there), then hit ⚡ Auto-type / 🤖 Auto-write again. Console shows
  exactly which typing strategy ran.
- **Panel shows an old version badge?** The tab is running stale files —
  do the clean upgrade above (Remove → fresh folder → Load unpacked).
- **Reinstalled but the panel still shows the old badge / old error?**
  That tab was showing a dead panel left behind by the removed install.
  v0.4.2 replaces it automatically within ~2 seconds of loading the
  extension. If it somehow survives: refresh that tab once (F5).
- **"Failed to fetch" / "Network blocked"?** Your build is older than
  v0.3.0 (it calls the API from the page and X blocks it), or the
  backend is unreachable. Fix: do the clean upgrade above — v0.4.2
  routes the API through the extension context, which X cannot block.
  Console will show `bridge ✓` when the route works.
- **"API 404"?** A stale half-updated install (old + new files mixed).
  Remove the extension, delete the folder, extract a fresh zip, Load
  unpacked again.
- **"Generation failed"?** The backend may be waking up — wait 30s, retry
- **X redesigned and hover-grab breaks?** Paste mode always works

## Privacy

Only the tweet text you explicitly generate for is sent to the backend.
Your bio, agent mission and history never leave your machine (bio +
mission ride along ONLY inside the generation request, nothing is stored
server-side). No tracking, no accounts.
