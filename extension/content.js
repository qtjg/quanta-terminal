/*
 * RizzReply — floating copilot content script for x.com
 * v0.2.0 — AUTO-TYPE: writes the chosen variant straight into X's reply
 * box (auto-opens the inline composer via the tweet's reply button) using
 * execCommand('insertText'), which React/DraftJS registers as real input.
 * Still copilot, not autopilot: the user always presses Post themselves.
 * v0.4.0 — AGENT MODE: one click locks onto whatever tweet is on screen
 * (status page = main tweet; timeline = most-visible tweet, tracked on
 * scroll), generates and auto-types the reply into X's reply box.
 * The user still presses Post — agent assists, human posts.
 * v0.3.0 — BACKGROUND INJECTOR: a service worker now pushes the bubble
 * into every open x.com tab on install/update (no manual F5 needed) and
 * routes API calls through the extension context (immune to page CSP).
 * v0.2.1 — 3-strategy typing engine (execCommand → beforeinput → paste)
 * for DraftJS modal + inline composers, verbose [RizzReply] console logs,
 * version badge in panel header for easy debugging.
 * v0.1.1 — hardened injection: waits for document.body, re-attaches if X
 * removes the root node, logs injection status to console.
 * v0.6.0 — SMART PACK: 🧠 My-bio memory (truthful first-person), length dial
 * (one-liner / normal / detailed), 2 new tones (GenZ, Pro), per-variant
 * re-roll (↻), 🕘 history (last 15 generations, copyable), auto language
 * match (server-side), mount-guard now version-exact.
 * v0.7.0 — AUTOPILOT PACK: the agent is now on AUTO-WRITE — one tap reads
 * the screen, lets the Brain pick the best tone (🎲 auto), generates and
 * types the reply. And the agent's mission is CHANGEABLE: 6 presets
 * (reply / question / add value / funny / hype / pushback) + fully custom
 * instruction, saved across sessions. 🎲 Auto tone pill for manual runs too.
 * v0.8.1 — COMPREHENSION PACK: field report showed the panel capturing a
 * TRUNCATED tweet (timeline clamps behind "Show more"; quoted-tweet text
 * overrode the main text; emoji lost) so the Brain answered a tweet it
 * never fully saw — "tweet asked something, reply said something else".
 * Fixes: (1) main text = FIRST tweetText block, not last (quotes no longer
 * hijack input); (2) emoji preserved (img alt woven back into the text);
 * (3) truncation detected and surfaced; (4) FULL-READ FALLBACK — the agent
 * pulls the COMPLETE tweet text by status ID through the keyless
 * /api/rizz/fetch endpoint (same one the Android app uses), cached +
 * time-boxed so Auto-write stays fast. Brain v4 (server-side) now also
 * hard-requires answering the tweet's actual ask.
 */
(() => {
  // Version-aware mount guard. Old builds used a plain "loaded" flag —
  // combined with the background's presence-only probe this caused the
  // "update never takes" bug: a dead panel from a removed install kept
  // sitting in open tabs forever. Now: different version → old panel is
  // stripped and this build takes over.
  const RR_VER = "0.10.0";
  // Version-aware mount guard — compares against THIS build's version. Old
  // builds compared against a hardcoded older string, which could let a
  // stale 0.4.2-era panel skip replacement entirely. Different version →
  // old panel is stripped below and this build takes over.
  if (window.__rizzVer === RR_VER) return;
  try {
    document.querySelectorAll("#rr-root").forEach((n) => n.remove());
  } catch (e) {}
  window.__rizzVer = RR_VER;
  window.__rizzReplyLoaded = true;

  // Base URL ONLY — the /api/rizz path is appended exactly once by apiUrl().
  // (v0.4.0 and earlier built ".../api/rizz/api/rizz" → 404 → generation died)
  const API_ORIGIN =
    "https://preview-chat-e4ce03b0-621a-4e60-9074-8481e7bfe67b.space-z.ai";
  const DEFAULT_API = API_ORIGIN;

  // Accepts an origin OR a full endpoint, always returns a clean base.
  function normalizeBase(raw) {
    const base = String(raw || DEFAULT_API)
      .trim()
      .replace(/\/+$/, "")
      .replace(/\/api\/rizz$/i, "");
    return base || DEFAULT_API;
  }
  const apiUrl = () => `${normalizeBase(apiBase)}/api/rizz`;

  const MODES = ["reply", "quote", "hook"];
  const MODE_LABELS = { reply: "Reply", quote: "Quote", hook: "Hook" };
  const TONES = [
    "auto",
    "witty",
    "expert",
    "hype",
    "friendly",
    "savage",
    "genz",
    "professional",
  ];
  const TONE_LABELS = {
    auto: "🎲 Auto",
    witty: "😏 Witty",
    expert: "🧠 Expert",
    hype: "🔥 Hype",
    friendly: "🤝 Friendly",
    savage: "😈 Savage",
    genz: "🧢 GenZ",
    professional: "💼 Pro",
  };
  const LENGTHS = ["short", "normal", "detailed"];
  const LENGTH_LABELS = {
    short: "⚡ One-liner",
    normal: "💬 Normal",
    detailed: "📝 Detailed",
  };
  const HISTORY_KEY = "rizzHistory";
  const BIO_KEY = "rizzBio";
  const AGENT_ID_KEY = "rizzAgentId";
  const AGENT_CUSTOM_KEY = "rizzAgentCustom";
  const VOICE_KEY = "rizzVoice"; // v0.8.2 — user's kept replies (voice memory)
  const QUEUE_KEY = "rizzQueue"; // v0.9.0 — PC batch queue (parked tweet ids)
  const QUEUE_MAX = 10;
  const VAULT_KEY = "rizzVault"; // v0.10.0 — ⭐ pinned keeper replies
  const VAULT_MAX = 50;
  const HISTORY_MAX = 15;
  const THREAD_TIMEOUT_MS = 4000;

  /* ---------- 🤖 agent missions (v0.7.0) ----------
   * "reply" is the classic behavior (no directive sent — the Brain's own
   * strategy engine drives). Every other mission ships an AGENT DIRECTIVE
   * to the server. "custom" ships the user's own words verbatim. */
  const AGENT_PRESETS = [
    { id: "reply", chip: "💬 Reply", label: "reply to this tweet", directive: "" },
    {
      id: "question",
      chip: "❓ Question",
      label: "ask a smart question",
      directive:
        "Lead with or include ONE smart, specific question about the tweet that moves the conversation forward",
    },
    {
      id: "value",
      chip: "💡 Add value",
      label: "add value + tip",
      directive:
        "Add real value: one concrete tip, insight, resource idea or sharp observation related to the tweet's topic",
    },
    {
      id: "funny",
      chip: "😂 Funny",
      label: "be funny",
      directive:
        "Be genuinely funny: one clever joke or witty observation grounded in the tweet's actual content — humor first, still relevant",
    },
    {
      id: "hype",
      chip: "🔥 Hype",
      label: "hype them up",
      directive:
        "Hype the author up: high-energy support that celebrates the SPECIFIC thing they shared — never generic praise",
    },
    {
      id: "disagree",
      chip: "🤨 Pushback",
      label: "respectful pushback",
      directive:
        "Give a respectful counter-angle or polite disagreement: bold, specific, classy — never rude, never a strawman",
    },
  ];

  function agentPreset() {
    return (
      AGENT_PRESETS.find((p) => p.id === state.agentId) || AGENT_PRESETS[0]
    );
  }
  function agentDirective() {
    if (state.agentId === "custom") {
      return state.agentCustom.trim().slice(0, 200);
    }
    return agentPreset().directive;
  }
  function agentShortLabel() {
    if (state.agentId === "custom") {
      const t = state.agentCustom.trim();
      return t ? (t.length > 26 ? t.slice(0, 26) + "…" : t) : "custom mission";
    }
    return agentPreset().label;
  }
  const PLACEHOLDERS = {
    reply: "Hover a tweet to grab it, or paste it here...",
    quote: "Paste the tweet you're quoting...",
    hook: "Paste YOUR draft tweet...",
  };

  let apiBase = DEFAULT_API;
  let state = {
    threadCtx: [], // v0.8.2 — conversation chain for the current target
    queue: [], // v0.9.0 — parked tweets (batch queue)
    mode: "reply",
    tone: "witty",
    length: "normal",
    bio: "",
    agentId: "reply",
    agentCustom: "",
    history: [],
    vault: [],
    lastTweet: "",
    lastArticle: null,
    loading: false,
  };

  // Load saved API base override (sync: rizzApiBase), bio memory (rizzBio),
  // the saved agent mission (rizzAgentId + rizzAgentCustom), and the
  // generation history (local: rizzHistory).
  try {
    if (chrome?.storage?.sync) {
      chrome.storage.sync.get(
        ["rizzApiBase", BIO_KEY, AGENT_ID_KEY, AGENT_CUSTOM_KEY],
        (r) => {
          if (r && typeof r.rizzApiBase === "string" && r.rizzApiBase.trim()) {
            apiBase = normalizeBase(r.rizzApiBase);
          }
          if (r && typeof r[BIO_KEY] === "string" && r[BIO_KEY].trim()) {
            state.bio = r[BIO_KEY].trim().slice(0, 300);
            const bioBtn = root.querySelector(".rr-biobtn");
            if (bioBtn) bioBtn.classList.add("rr-has-bio");
          }
          if (
            r &&
            (typeof r[AGENT_ID_KEY] === "string" ||
              typeof r[AGENT_CUSTOM_KEY] === "string")
          ) {
            if (typeof r[AGENT_ID_KEY] === "string" && r[AGENT_ID_KEY]) {
              state.agentId = r[AGENT_ID_KEY];
            }
            if (typeof r[AGENT_CUSTOM_KEY] === "string") {
              state.agentCustom = r[AGENT_CUSTOM_KEY].slice(0, 200);
            }
            updateAgentLabel();
          }
        }
      );
    }
    if (chrome?.storage?.local) {
      chrome.storage.local.get([HISTORY_KEY, QUEUE_KEY, VAULT_KEY], (r) => {
        if (r && Array.isArray(r[HISTORY_KEY])) {
          state.history = r[HISTORY_KEY].slice(0, HISTORY_MAX);
        }
        if (r && Array.isArray(r[QUEUE_KEY])) {
          state.queue = r[QUEUE_KEY].slice(0, QUEUE_MAX);
          updateQueueBadge();
        }
        if (r && Array.isArray(r[VAULT_KEY])) {
          state.vault = r[VAULT_KEY].slice(0, VAULT_MAX);
          updateVaultBadge();
        }
      });
    }
  } catch (e) {
    /* storage unavailable — defaults stand */
  }

  /* ---------- tweet capture ---------- */

  // v0.8.1 — the ONE text extractor for both capture paths (hover + scroll
  // lock). Rules learned from the field bug:
  // - Main tweet text = FIRST [data-testid="tweetText"] in the article. The
  //   old code took the LAST block, which on tweets with an embedded quote
  //   card grabbed the QUOTE's text and lost the main tweet entirely.
  // - innerText silently drops X's emoji (they are <img alt="👉">) and can
  //   miss clamped lines — so we walk the DOM ourselves: text nodes verbatim,
  //   imgs as their alt text, <br> as newline.
  function articleText(article) {
    try {
      const el = article.querySelector('[data-testid="tweetText"]');
      if (!el) return "";
      const parts = [];
      const walk = (node) => {
        for (const child of node.childNodes) {
          if (child.nodeType === Node.TEXT_NODE) {
            parts.push(child.nodeValue || "");
          } else if (child.nodeType === Node.ELEMENT_NODE) {
            const tag = child.tagName;
            if (tag === "IMG") {
              parts.push(child.getAttribute("alt") || "");
            } else if (tag === "BR") {
              parts.push("\n");
            } else {
              walk(child);
            }
          }
        }
      };
      walk(el);
      return (
        parts
          .join("")
          .replace(/[ \t]+\n/g, "\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim()
          .slice(0, 1200)
      );
    } catch (e) {
      return "";
    }
  }

  // "Show more" clamp detector — on timelines X renders only the first
  // lines and hides the rest behind a link. If present, the DOM text is
  // KNOWN-incomplete and the agent should prefer a full API read.
  function articleClamped(article) {
    try {
      if (article.querySelector('[data-testid="tweet-text-show-more-link"]'))
        return true;
      for (const a of article.querySelectorAll("a[href*='/status/']")) {
        if (/show\s*more/i.test(a.textContent || "")) return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  function extractTweetText(node) {
    const article = node instanceof Element ? node.closest("article") : null;
    if (!article) return;
    state.lastArticle = article;
    const text = articleText(article);
    if (text && text.length > 3) state.lastTweet = text;
  }

  document.addEventListener(
    "mouseover",
    (e) => {
      if (state.loading) return;
      const t = e.target;
      if (t instanceof Element && t.closest('article[data-testid="tweet"]')) {
        extractTweetText(t);
      }
    },
    { passive: true }
  );

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---------- auto-type into X's reply box ---------- */

  const dlog = (...a) => console.info("[RizzReply]", ...a);

  // Probe the service worker — logs bridge status and surfaces stale contexts
  try {
    chrome.runtime.sendMessage({ type: "rizz-ping" }, (resp) => {
      if (chrome.runtime.lastError) return; // background not ready — fine
      dlog(`bridge ✓ (background v${resp && resp.version})`);
    });
  } catch (e) {
    /* extension context invalidated — the page needs one refresh */
  }

  function visibleComposers() {
    return Array.from(
      document.querySelectorAll('[data-testid^="tweetTextarea_"]')
    ).filter((el) => el.getClientRects().length > 0);
  }

  function caretToEnd(el) {
    el.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  const boxHasText = (box) => (box.innerText || "").trim().length > 0;

  // A) execCommand — Chromium turns these into input events DraftJS accepts
  function insertExec(box, text) {
    caretToEnd(box);
    document.execCommand("selectAll", false, null);
    document.execCommand("delete", false, null);
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]) document.execCommand("insertText", false, lines[i]);
      if (i < lines.length - 1) document.execCommand("insertLineBreak");
    }
    return boxHasText(box);
  }

  // B) synthetic beforeinput — DraftJS reads e.data and applies the edit
  function insertBeforeInput(box, text) {
    caretToEnd(box);
    box.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: text,
      })
    );
    return boxHasText(box);
  }

  // C) synthetic paste — DraftJS reads clipboardData (handles multi-line)
  function insertPaste(box, text) {
    caretToEnd(box);
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    box.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: dt,
      })
    );
    return boxHasText(box);
  }

  // Open (or find) the right composer for a mode, returning visible boxes.
  async function openComposerFor(mode) {
    let boxes = visibleComposers();
    if (boxes.length) return boxes;

    const article =
      state.lastArticle && state.lastArticle.isConnected
        ? state.lastArticle
        : null;

    if (mode === "quote") {
      const rtBtn = article?.querySelector('[data-testid="retweet"]');
      if (!rtBtn) {
        dlog("autoType: no retweet button on captured tweet");
        return [];
      }
      dlog("autoType: opening the retweet menu for Quote…");
      rtBtn.click();
      let item = null;
      for (let i = 0; i < 20 && !item; i++) {
        await sleep(150);
        item = Array.from(document.querySelectorAll('[role="menuitem"]')).find(
          (el) => /quote/i.test(el.textContent || "")
        );
      }
      if (!item) {
        dlog("autoType: quote menu never appeared");
        return [];
      }
      item.click();
    } else if (mode === "hook") {
      const newPost = document.querySelector(
        '[data-testid="SideNav_NewPost_Button"]'
      );
      if (!newPost) {
        dlog("autoType: no Post button in the nav — open a composer manually");
        return [];
      }
      dlog("autoType: opening the compose modal…");
      newPost.click();
    } else {
      const replyBtn = article?.querySelector('[data-testid="reply"]');
      if (!replyBtn) {
        dlog("autoType: no open composer + no reply button on captured tweet");
        return [];
      }
      dlog("autoType: no composer open — clicking the tweet's reply button…");
      replyBtn.click();
    }

    for (let i = 0; i < 20; i++) {
      await sleep(150);
      boxes = visibleComposers();
      if (boxes.length) break;
    }
    return boxes;
  }

  async function autoType(text, mode) {
    const boxes = await openComposerFor(mode || state.mode);

    if (!boxes.length) {
      dlog(`autoType: composer never appeared (${mode || state.mode})`);
      return false;
    }

    // Prefer the main composer (tweetTextarea_0), else first visible
    const box =
      boxes.find((b) => b.dataset.testid === "tweetTextarea_0") || boxes[0];
    box.scrollIntoView({ block: "center" });
    dlog(
      `autoType: composer found (${box.dataset.testid}) — trying typing strategies`
    );

    const strategies = [
      ["execCommand", insertExec],
      ["beforeinput", insertBeforeInput],
      ["paste", insertPaste],
    ];
    for (const [name, fn] of strategies) {
      try {
        if (fn(box, text)) {
          dlog(`autoType: ✓ typed via ${name} — now YOU press Post`);
          return true;
        }
        dlog(`autoType: ${name} produced nothing — trying next strategy`);
      } catch (e) {
        dlog(`autoType: ${name} threw an error — trying next strategy`, e);
      }
    }
    dlog("autoType: all 3 strategies failed — click inside the reply box once, then retry");
    return false;
  }

  /* ---------- screen reader: lock onto the tweet in view ---------- */

  function textOf(article) {
    return articleText(article);
  }

  function detectActiveTweet() {
    const articles = Array.from(
      document.querySelectorAll('article[data-testid="tweet"]')
    );
    if (!articles.length) return null;

    let article = null;
    if (/\/status\/\d+/.test(location.pathname)) {
      // Status page: first article IS the main tweet
      article = articles[0];
    } else {
      // Timeline: whichever tweet is most visible in the viewport right now
      let bestArea = 0;
      const vh = window.innerHeight || 800;
      for (const a of articles) {
        const r = a.getBoundingClientRect();
        const overlap = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
        if (overlap > bestArea) {
          bestArea = overlap;
          article = a;
        }
      }
      if (!article) article = articles[0];
    }
    if (!article) return null;
    const text = textOf(article);
    if (!text || text.length <= 3) return null;
    return { article, text };
  }

  function targetLabel(article) {
    try {
      const link = article.querySelector('a[href^="/"][href*="/status/"]');
      const m = link && link.getAttribute("href").match(/^\/([^/]+)\/status/);
      return m ? "@" + m[1] : "tweet";
    } catch (e) {
      return "tweet";
    }
  }

  function updateTarget() {
    const det = detectActiveTweet();
    if (det) {
      state.lastTweet = det.text;
      state.lastArticle = det.article;
    }
    if (targetEl) {
      if (det) {
        targetEl.style.display = "block";
        targetEl.textContent = `🎯 locked on ${targetLabel(det.article)} — screen read OK`;
      } else {
        targetEl.style.display = "none";
      }
    }
    return det;
  }

  /* ---------- UI ---------- */

  const root = document.createElement("div");
  root.id = "rr-root";
  root.setAttribute("data-ver", RR_VER); // background probe reads this

  function mount() {
    if (!root.isConnected) {
      (document.body || document.documentElement).appendChild(root);
      console.info(
        `[RizzReply] v${RR_VER} injected ✓ — click the ✨ bubble bottom-right`
      );
    }
  }

  // Wait for <body> even on slow loads, then mount and keep it mounted.
  if (document.body) {
    mount();
  } else {
    const boot = setInterval(() => {
      if (document.body) {
        clearInterval(boot);
        mount();
      }
    }, 120);
    setTimeout(() => clearInterval(boot), 30000);
  }

  // X.com SPA can wipe foreign nodes during route transitions — re-attach.
  new MutationObserver(() => {
    if (!root.isConnected) mount();
  }).observe(document.documentElement, { childList: true, subtree: false });

  root.innerHTML = `
    <button class="rr-bubble rr-pulse" title="RizzReply" aria-label="Open RizzReply">✨</button>
    <div class="rr-panel" style="display:none" role="dialog" aria-label="RizzReply panel">
      <div class="rr-head">
        <div class="rr-title">Rizz<span>Reply</span><em class="rr-ver">v${RR_VER}</em></div>
        <button class="rr-close" title="Close" aria-label="Close">✕</button>
      </div>
      <div class="rr-body">
        <p class="rr-target" style="display:none"></p>
        <div class="rr-tools">
          <button class="rr-mini rr-biobtn" title="Tell the Brain what you actually build — replies can flex it truthfully">🧠 My bio</button>
          <button class="rr-mini rr-histbtn" title="Your last generations">🕘 History</button>
          <button class="rr-mini rr-vaultbtn" title="⭐ Vault — replies you starred, kept until YOU remove them">⭐ Vault<span class="rr-vbadge"></span></button>
          <button class="rr-mini rr-queuebtn" title="Batch queue — park tweets while you scroll, work them one by one">📋 Queue<span class="rr-qbadge"></span></button>
        </div>
        <div class="rr-biobox" style="display:none">
          <p class="rr-biohint">What do you actually build? Saved locally on your machine. The Brain may use it in first person — so replies stay truthful, never invented.</p>
          <textarea class="rr-biota" rows="2" maxlength="300" placeholder="e.g. building a fitness app for busy devs"></textarea>
          <div class="rr-bioactions">
            <button class="rr-mini rr-biosave">Save bio</button>
            <button class="rr-mini rr-bioclear">Clear</button>
          </div>
        </div>
        <div class="rr-history" style="display:none"></div>
        <div class="rr-vault" style="display:none"></div>
        <div class="rr-queue" style="display:none"></div>
        <div class="rr-agent-row">
          <button class="rr-agent" title="One tap: reads the tweet on screen, picks the best tone, writes the reply into your reply box">🤖 Auto-write: reply to this tweet</button>
          <button class="rr-agent-edit" title="Change what the agent does">▾</button>
        </div>
        <div class="rr-agentbox" style="display:none">
          <p class="rr-agenthint">The agent's mission — what should it do on auto-write?</p>
          <div class="rr-agentchips"></div>
          <textarea class="rr-agentta" rows="2" maxlength="200" placeholder="Or write your own mission: e.g. ask about their pricing model"></textarea>
          <div class="rr-agentactions">
            <button class="rr-mini rr-agentsave">Save mission</button>
            <span class="rr-agentnote">Saved • applies to Auto-write</span>
          </div>
        </div>
        <p class="rr-label" style="margin-top:10px">Mode</p>
        <div class="rr-row" data-row="mode"></div>
        <p class="rr-label rr-label-row">Input <button class="rr-mini rr-grab" title="Pull the text currently sitting in your reply/Post box">📥 use my draft</button></p>
        <textarea class="rr-textarea" rows="4"></textarea>
        <p class="rr-label" style="margin-top:10px">Tone</p>
        <div class="rr-row" data-row="tone"></div>
        <p class="rr-label" style="margin-top:10px">Length</p>
        <div class="rr-row" data-row="length"></div>
        <button class="rr-go">✨ Generate 3 options</button>
        <div class="rr-results"></div>
      </div>
    </div>
  `;

  const bubble = root.querySelector(".rr-bubble");
  const panel = root.querySelector(".rr-panel");
  const textarea = root.querySelector(".rr-textarea");
  const goBtn = root.querySelector(".rr-go");
  const agentBtn = root.querySelector(".rr-agent");
  const agentEditBtn = root.querySelector(".rr-agent-edit");
  const agentBox = root.querySelector(".rr-agentbox");
  const agentChips = root.querySelector(".rr-agentchips");
  const agentTa = root.querySelector(".rr-agentta");
  const targetEl = root.querySelector(".rr-target");
  const results = root.querySelector(".rr-results");
  const grabBtn = root.querySelector(".rr-grab");
  const bioBtn = root.querySelector(".rr-biobtn");
  const bioBox = root.querySelector(".rr-biobox");
  const bioTa = root.querySelector(".rr-biota");
  const histBtn = root.querySelector(".rr-histbtn");
  const histBox = root.querySelector(".rr-history");
  const vaultBtn = root.querySelector(".rr-vaultbtn");
  const vaultBox = root.querySelector(".rr-vault");
  const queueBtn = root.querySelector(".rr-queuebtn");
  const queueBox = root.querySelector(".rr-queue");

  /* ---------- 🤖 agent missions — changeable auto-write (v0.7.0) ---------- */

  function updateAgentLabel() {
    agentBtn.textContent = `🤖 Auto-write: ${agentShortLabel()}`;
  }

  function renderAgentChips() {
    agentChips.innerHTML = "";
    AGENT_PRESETS.forEach((p) => {
      const b = document.createElement("button");
      b.className = "rr-pill" + (state.agentId === p.id ? " rr-on" : "");
      b.textContent = p.chip;
      b.title = p.label;
      b.addEventListener("click", () => {
        state.agentId = p.id;
        renderAgentChips();
      });
      agentChips.appendChild(b);
    });
    const c = document.createElement("button");
    c.className = "rr-pill" + (state.agentId === "custom" ? " rr-on" : "");
    c.textContent = "✍️ Custom";
    c.title = "Write your own mission";
    c.addEventListener("click", () => {
      state.agentId = "custom";
      renderAgentChips();
      agentTa.focus();
    });
    agentChips.appendChild(c);
  }

  function saveAgentMission() {
    state.agentCustom = agentTa.value.trim().slice(0, 200);
    if (state.agentId !== "custom" && agentTa.value.trim()) {
      // Typing a custom mission auto-switches to it — that's the intent
      state.agentId = "custom";
      renderAgentChips();
    }
    if (state.agentId === "custom" && !state.agentCustom) {
      state.agentId = "reply"; // empty custom text = no mission
      renderAgentChips();
    }
    try {
      chrome.storage.sync.set({
        [AGENT_ID_KEY]: state.agentId,
        [AGENT_CUSTOM_KEY]: state.agentCustom,
      });
    } catch (e) {}
    updateAgentLabel();
    agentBox.style.display = "none";
    dlog(
      `agent mission saved: ${state.agentId}${state.agentCustom ? ` — "${state.agentCustom}"` : ""}`
    );
  }

  agentEditBtn.addEventListener("click", () => {
    const open = agentBox.style.display !== "none";
    if (open) {
      agentBox.style.display = "none";
    } else {
      renderAgentChips();
      agentTa.value = state.agentCustom;
      agentBox.style.display = "block";
      bioBox.style.display = "none"; // one drawer at a time
      histBox.style.display = "none";
      vaultBox.style.display = "none";
      queueBox.style.display = "none";
    }
  });
  root.querySelector(".rr-agentsave").addEventListener("click", saveAgentMission);

  /* ---------- 🧠 bio memory — truthful first-person ---------- */

  bioBtn.addEventListener("click", () => {
    const open = bioBox.style.display !== "none";
    bioBox.style.display = open ? "none" : "block";
    if (!open) {
      bioTa.value = state.bio;
      bioTa.focus();
      histBox.style.display = "none"; // one drawer at a time
      agentBox.style.display = "none";
      vaultBox.style.display = "none";
      queueBox.style.display = "none";
    }
  });
  root.querySelector(".rr-biosave").addEventListener("click", () => {
    state.bio = bioTa.value.trim().slice(0, 300);
    try {
      chrome.storage.sync.set({ [BIO_KEY]: state.bio });
    } catch (e) {}
    bioBtn.classList.toggle("rr-has-bio", !!state.bio);
    bioBox.style.display = "none";
    dlog(
      `bio saved (${state.bio.length} chars) — the Brain may flex it in first person, truthfully`
    );
  });
  root.querySelector(".rr-bioclear").addEventListener("click", () => {
    state.bio = "";
    bioTa.value = "";
    try {
      chrome.storage.sync.remove(BIO_KEY);
    } catch (e) {}
    bioBtn.classList.remove("rr-has-bio");
    bioBox.style.display = "none";
    dlog("bio cleared — back to stranger-safe mode");
  });

  /* ---------- 🕘 history + shared copy helper ---------- */

  async function copyText(text, btn, doneLabel) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      // Fallback for restricted clipboard contexts
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    rememberVoice(text); // 🧠 voice memory — kept replies teach your voice
    const prev = btn.textContent;
    btn.textContent = doneLabel || "Copied ✓";
    btn.classList.add("rr-done");
    setTimeout(() => {
      btn.textContent = prev;
      btn.classList.remove("rr-done");
    }, 1400);
  }

  function saveHistory() {
    try {
      chrome.storage.local.set({ [HISTORY_KEY]: state.history });
    } catch (e) {}
  }

  function updateLastHistory(idx, text) {
    const entry = state.history[0];
    if (!entry || !Array.isArray(entry.variants)) return;
    entry.variants[idx] = text;
    saveHistory();
  }

  function renderHistory() {
    histBox.innerHTML = "";
    const top = document.createElement("div");
    top.className = "rr-hist-top";
    const title = document.createElement("strong");
    title.textContent = "🕘 Recent generations";
    const clearBtn = document.createElement("button");
    clearBtn.className = "rr-mini";
    clearBtn.textContent = "Clear";
    clearBtn.addEventListener("click", () => {
      state.history = [];
      saveHistory();
      renderHistory();
    });
    top.appendChild(title);
    top.appendChild(clearBtn);
    histBox.appendChild(top);

    if (!state.history.length) {
      const p = document.createElement("p");
      p.className = "rr-hist-empty";
      p.textContent = "Nothing yet — every generation lands here.";
      histBox.appendChild(p);
      return;
    }
    state.history.forEach((entry) => {
      const item = document.createElement("div");
      item.className = "rr-hist-item";
      const head = document.createElement("p");
      head.className = "rr-hist-head";
      const t = entry.ts ? new Date(entry.ts).toLocaleTimeString() : "";
      head.textContent = `${MODE_LABELS[entry.mode] || entry.mode || "?"} · ${
        entry.tone || "?"
      } · ${t}`;
      const src = document.createElement("p");
      src.className = "rr-hist-src";
      src.textContent = entry.tweet || "";
      src.title = entry.tweet || "";
      item.appendChild(head);
      item.appendChild(src);
      (entry.variants || []).forEach((v) => {
        const row = document.createElement("div");
        row.className = "rr-hist-row";
        const txt = document.createElement("span");
        txt.textContent = v;
        const hbtns = document.createElement("span");
        hbtns.style.display = "flex";
        const st = document.createElement("button");
        st.className = "rr-mini rr-star" + (isStarred(v) ? " rr-on" : "");
        st.textContent = isStarred(v) ? "⭐" : "☆";
        st.title = isStarred(v)
          ? "In your Vault — click to remove"
          : "Star it — rescue this into your Vault";
        st.addEventListener("click", () => starText(v, st));
        const cp = document.createElement("button");
        cp.className = "rr-mini";
        cp.textContent = "Copy";
        cp.addEventListener("click", () => copyText(v, cp));
        hbtns.appendChild(st);
        hbtns.appendChild(cp);
        row.appendChild(txt);
        row.appendChild(hbtns);
        item.appendChild(row);
      });
      histBox.appendChild(item);
    });
  }

  histBtn.addEventListener("click", () => {
    const open = histBox.style.display !== "none";
    if (open) {
      histBox.style.display = "none";
    } else {
      renderHistory();
      histBox.style.display = "block";
      bioBox.style.display = "none"; // one drawer at a time
      agentBox.style.display = "none";
      vaultBox.style.display = "none";
      queueBox.style.display = "none";
    }
  });

  /* ---------- ⭐ vault — pinned keeper replies (v0.10.0) ----------
   * History auto-evicts at 15; the Vault keeps what YOU star until you
   * remove it (cap 50, device-local like everything else). Same star
   * button toggles: ⭐ = pinned, ☆ = not. One shared starText() used by
   * result cards, history rescue rows and the vault drawer itself. */

  function saveVault() {
    try {
      chrome.storage.local.set({ [VAULT_KEY]: state.vault });
    } catch (e) {}
  }

  function updateVaultBadge() {
    try {
      const b = vaultBtn && vaultBtn.querySelector(".rr-vbadge");
      if (b) b.textContent = state.vault.length ? ` ${state.vault.length}` : "";
    } catch (e) {}
  }

  function isStarred(text) {
    return state.vault.some((e) => e && e.text === text);
  }

  function starText(text, btn) {
    const v = String(text || "").trim();
    if (!v) return;
    if (isStarred(v)) {
      state.vault = state.vault.filter((e) => e.text !== v);
      if (btn) {
        btn.textContent = "☆";
        btn.classList.remove("rr-on");
        btn.title = "Star it — save to your Vault";
      }
    } else {
      state.vault.unshift({ text: v, ts: Date.now() });
      state.vault = state.vault.slice(0, VAULT_MAX);
      if (btn) {
        btn.textContent = "⭐";
        btn.classList.add("rr-on");
        btn.title = "In your Vault — click to remove";
      }
    }
    saveVault();
    updateVaultBadge();
  }

  function renderVault() {
    vaultBox.innerHTML = "";
    const top = document.createElement("div");
    top.className = "rr-hist-top";
    const title = document.createElement("strong");
    title.textContent = `⭐ Vault (${state.vault.length}/${VAULT_MAX})`;
    const clearBtn = document.createElement("button");
    clearBtn.className = "rr-mini";
    clearBtn.textContent = "Clear";
    clearBtn.addEventListener("click", () => {
      state.vault = [];
      saveVault();
      renderVault();
    });
    top.appendChild(title);
    top.appendChild(clearBtn);
    vaultBox.appendChild(top);

    if (!state.vault.length) {
      const p = document.createElement("p");
      p.className = "rr-hist-empty";
      p.textContent = "No starred replies yet — hit ⭐ on any reply you'd reuse.";
      vaultBox.appendChild(p);
      return;
    }
    state.vault.forEach((entry, i) => {
      const row = document.createElement("div");
      row.className = "rr-hist-row";
      const txt = document.createElement("span");
      txt.textContent = entry.text;
      const btns = document.createElement("span");
      btns.style.display = "flex";
      const cp = document.createElement("button");
      cp.className = "rr-mini";
      cp.textContent = "Copy";
      cp.addEventListener("click", () => copyText(entry.text, cp));
      const rm = document.createElement("button");
      rm.className = "rr-mini";
      rm.textContent = "✕";
      rm.title = "Remove from Vault";
      rm.addEventListener("click", () => {
        state.vault.splice(i, 1);
        saveVault();
        updateVaultBadge();
        renderVault();
      });
      btns.appendChild(cp);
      btns.appendChild(rm);
      row.appendChild(txt);
      row.appendChild(btns);
      vaultBox.appendChild(row);
    });
  }

  vaultBtn.addEventListener("click", () => {
    const open = vaultBox.style.display !== "none";
    if (open) {
      vaultBox.style.display = "none";
    } else {
      renderVault();
      vaultBox.style.display = "block";
      bioBox.style.display = "none"; // one drawer at a time
      agentBox.style.display = "none";
      histBox.style.display = "none";
      queueBox.style.display = "none";
    }
  });

  /* ---------- 📋 BATCH QUEUE (v0.9.0) — park tweets while you scroll ------
   * PC twin of the Android /rizz/batch page: see a tweet worth replying to,
   * hit ＋ Add current and keep scrolling. Later open them from this drawer
   * one by one — the 🤖 Auto-write flow (full-read → thread → generate →
   * auto-type) takes over on each. Lives in chrome.storage.local, capped,
   * deduped by status id. The human fires every reply — the agent only
   * stages them. */
  function saveQueue() {
    try {
      chrome.storage.local.set({ [QUEUE_KEY]: state.queue });
    } catch (e) {}
  }

  function updateQueueBadge() {
    try {
      const b = queueBtn && queueBtn.querySelector(".rr-qbadge");
      if (b) b.textContent = state.queue.length ? ` ${state.queue.length}` : "";
    } catch (e) {}
  }

  function renderQueue() {
    queueBox.innerHTML = "";
    const top = document.createElement("div");
    top.className = "rr-hist-top";
    const title = document.createElement("strong");
    title.textContent = `📋 Queue (${state.queue.length}/${QUEUE_MAX})`;
    const btns = document.createElement("span");
    const addBtn = document.createElement("button");
    addBtn.className = "rr-mini";
    addBtn.textContent = "＋ Add current";
    addBtn.title = "Park the tweet currently on screen";
    addBtn.addEventListener("click", addCurrentToQueue);
    const clearBtn = document.createElement("button");
    clearBtn.className = "rr-mini";
    clearBtn.textContent = "Clear";
    clearBtn.addEventListener("click", () => {
      state.queue = [];
      saveQueue();
      updateQueueBadge();
      renderQueue();
    });
    btns.appendChild(addBtn);
    btns.appendChild(clearBtn);
    top.appendChild(title);
    top.appendChild(btns);
    queueBox.appendChild(top);

    if (!state.queue.length) {
      const p = document.createElement("p");
      p.className = "rr-hist-empty";
      p.textContent =
        "Empty — park tweets with ＋ Add current while you scroll, then work through them.";
      queueBox.appendChild(p);
      return;
    }

    const hint = document.createElement("p");
    hint.className = "rr-hist-empty";
    hint.textContent =
      "Open a tweet → hit 🤖 Auto-write there → come back for the next.";
    queueBox.appendChild(hint);

    state.queue.forEach((item) => {
      const row = document.createElement("div");
      row.className = "rr-hist-row";
      const txt = document.createElement("span");
      txt.textContent = item.label || `status ${item.id}`;
      txt.title = `https://x.com/i/status/${item.id}`;
      const open = document.createElement("button");
      open.className = "rr-mini";
      open.textContent = "Open ↗";
      open.title = "Open this tweet in a new tab";
      open.addEventListener("click", () => {
        try {
          window.open(`https://x.com/i/status/${item.id}`, "_blank");
        } catch (e) {
          dlog("queue: open failed", e);
        }
      });
      const rm = document.createElement("button");
      rm.className = "rr-mini";
      rm.textContent = "✕";
      rm.title = "Remove from queue";
      rm.addEventListener("click", () => {
        state.queue = state.queue.filter((q) => q.id !== item.id);
        saveQueue();
        updateQueueBadge();
        renderQueue();
      });
      row.appendChild(txt);
      row.appendChild(open);
      row.appendChild(rm);
      queueBox.appendChild(row);
    });
  }

  function addCurrentToQueue() {
    const det = updateTarget();
    const article = (det && det.article) || state.lastArticle || null;
    let id = article ? statusIdFromContext(article) : "";
    if (!id) {
      const u = location.pathname.match(/\/status\/(\d{1,25})/);
      id = u ? u[1] : "";
    }
    if (!id) {
      showError(
        "Nothing to queue — open or hover a tweet first, then add it."
      );
      return;
    }
    if (state.queue.some((q) => q.id === id)) {
      showError("Already queued ✓");
      return;
    }
    if (state.queue.length >= QUEUE_MAX) {
      showError(`Queue is full (${QUEUE_MAX}) — open a few or Clear first.`);
      return;
    }
    const who = article ? targetLabel(article) : "";
    const snippet = String((det && det.text) || textarea.value || "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 70);
    const label = snippet ? `${who} — ${snippet}…` : who || `status ${id}`;
    state.queue.push({ id, label, ts: Date.now() });
    saveQueue();
    updateQueueBadge();
    dlog(
      `queue: parked status ${id} — ${state.queue.length}/${QUEUE_MAX} queued`
    );
    renderQueue();
  }

  queueBtn.addEventListener("click", () => {
    const open = queueBox.style.display !== "none";
    if (open) {
      queueBox.style.display = "none";
    } else {
      renderQueue();
      queueBox.style.display = "block";
      bioBox.style.display = "none"; // one drawer at a time
      agentBox.style.display = "none";
      histBox.style.display = "none";
      vaultBox.style.display = "none";
    }
  });

  // 📥 Pull the user's current draft out of the open reply/Post box
  grabBtn.addEventListener("click", () => {
    const boxes = visibleComposers();
    const draft = boxes.length ? (boxes[0].innerText || "").trim() : "";
    if (!draft) {
      showError("No draft found — type something in a reply/Post box first.");
      return;
    }
    textarea.value = draft;
    dlog("grab: pulled the draft from the open composer");
  });

  // Mode pills
  const modeRow = root.querySelector('[data-row="mode"]');
  function setMode(m) {
    state.mode = m;
    modeRow.querySelectorAll(".rr-pill").forEach((p) => p.classList.remove("rr-on"));
    const target = Array.from(modeRow.querySelectorAll(".rr-pill")).find(
      (b) => b.textContent === MODE_LABELS[m]
    );
    if (target) target.classList.add("rr-on");
    textarea.placeholder = PLACEHOLDERS[m];
  }
  MODES.forEach((m) => {
    const b = document.createElement("button");
    b.className = "rr-pill" + (m === state.mode ? " rr-on" : "");
    b.textContent = MODE_LABELS[m];
    b.addEventListener("click", () => setMode(m));
    modeRow.appendChild(b);
  });

  // Tone pills
  const toneRow = root.querySelector('[data-row="tone"]');
  TONES.forEach((t) => {
    const b = document.createElement("button");
    b.className = "rr-pill" + (t === state.tone ? " rr-on" : "");
    b.textContent = TONE_LABELS[t];
    b.addEventListener("click", () => {
      state.tone = t;
      toneRow.querySelectorAll(".rr-pill").forEach((p) => p.classList.remove("rr-on"));
      b.classList.add("rr-on");
    });
    toneRow.appendChild(b);
  });

  // Length pills
  const lengthRow = root.querySelector('[data-row="length"]');
  LENGTHS.forEach((l) => {
    const b = document.createElement("button");
    b.className = "rr-pill" + (l === state.length ? " rr-on" : "");
    b.textContent = LENGTH_LABELS[l];
    b.addEventListener("click", () => {
      state.length = l;
      lengthRow
        .querySelectorAll(".rr-pill")
        .forEach((pp) => pp.classList.remove("rr-on"));
      b.classList.add("rr-on");
    });
    lengthRow.appendChild(b);
  });

  function togglePanel() {
    const show = panel.style.display === "none";
    panel.style.display = show ? "flex" : "none";
    bubble.classList.toggle("rr-active", show);
    if (show) {
      updateTarget();
      if (!textarea.value.trim() && state.lastTweet) {
        textarea.value = state.lastTweet;
      }
      textarea.focus();
    }
  }

  /* Draggable bubble — drag to move anywhere, plain click still opens.
     Position is remembered across sessions. */
  let drag = null;
  let suppressClick = false;
  bubble.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, y: e.clientY, moved: false };
    try {
      bubble.setPointerCapture(e.pointerId);
    } catch (err) {}
  });
  bubble.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 6) return;
    drag.moved = true;
    const r = bubble.getBoundingClientRect();
    const nx = Math.min(Math.max(4, r.left + dx), window.innerWidth - r.width - 4);
    const ny = Math.min(Math.max(4, r.top + dy), window.innerHeight - r.height - 4);
    bubble.style.left = nx + "px";
    bubble.style.top = ny + "px";
    bubble.style.right = "auto";
    bubble.style.bottom = "auto";
    drag.x = e.clientX;
    drag.y = e.clientY;
  });
  bubble.addEventListener("pointerup", () => {
    if (!drag) return;
    if (drag.moved) {
      suppressClick = true;
      const r = bubble.getBoundingClientRect();
      try {
        chrome.storage.sync.set({ rizzBubblePos: { x: r.left, y: r.top } });
      } catch (err) {}
    }
    drag = null;
  });

  // Restore the last saved bubble position
  try {
    chrome.storage.sync.get(["rizzBubblePos"], (r) => {
      const p = r && r.rizzBubblePos;
      if (p && typeof p.x === "number" && typeof p.y === "number") {
        bubble.style.left =
          Math.min(Math.max(4, p.x), window.innerWidth - 60) + "px";
        bubble.style.top =
          Math.min(Math.max(4, p.y), window.innerHeight - 60) + "px";
        bubble.style.right = "auto";
        bubble.style.bottom = "auto";
      }
    });
  } catch (e) {}

  bubble.addEventListener("click", () => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    togglePanel();
  });
  root.querySelector(".rr-close").addEventListener("click", togglePanel);

  // Stop the attention pulse after first interaction
  bubble.addEventListener("click", () => bubble.classList.remove("rr-pulse"), {
    once: true,
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panel.style.display !== "none") togglePanel();
    if (
      e.altKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      (e.key === "r" || e.key === "R")
    ) {
      e.preventDefault();
      togglePanel();
    }
  });

  function showError(msg) {
    const old = results.querySelector(".rr-err");
    if (old) old.remove();
    const div = document.createElement("div");
    div.className = "rr-err";
    div.textContent = msg;
    results.prepend(div);
  }

  // Transport: service-worker bridge first (extension context — immune to
  // x.com page CSP), direct fetch as fallback. Shared by generate() and the
  // per-variant re-roll so both paths get identical networking behavior.
  async function callApi(payload) {
    const hopErrors = [];
    try {
      const resp = await new Promise((resolve, reject) => {
        try {
          chrome.runtime.sendMessage(
            { type: "rizz-fetch", url: apiUrl(), payload },
            (r) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else {
                resolve(r);
              }
            }
          );
        } catch (e) {
          reject(e);
        }
      });
      if (resp && resp.ok) {
        dlog(`API via background bridge ✓ (status ${resp.out.status})`);
        return {
          ok: resp.out.ok,
          status: resp.out.status,
          data: resp.out.data,
        };
      }
      hopErrors.push(`bridge: ${(resp && resp.error) || "no response"}`);
      throw new Error((resp && resp.error) || "bridge failed");
    } catch (bridgeErr) {
      dlog("bridge unavailable — falling back to direct fetch", bridgeErr);
      try {
        const res = await fetch(apiUrl(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => null);
        dlog(`API via direct fetch (status ${res.status})`);
        return { ok: res.ok, status: res.status, data };
      } catch (directErr) {
        hopErrors.push(
          `direct: ${(directErr && directErr.message) || directErr}`
        );
        throw new Error(
          hopErrors.some((h) => /failed to fetch/i.test(h))
            ? "Network blocked — check your internet, then clean-reinstall the latest extension (README step 3)"
            : `All paths failed — ${hopErrors.join(" | ")}`
        );
      }
    }
  }

  // opts.toneOverride — FULL AUTO runs force 🎲 auto (the Brain picks the
  // best tone per STEP 0.5) without touching the user's selected pill.
  async function generate(opts) {
    const o = opts || {};
    const tweet = textarea.value.trim();
    if (!tweet) {
      showError("Paste or hover-grab a tweet first ✍️");
      return null;
    }
    // Author handle gives the server context ("replying to @who") — best effort
    let author = "";
    try {
      const label = state.lastArticle ? targetLabel(state.lastArticle) : "";
      if (label && label !== "tweet") author = label;
    } catch (e) {}
    const modeUsed = state.mode;
    const toneUsed = o.toneOverride || state.tone;
    const directive = agentDirective();
    state.loading = true;
    goBtn.disabled = true;
    goBtn.textContent = "Cooking rizz...";
    results.innerHTML = "";

    // v0.8.2: thread context (from the last agent run) + voice memory ride
    // along — both optional, both absent → identical to v0.8.1 behavior.
    const voiceStyle = await loadVoiceStyle();

    const payload = {
      tweet,
      mode: modeUsed,
      tone: toneUsed,
      author,
      bio: state.bio,
      length: state.length,
      agent: directive,
      thread: Array.isArray(state.threadCtx) ? state.threadCtx : [],
      style: voiceStyle,
    };

    try {
      const { ok, status, data } = await callApi(payload);
      if (!ok || !data || !data.variants) {
        throw new Error(
          (data && data.error) ||
            (status === 404
              ? "API 404 — endpoint missing (old build installed? update to latest)"
              : `Request failed (${status})`)
        );
      }
      data.variants.forEach((v, i) => {
        const card = document.createElement("div");
        card.className = "rr-card";
        const p = document.createElement("p");
        p.textContent = v;
        const foot = document.createElement("div");
        foot.className = "rr-card-foot";
        const meta = document.createElement("span");
        meta.className = "rr-meta";
        meta.textContent = `${v.length} chars ${v.length > 280 ? "⚠️" : "✓"}`;

        const actions = document.createElement("div");
        actions.className = "rr-actions";

        // ⚡ Auto-type — all modes since v0.5.0 (reply / quote / hook)
        const btnType = document.createElement("button");
        btnType.className = "rr-type";
        btnType.textContent = "⚡ Auto-type";
        btnType.addEventListener("click", async () => {
          btnType.disabled = true;
          btnType.textContent = "Typing...";
          const ok = await autoType(v, modeUsed);
          if (ok) {
            btnType.textContent = "Typed ✓";
            btnType.classList.add("rr-done");
            rememberVoice(v); // 🧠 voice memory — typed = kept
            // Close the panel so the filled reply box is visible
            setTimeout(() => {
              if (panel.style.display !== "none") togglePanel();
            }, 900);
            setTimeout(() => {
              btnType.textContent = "⚡ Auto-type";
              btnType.classList.remove("rr-done");
              btnType.disabled = false;
            }, 2200);
          } else {
            btnType.disabled = false;
            btnType.textContent = "⚡ Auto-type";
            showError(
              "Couldn't type 😤 Open the composer once (reply 💬 / retweet 🔁 / Post), click inside it, then hit Auto-type again — or use Copy."
            );
          }
        });
        actions.appendChild(btnType);

        const btn = document.createElement("button");
        btn.className = "rr-copy";
        btn.textContent = "Copy";
        btn.addEventListener("click", () => copyText(v, btn));
        actions.appendChild(btn);

        // ⭐ Star — pin this reply to the Vault (v0.10.0). Reads the LIVE
        // card text, so a re-rolled variant stars what's on screen now.
        const btnStar = document.createElement("button");
        btnStar.className = "rr-star" + (isStarred(p.textContent) ? " rr-on" : "");
        btnStar.textContent = isStarred(p.textContent) ? "⭐" : "☆";
        btnStar.title = isStarred(p.textContent)
          ? "In your Vault — click to remove"
          : "Star it — save to your Vault";
        btnStar.addEventListener("click", () => starText(p.textContent, btnStar));
        actions.appendChild(btnStar);

        // ↻ Re-roll — fresh replacement for just THIS variant (count: 1)
        const btnRe = document.createElement("button");
        btnRe.className = "rr-reroll";
        btnRe.title = "Re-roll just this one";
        btnRe.textContent = "↻";
        btnRe.addEventListener("click", async () => {
          if (state.loading || btnRe.disabled) return;
          btnRe.disabled = true;
          btnRe.textContent = "…";
          try {
            const out = await callApi({ ...payload, count: 1 });
            if (
              !out.ok ||
              !out.data ||
              !out.data.variants ||
              !out.data.variants.length
            ) {
              throw new Error(
                (out.data && out.data.error) ||
                  `Request failed (${out.status})`
              );
            }
            const nv = out.data.variants[0];
            p.textContent = nv;
            meta.textContent = `${nv.length} chars ${nv.length > 280 ? "⚠️" : "✓"}`;
            data.variants[i] = nv; // keep the batch (and history) consistent
            updateLastHistory(i, nv);
            dlog(`re-roll: variant ${i + 1} replaced`);
          } catch (e) {
            showError(e instanceof Error ? e.message : "Re-roll failed");
          } finally {
            btnRe.disabled = false;
            btnRe.textContent = "↻";
          }
        });
        actions.appendChild(btnRe);

        foot.appendChild(meta);
        foot.appendChild(actions);
        card.appendChild(p);
        card.appendChild(foot);
        results.appendChild(card);
      });

      // One-click fresh batch with the same input (keeps the same tone/mission)
      const again = document.createElement("button");
      again.className = "rr-again";
      again.textContent = "🔄 regenerate 3 more";
      again.addEventListener("click", () => {
        if (!state.loading) generate({ toneOverride: toneUsed });
      });
      results.appendChild(again);

      // 🕘 Remember this batch (history keeps the most recent 15)
      state.history.unshift({
        ts: Date.now(),
        mode: modeUsed,
        tone: toneUsed,
        tweet: tweet.slice(0, 90),
        variants: data.variants.slice(),
      });
      state.history = state.history.slice(0, HISTORY_MAX);
      saveHistory();

      return data.variants;
    } catch (err) {
      showError(err instanceof Error ? err.message : "Generation failed");
      return null;
    } finally {
      state.loading = false;
      goBtn.disabled = false;
      goBtn.textContent = "✨ Generate 3 options";
    }
  }

  goBtn.addEventListener("click", generate);

  /* ---------- agent mode: FULL AUTO — read → tone → write (v0.7.0) ----------
   * One tap: locks onto the tweet on screen, lets the Brain pick the best
   * tone (🎲 auto), generates with the saved mission, auto-types variant 1
   * into the reply box. Human still presses Post. */

  /* ---------- v0.8.1 FULL-READ: complete tweet text via keyless API ----------
   * The DOM can only give us what X rendered — timeline-clamped behind
   * "Show more", or missing the tail when a tweet is partially virtualized.
   * Since v0.8.0 we run a keyless tweet-fetch endpoint (/api/rizz/fetch,
   * same one the Android bubble uses): give it a status ID, it returns the
   * CANONICAL full text. The agent now resolves the on-screen tweet's ID
   * and upgrades its read before generating. Cache + hard timeout keep
   * Auto-write feeling instant; any failure just falls back to DOM text. */

  const fullReadCache = new Map(); // statusId -> full text
  const FULLREAD_TIMEOUT_MS = 4500;

  function statusIdFromContext(article) {
    // Prefer the article's OWN timestamp link (its first /status/ href) —
    // on a parent-tweet page the URL id can point at a different tweet.
    try {
      const link = article.querySelector("a[href*='/status/']");
      const m =
        link &&
        (link.getAttribute("href") || "").match(/\/status\/(\d{1,25})/);
      if (m) return m[1];
    } catch (e) {}
    const u = location.pathname.match(/\/status\/(\d{1,25})/);
    return u ? u[1] : "";
  }

  async function fullReadText(statusId) {
    if (!statusId) return null;
    if (fullReadCache.has(statusId)) return fullReadCache.get(statusId);
    const payload = { url: `https://x.com/i/status/${statusId}` };
    const work = callApiPath(payload);
    const guard = new Promise((resolve) =>
      setTimeout(() => resolve(null), FULLREAD_TIMEOUT_MS)
    );
    const out = await Promise.race([work, guard]);
    if (out && out.ok && out.data && typeof out.data.text === "string") {
      const text = out.data.text.trim().slice(0, 1200);
      if (text) {
        if (fullReadCache.size > 20) fullReadCache.clear();
        fullReadCache.set(statusId, text);
        return text;
      }
    }
    return null;
  }

  /* ---------- v0.8.2 THREAD PACK: conversation context, keyless ----------
   * A reply that only sees the last tweet misses the conversation's shape
   * (what was already said, who asked what). /api/rizz/thread walks the
   * parent chain keylessly (same trust level as full-read) and returns the
   * messages OLDEST FIRST, target last. Failure degrades to no context —
   * never faked. Cached per status like full-read. */
  const threadCache = new Map(); // statusId -> chain[] (may be [])

  async function threadChain(statusId) {
    if (!statusId) return null;
    if (threadCache.has(statusId)) return threadCache.get(statusId);
    const payload = { url: `https://x.com/i/status/${statusId}` };
    const work = callApiPath(payload, "/api/rizz/thread");
    const guard = new Promise((resolve) =>
      setTimeout(() => resolve(null), THREAD_TIMEOUT_MS)
    );
    const out = await Promise.race([work, guard]);
    if (out && out.ok && out.data && Array.isArray(out.data.chain)) {
      // chain includes the target itself as the last item — drop it, the
      // tweet text already travels in the payload. Server re-checks anyway.
      const chain = out.data.chain
        .slice(0, -1)
        .map((c) => ({
          author: String((c && c.author) || "").slice(0, 30),
          text: String((c && c.text) || "").slice(0, 400),
        }))
        .filter((c) => c.text)
        .slice(-2);
      if (threadCache.size > 20) threadCache.clear();
      threadCache.set(statusId, chain);
      return chain;
    }
    return null;
  }

  /* ---------- v0.8.2 VOICE MEMORY: replies you keep teach your voice ----
   * Every Auto-typed or copied reply lands in chrome.storage.local (device
   * only, capped 30). Before generating, the last 4 ride along as loose
   * style guidance — the Brain matches your rhythm, never copies facts. */
  function loadVoiceStyle() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([VOICE_KEY], (r) => {
          const list = (r && Array.isArray(r[VOICE_KEY]) && r[VOICE_KEY]) || [];
          resolve(list.slice(-4).join("\n").slice(0, 700));
        });
      } catch (e) {
        resolve("");
      }
    });
  }

  function rememberVoice(text) {
    const v = String(text || "").trim();
    if (!v) return;
    try {
      chrome.storage.local.get([VOICE_KEY], (r) => {
        const list = (r && Array.isArray(r[VOICE_KEY]) && r[VOICE_KEY]) || [];
        const next = [...list.filter((s) => s !== v), v].slice(-30);
        chrome.storage.local.set({ [VOICE_KEY]: next });
      });
    } catch (e) {}
  }

  // Dedicated fetch to /api/rizz/fetch (or any allowed API path): bridge
  // first (background proxies it — see background.js ALLOWED_PATHS), direct
  // fetch as the fallback path.
  function callApiPath(payload, path = "/api/rizz/fetch") {
    const url = `${normalizeBase(apiBase)}${path}`;
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          { type: "rizz-fetch", url, payload },
          (r) => {
            if (chrome.runtime.lastError || !r || !r.ok) {
              resolve(null);
              return;
            }
            resolve({ ok: r.out.ok, status: r.out.status, data: r.out.data });
          }
        );
      } catch (e) {
        resolve(null);
      }
    }).then(async (bridged) => {
      if (bridged) return bridged;
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => null);
        return { ok: res.ok, status: res.status, data };
      } catch (e) {
        return null;
      }
    });
  }

  async function agentGo() {
    if (state.loading) return;
    const det = updateTarget();
    if (det) textarea.value = det.text;
    if (!textarea.value.trim()) {
      showError(
        "No tweet in sight 👀 — open one or scroll so a tweet is on screen, then hit Auto-write again."
      );
      return;
    }
    setMode("reply");
    agentBtn.disabled = true;
    goBtn.disabled = true;
    const prevLabel = agentBtn.textContent;
    agentBtn.textContent = "🤖 Auto: reading screen…";
    dlog(
      `agent: FULL AUTO run — mission "${agentShortLabel()}", tone 🎲 auto`
    );

    // FULL-READ upgrade: if we can resolve a status ID, pull the canonical
    // full text (beats clamped/virtualized DOM reads). Only replaces the
    // DOM read when the API text is at least as long — never downgrade.
    let statusId = "";
    try {
      const article =
        (det && det.article) || state.lastArticle || null;
      statusId = article ? statusIdFromContext(article) : "";
      if (statusId) {
        agentBtn.textContent = "🤖 Auto: full read…";
        const full = await fullReadText(statusId);
        const domText = textarea.value.trim();
        if (full && (!domText || full.length >= domText.length)) {
          textarea.value = full;
          if (state.lastArticle) {
            const who = targetLabel(state.lastArticle);
            targetEl.style.display = "block";
            targetEl.textContent = `🎯 locked on ${who} — full read ✓ (${full.length} chars)`;
          }
          dlog(
            `agent: full-read ✓ id=${statusId} — ${full.length} chars (DOM had ${domText.length})`
          );
        } else if (full) {
          dlog("agent: full-read returned shorter text — keeping DOM read");
        } else if (det && articleClamped(article)) {
          targetEl.style.display = "block";
          targetEl.textContent = `🎯 locked on ${targetLabel(
            article
          )} — feed-clamped, using visible text`;
          dlog("agent: full-read unavailable and DOM looks clamped — proceeding");
        }
      }
    } catch (e) {
      dlog("agent: full-read step skipped", e);
    }

    // 🧵 THREAD CONTEXT (v0.8.2): walk the reply chain keylessly so the
    // Brain sees the whole conversation. Best effort, 4s cap, cached —
    // a failure just means single-tweet mode (exactly v0.8.1 behavior).
    state.threadCtx = [];
    if (statusId) {
      try {
        agentBtn.textContent = "🤖 Auto: thread…";
        const chain = await threadChain(statusId);
        if (chain && chain.length) {
          state.threadCtx = chain;
          if (state.lastArticle) {
            targetEl.style.display = "block";
            targetEl.textContent += ` — 🧵 thread ×${chain.length} ✓`;
          }
          dlog(`agent: thread context ✓ — ${chain.length} parent tweet(s)`);
        } else {
          dlog("agent: thread chain empty (standalone tweet or upstream miss)");
        }
      } catch (e) {
        dlog("agent: thread step skipped", e);
      }
    }

    const variants = await generate({ toneOverride: "auto" });
    agentBtn.disabled = false;
    agentBtn.textContent = prevLabel;
    if (!Array.isArray(variants) || !variants.length) {
      dlog("agent: generation returned nothing — see error card");
      return;
    }

    agentBtn.textContent = "🤖 Auto: typing reply…";
    const pick = variants[0];
    dlog(`agent: auto-typing variant 1/${variants.length} into the reply box…`);
    const ok = await autoType(pick, "reply");
    if (ok) {
      dlog("agent: DONE — reply written, YOU press Post 🚀");
    } else {
      showError(
        "Agent couldn't reach the reply box 😤 Open the tweet's reply box once (click 💬), then hit ⚡ Auto-type on the cards below."
      );
    }
  }
  agentBtn.addEventListener("click", agentGo);

  // Keep the lock fresh while he scrolls the feed ("fetching the screen")
  let lastScrollRead = 0;
  document.addEventListener(
    "scroll",
    () => {
      const now = Date.now();
      if (now - lastScrollRead < 400) return;
      lastScrollRead = now;
      updateTarget();
    },
    { passive: true }
  );
})();
