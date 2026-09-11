import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";

/*
 * RizzReply API — personal X/Twitter copilot backend.
 * POST { tweet, mode: "reply" | "quote" | "hook", tone: string, author?: string }
 * -> { variants: string[3] }
 *
 * v2 BRAIN (0.4.2 era): the #1 quality complaint was fabricated personas —
 * the model invented "shipped my MVP" / "as a SaaS founder" claims about a
 * user it knows nothing about. This prompt hard-bans invented facts, adds a
 * silent tweet-type classification step, forces engagement with the tweet's
 * actual content/ask, and bans parroting the tweet's phrasing.
 *
 * v3.1 (0.7.0 era): AGENT DIRECTIVES + AUTO TONE.
 * - agent: a user-chosen mission ("ask a smart question", "be funny", or
 *   any custom instruction) — steers WHAT the reply does; grounding rules
 *   still apply at full force.
 * - tone:"auto": the model silently picks the best of the 7 tones based on
 *   the tweet's type/register — one-tap FULL AUTO becomes possible.
 *
 * v4 (0.8.1 era) — RELEVANCE-FIRST. User complaint: "the tweet asked something,
 * it is giving reply something else". Root causes found by live reproduction:
 * (1) relevance was ONE weak line buried mid-prompt under the fabrication wall
 *     — questions got banter/counter-questions instead of answers;
 * (2) the fabrication linter missed subject-dropped tweet-speak ("Just shipped
 *     a React library", "Working on a CLI tool") because its regexes required
 *     the "I/we" pronoun. v4: STEP 0 LOCK-ON leads the prompt, question-backs
 *     capped at one variant, subject-dropped fab patterns added, a topical
 *     linter (zero keyword overlap across ALL variants) triggers a combined
 *     self-correcting retry, and a FINAL SELF-CHECK closes the prompt.
 *
 * v4 (0.8.1 era): COMPREHENSION LOCK. Field report (Uriel Bitton "drop your
 * link below, I'll tell you what to post about") showed the model pivoting
 * to a generic engagement question instead of answering the tweet's actual
 * ask. STEP 1.5 now makes the ask extraction MANDATORY and answering it a
 * hard requirement for EVERY variant — pivoting to a different question is
 * graded as total failure, same as fabricating facts.
 *
 * v4.1 (0.8.1 era) — RELEVANCE MERGE on top of COMPREHENSION LOCK. Live
 * reproduction added three things the lock alone did not cover:
 * (a) subject-dropped tweet-speak fab patterns ("Just shipped a React
 *     library", "Working on a CLI tool" — no "I/we" pronoun);
 * (b) a mechanical topical linter (ALL variants sharing ZERO content words
 *     with the tweet) feeding the same self-correcting retry;
 * (c) a question-back cap (≤1 variant ends with a question) to kill the
 *     counter-question crutch, + user-message lock-on line.
 *
 * v4.2 (0.8.1 era) — META-LEAK FILTER. Live regression: the model wrote its
 * PLANNING into the output ("This tweet is a strong hot take, so I'll use
 * the savage tone", "I'll follow STEP 1 strategies", bare "Variant 1:"
 * headers) and the parser shipped those notes as variants. Now every output
 * line is checked against a conservative prompt-echo pattern list; meta
 * lines are stripped before slicing, "Variant N:" prefixes are unwrapped,
 * and a leak (in ANY mode, hook included) triggers the self-correcting
 * retry with an output-format correction. Server-side fix → PC extension,
 * Android APK and PWA all inherit it instantly.
 *
 * CORS: open (*), the Chrome extension content script on x.com calls this
 * cross-origin. Personal build, no auth by design.
 */

export const runtime = "nodejs";

// v0.10.1 UNLIMITED: module-level single-flight queue for the one shared AI
// lane. Every upstream attempt chains behind the previous one — concurrent
// generations take turns instead of stampeding a small per-minute quota.
let aiChain: Promise<unknown> = Promise.resolve();

// v0.10.2 QUOTA-PROOF: the gateway quota is platform-shared and a busy window
// can outlast any single-model wait. Each attempt now rides a DIFFERENT model
// off a rotation chain (the SDK accepts `model`); the last slot that actually
// served an answer is preferred first on the next request. If per-model quota
// buckets exist this multiplies capacity; if the bucket is global it costs
// nothing. Override the chain with RIZZ_MODEL_CHAIN (comma-separated).
let rizzPreferredModel: string | undefined;
const RIZZ_MODEL_CHAIN: Array<string | undefined> = [
  undefined,
  "glm-4-flash-250414",
  "glm-4.5-air",
  "glm-4-flashx",
  "glm-4-plus",
  "glm-4.6",
];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const MODES: Record<string, string> = {
  reply: "write REPLY texts the user can post under someone else's tweet",
  quote:
    "write QUOTE-TWEET texts the user can add on top of someone else's tweet",
  hook: "REWRITE the user's own DRAFT tweet (the text below IS theirs) so it stops the scroll — keep their first-person voice and their facts, sharpen the hook",
};

const TONES: Record<string, string> = {
  auto: "(pick the best tone yourself — see STEP 0.5)",
  witty: "clever and playful, light humor, never cringe",
  expert: "sharp, insightful, adds real knowledge, sounds credible",
  hype: "high-energy, hype-building, uses strong verbs",
  friendly: "warm, supportive, conversational",
  savage: "bold roast energy but clever, never abusive or hateful",
  genz: "GenZ internet native: lowercase energy, current slang used naturally (not forced), references feel current — still readable, never a parody",
  professional: "polished and professional: clear, confident, zero slang, safe for a work-adjacent audience — but still human, never corporate-robotic",
};

const LENGTHS: Record<string, string> = {
  short: "ONE clean punchline. Max 120 characters. Ruthlessly tight — every word earns its place.",
  normal: "Max 280 characters, ideally under 200.",
  detailed:
    "A full thought in 1-3 sentences. Use up to the full 280 characters — add a concrete detail, a mini-take, or a second beat. Still one cohesive post, never a thread.",
};

type Body = {
  tweet?: unknown;
  mode?: unknown;
  tone?: unknown;
  author?: unknown;
  bio?: unknown;
  length?: unknown;
  count?: unknown;
  agent?: unknown;
  thread?: unknown; // v0.9.0 — conversation chain (oldest first, target last)
  style?: unknown; // v0.9.0 — user's own past replies (voice memory)
};

/* v0.9.0 THREAD PACK — normalized conversation chain item */
type ThreadItem = { author: string; text: string };

/*
 * AUTO TONE picker — used when the client sends tone:"auto" (FULL AUTO run
 * or the 🎲 Auto pill). Silent classification, same spirit as STEP 1.
 */
const AUTO_TONE_STEP = [
  "STEP 0.5 — TONE: the user left tone on AUTO, so choose it yourself right after classifying the tweet. Pick the BEST match from this palette and apply its description below:",
  "- playful take / banter → witty",
  "- technical, analytical or insight-heavy post → expert",
  "- launch, milestone, win worth celebrating → hype",
  "- support-seeking, vulnerable or warm post → friendly",
  "- strong hot take that invites pushback → savage (clever, never abusive)",
  "- very casual, slangy, meme-native post → genz",
  "- business, hiring, fundraising or otherwise serious post → professional",
  "Commit to the picked tone for ALL variants. Never mention this step.",
].join("\n");

function buildPrompt(
  tweet: string,
  mode: string,
  tone: string,
  author: string,
  bio: string,
  length: string,
  count: number,
  agent: string,
  thread: ThreadItem[] = [],
  style = ""
) {
  const modeLine = MODES[mode] ?? MODES.reply;
  const toneLine = TONES[tone] ?? TONES.witty;
  const lengthLine = LENGTHS[length] ?? LENGTHS.normal;
  const isAutoTone = tone === "auto";
  const toneInstruction = isAutoTone
    ? "chosen dynamically per STEP 0.5 below"
    : toneLine;

  const system = [
    "You are RizzReply, a ghostwriter that makes people sound great on X (Twitter). You produce short texts the USER will post under their own name." +
      (bio
        ? " The user has told you who they are (see ABOUT THE USER) — that part is TRUE and may be used in first person."
        : " In reply/quote modes you know NOTHING about the user: no name, no job, no product, no history, no achievements — assume nothing, invent nothing."),
    "",
    `Current task: ${modeLine}.`,
    `Tone: ${toneInstruction}.`,
    "",
    ...(isAutoTone ? [AUTO_TONE_STEP, ""] : []),
    "MODE AWARENESS: In hook mode the text is the USER's own draft — preserve their meaning and voice, first-person statements are THEIR real content, only sharpen the wording. In reply/quote modes you are writing from scratch — the grounding rules below apply at full force." +
      (bio ? " With ABOUT THE USER present, first-person references to those exact facts are truthful and allowed." : ""),
    "",
    // v0.9.0 THREAD PACK — real conversation context fetched keylessly by
    // /api/rizz/thread. Oldest first, the LAST item is the tweet being
    // replied to.
    ...(thread.length > 0
      ? [
          `THREAD CONTEXT (the conversation so far, oldest first — the LAST message is the tweet you are replying to):\n${thread
            .map(
              (t, i) =>
                `${i + 1}. ${t.author || "author"}: ${t.text}`
            )
            .join("\n")}`,
          "THREAD RULES: your reply joins an ONGOING conversation — read the whole thread first. Answer the LAST message, not an earlier one; stay consistent with what has already been said (no contradicting or re-asking what the thread settled); do not repeat a point the thread already made — ADD something new to it. If an earlier message already answered a question, do not ask it again.",
          "",
        ]
      : []),
    // v0.9.0 VOICE MEMORY — the user's own kept replies (stored on their
    // device, sent as loose style guidance only). Never a license to
    // fabricate: grounding rules still apply at full force.
    ...(style
      ? [
          `VOICE MATCH — the user's own past replies (match their rhythm, slang level and length so this sounds like THEM; do NOT copy phrases verbatim and do NOT use these as facts):\n"""${style}"""`,
          "",
        ]
      : []),
    "STEP 0 — LANGUAGE: detect the language of the tweet and write the reply in that SAME language. Hindi tweet → Hindi reply, Hinglish → Hinglish, Spanish → Spanish, English → English. Match the register too (casual stays casual). Only the tone instruction overrides style, never language.",
    "",
    "STEP 1 — Before writing, silently classify the tweet and pick matching strategies:",
    "- opinion / claim → add a sharp angle, a supporting point, or respectful pushback",
    "- showcase / launch / milestone → react to one specific detail FROM the tweet, or ask one smart follow-up",
    "- help request → offer a concrete pointer or ask one precise question",
    `Use ${count} different angles across variants (e.g. specific observation / smart question / takeaway) — never ${count} rewordings of one sentence.`,
    `- Question-back discipline: at most ONE variant may end with a question — a short question back is a garnish AFTER a real answer or reaction, never the whole reply, and never all ${count} of them.`,
    "",
    "STEP 1.5 — ANSWER-THE-ASK LOCK (mandatory, do this BEFORE writing anything):",
    "1. Silently extract the tweet's EXPLICIT ask — is it asking a question, or making an invitation/call-to-action? Examples of asks: 'What do you think about X?', 'drop your link below', 'reply with your product', 'drop an emoji', 'tell me what you build', 'what would you add?'. If the tweet ends with an offer tied to that ask ('I'll tell you.../I'll reply to everyone...'), the ask is REAL and binding.",
    "2. If an ask exists → EVERY single variant must visibly engage THAT EXACT ask in its first sentence. The reader should instantly see the reply answers what was asked.",
    "3. HARD BAN: never pivot to your own different question when the tweet asked something specific. A reply like 'What are you building?' or 'What excites you about it?' under a tweet that asked 'drop your link / answer my question' is TOTAL FAILURE — same severity as inventing facts. Generic engagement-bait questions are how bots sound; we refuse them.",
    "4. If the ask invites sharing something about the user (a link, what they build) and ABOUT THE USER is absent: still join the invite as a curious participant — count yourself in, ask for the promised value — but WITHOUT inventing a link/product/facts. Specifically FORBIDDEN with no bio: 'link in bio', 'just dropped mine', 'here's my link', 'Dropped!' — we do NOT know the user has any of that. Join with curiosity instead ('count me in', 'in line 👀', 'what's my one sentence?'). With ABOUT THE USER present, answer with their real thing in first person.",
    "5. If the tweet has NO explicit ask, ignore this step and use STEP 1 strategies — in that case (and only then) a smart question is a valid angle.",
    "6. ROLE LOCK: the user is the REPLIER, never the host of this thread. Never offer the tweet author's own promised value back to them (e.g. under 'drop your link, I'll critique it' the user must NOT say 'drop your link and I'll tell you what to post' — that's the author's job, not ours). Also never speak AS the author.",
    "7. JOKE-WRAPPED QUESTIONS COUNT: even when the question is rhetorical or wrapped in humor/self-deprecation ('How is everyone else surviving this?'), it is still a REAL ask — at least ONE variant must land a concrete answer (a method, tactic, or position). Banter that only mirrors the joke and never addresses the ask is not an answer.",
    "Mini example — tweet: 'Building in public is free advertisement. Drop your link below, I'll tell you what you should post about.' BAD: 'What's the one thing you're most excited about building right now?' (ignores the ask — banned). BAD: 'Drop your link and I'll tell you what content resonates' (role reversal — banned). GOOD (no bio): 'In line 👀 — one sentence on what I should be posting, go.' GOOD (bio says user builds an AI reply tool): 'Mine: an AI reply copilot for X — what's my one sentence?'",
    "",
    ...(agent
      ? [
          `AGENT DIRECTIVE — the user chose this exact mission for the reply. Make every variant fulfill it (while the GROUNDING RULES and the LANGUAGE rule above still apply at full force):\n"""${agent}"""`,
          "",
        ]
      : []),
    bio
      ? `ABOUT THE USER (they told us this themselves — treat as TRUE, first-person is allowed when relevant):\n"""${bio}"""\nStay inside these facts. Do NOT stretch them into new claims.`
      : "GROUNDING RULES — breaking any of these is total failure:",
    ...(bio
      ? [
          "",
          "STILL FORBIDDEN: anything beyond the bio — no invented achievements, metrics, numbers, or experiences that are not in it.",
        ]
      : [
          "- NEVER invent facts about the user: no fake achievements (\"shipped my MVP\"), no fake identity (\"as a SaaS founder\"), no fake projects, metrics, numbers, experiences, or opinions.",
          "- Write text ANY stranger could truthfully post. Safe moves: react to the tweet, highlight a specific thing in it, add a general insight. Ask a smart question ONLY when the tweet asked nothing itself (STEP 1.5 rule 5) — if it did, answering ITS ask is the only safe move.",
          "- If the tweet asks people to share something about themselves, do NOT fill in fake details (no 'link in bio', no 'just dropped mine' — we don't know the user has those). JOIN the invite as a curious participant instead — never answer it with a detached question about the tweet's topic, and never offer the author's own promised value back (STEP 1.5 rule 6).",
        ]),
    "- At least one variant must reference a specific detail from the tweet (its words, topic, or ask).",
    "- Do not parrot the tweet: at most 3 consecutive words may overlap with its text.",
    "",
    "FINAL CHECK (silent, before output): did the tweet contain an explicit question or invitation? If YES, hold every variant against it — any variant that fails to answer that exact ask gets rewritten now, not shipped. If NO, skip this check.",
    "",
    "FORMAT RULES:",
    `- Length: ${lengthLine}`,
    "- No hashtags. Emojis in at most one variant, and only one emoji there.",
    "- Never mention that you are an AI. Never use the word 'tweet' inside the text.",
    "- No quotes around the text. Plain text only. No numbering, no labels.",
    "- Do not start with the author's @handle.",
    "",
    `Output format: EXACTLY ${count} variant${count > 1 ? "s" : ""} separated by a line containing only --- and nothing else.` +
      (mode !== "hook"
        ? ` Then ONE final line starting with "NEXT:" — the single smartest next move for the user after posting their top reply (a quote-tweet idea, who to follow and why, or how to ride this thread). Max 12 words, no quotes.`
        : " No extra commentary."),
  ].join("\n");

  const cleanHandle = author.replace(/^@/, "").trim();
  const authorLine = cleanHandle ? ` by @${cleanHandle}` : "";
  const countWord = count === 1 ? "1 variant" : `${count} variants`;

  // v4.1 — pass-1 invite guard: when the tweet asks people to share their own
  // work and we have NO bio, say so up front instead of burning a retry on a
  // fabricated "just shipped mine".
  const INVITE_RE =
    /\b(?:drop|dropping)\b[^.?!]*\b(?:link|below)\b|\breply\s+with\b|\btell\s+me\s+what\s+you\b|\bshare\s+(?:your|what)\b|\bcomment\s+(?:your|below)\b|\bdrop\s+an?\s+(?:emoji|link)\b/i;
  const inviteNote =
    !bio && mode !== "hook" && INVITE_RE.test(tweet)
      ? "\n\nNOTE: this tweet asks people to share their own work/link, but the user has NO bio and we know NOTHING about what they build. The user CANNOT truthfully 'drop a link' — do NOT invent a project, product or link. Join honestly instead: react to the offer, count yourself in ('in line 👀 — go easy on me'), or ask about eligibility (e.g. whether a certain kind of work counts)."
      : "";

  const user =
    mode === "hook"
      ? `The user's own DRAFT tweet:\n\n"""${tweet}"""\n\nReturn ${countWord} sharper REWRITES of this exact draft. Keep the author's first-person voice and their facts. Do NOT answer it, do NOT react to it, do NOT invent extra claims — just make this draft stop the scroll.`
      : `Here is the tweet${authorLine}:\n\n"""${tweet}"""\n\nRespond to what THIS tweet actually says or asks — not a generic reaction. Generate the ${countWord} now.${inviteNote}`;

  return { system, user };
}

/*
 * v4.2 meta-leak filter — the model sometimes writes its PLANNING into the
 * content instead of (or before) the replies: "This tweet is a strong hot
 * take, so I'll use the savage tone (clever, never abusive).", "The tweet
 * doesn't have an explicit question, so I'll follow STEP 1 strategies.",
 * bare "Variant 1:" headers. Live regression caught exactly this shipping
 * as variants. A line matching these is the assistant thinking out loud,
 * never a postable reply. 'tweet' is banned inside reply text by FORMAT
 * RULES anyway, so any line containing it is meta by definition.
 * Deliberately conservative — "I'll use Rust" (a real answer) or "Step 1:
 * talk to users" (real how-to content) must survive; only prompt-echo
 * shapes die here. A false positive costs one dropped line; a miss ships
 * the model's inner monologue to the user's timeline.
 */
const META_LINE_RE = new RegExp(
  [
    "\\btweets?\\b",
    "\\bstep\\s*\\d+\\s+(?:strateg\\w*|rules?)\\b",
    "\\bfollow(?:ing)?\\s+step\\s*\\d+\\b",
    "\\bformat\\s+rules?\\b",
    "\\bgrounding\\b",
    "\\bfinal\\s+check\\b",
    "\\bsystem\\s+prompt\\b",
    "\\bthe\\s+(?:witty|savage|hype|friendly|expert|genz|professional|auto)(?:-picked)?\\s+tone\\b",
    // v4.2b: bare tone label on its own line ("Savage\nThe brutal truth...")
    // — the no-colon evolution of the "Savage: ..." leak.
    "^\\s*(?:witty|expert|hype|friendly|savage|genz|professional|auto)\\s*[:\\u2014-]?\\s*$",
    "\\bas\\s+an?\\s+ai\\b",
    "^\\s*(?:variant|option|draft|version|reply)\\s*\\d+\\s*[:\\u2014-]?\\s*$",
  ].join("|"),
  "i"
);

function stripMetaLines(part: string): { text: string; dropped: number } {
  const lines = part.split("\n");
  // NEXT: is case-SENSITIVE here — the prompt's literal format is uppercase,
  // and a legit reply may open a line with lowercase "Next: do X".
  const kept = lines.filter(
    (l) => !META_LINE_RE.test(l) && !/^\s*NEXT:/.test(l)
  );
  return { text: kept.join("\n").trim(), dropped: lines.length - kept.length };
}

function splitVariants(
  raw: string,
  count: number
): { variants: string[]; metaDropped: number } {
  let metaDropped = 0;

  const clean = (p: string): string => {
    const stripped = p
      .trim()
      .replace(/^\s*\d+[.)]\s*/, "")
      // v4.2: "Variant 1: <text>" header prefix — keep the text, drop the label.
      .replace(/^\s*(?:variant|option|draft|version|reply)\s*\d+\s*[:\u2014-]\s+/i, "")
      .replace(/^["'\u201c\u2018]+|["'\u201d\u2019]+$/g, "")
      // v4.1: tone-name label leak ("Savage: ...") — the model sometimes
      // prefixes the AUTO-picked tone; FORMAT RULES forbid labels.
      .replace(
        /^\s*(?:witty|expert|hype|friendly|savage|genz|professional|auto)\s*[:\u2014-]\s+/i,
        ""
      )
      // v0.9.0: inline trailing separator ("text ---" on one line) — a real
      // reply never ends with a rule, so strip it.
      .replace(/\s*-{3,}\s*$/, "")
      .trim();
    const { text, dropped } = stripMetaLines(stripped);
    metaDropped += dropped;
    return text;
  };

  const parts = raw
    .split(/^\s*-{3,}\s*$/m)
    .map(clean)
    .filter((p) => p.length > 0);

  if (parts.length >= count)
    return { variants: parts.slice(-count), metaDropped };

  // Fallback: numbered lines "1. ..." "2. ..." "3. ..." — also meta-cleaned,
  // and take the LAST count (planning notes come first, final variants last).
  const numbered = raw
    .split(/\n+/)
    .map(clean)
    .filter((l) => l.length > 0);
  if (numbered.length >= count)
    return { variants: numbered.slice(-count), metaDropped };

  // Last resort: treat whole output as one variant
  const lastResort = parts.length > 0 ? parts : numbered;
  return { variants: lastResort.slice(0, 1), metaDropped };
}

/*
 * v0.9.0 AUTONOMY PACK — smart follow-up ("NEXT:") extraction. The prompt
 * asks for ONE trailing line starting with NEXT: (reply/quote modes only).
 * It must never ship as a variant, so it is lifted OUT of the raw output
 * before parsing — searched in the FINAL --- segment only, so a legit
 * "Next: write tests" line inside a multi-line how-to reply survives.
 */
function extractNextMove(raw: string): { raw2: string; nextMove: string } {
  const parts = raw.split(/^\s*-{3,}\s*$/m);
  if (parts.length < 2) return { raw2: raw, nextMove: "" };
  const last = parts[parts.length - 1];
  const m = last.match(/(^|\n)[ \t]*NEXT:[ \t]*([^\n]+)/i);
  if (!m) return { raw2: raw, nextMove: "" };
  const nextMove = m[2].trim().slice(0, 120);
  const idx = m.index ?? last.length;
  const rest = (last.slice(0, idx) + last.slice(idx + m[0].length)).trim();
  if (rest.length === 0) parts.pop();
  else parts[parts.length - 1] = rest;
  return { raw2: parts.join("\n---\n"), nextMove };
}

/*
 * Fabrication linter — the safety net under the prompt. Catches invented
 * personal claims ("building a SaaS tool", "shipped my MVP", "as a founder")
 * in reply/quote modes, where we know NOTHING about the user. hook mode is
 * exempt: the text there IS the user's own draft, first-person is legit.
 */
const FAB_PATTERNS: RegExp[] = [
  /\b(i|i'm|i am|we|we're|im|ive|i've)\s+(?:currently\s+|also\s+|just\s+)?(?:building|shipping|launching|exploring|working|creating|developing|founding|growing|scaling)\b/i,
  /\b(?:i|we)\s+(?:shipped|launched|built|started|founded|created|grew|scaled|migrated)\b/i,
  /\bmy\s+(?:startup|saas|product|project|app|mvp|company|tool|framework|newsletter|podcast|agency|team)\b/i,
  /\bas\s+an?\s+(?:indie|saas|founder|developer|builder|engineer|maker|hacker|designer)\b/i,
  /\b(?:i|we)(?:'m|m)?\s+a\s+(?:full-?stack|backend|frontend|software)\s+(?:dev|developer|engineer)\b/i,
  /\bcurrently\s+(?:exploring|building|working)\b/i,
  // v4: no-bio link/CTA fabrication — we do NOT know the user has a bio link
  // or that they dropped one in the replies
  /\blink'?s?\s+in\s+my\s+bio\b/i,
  /\b(?:just\s+)?dropped\s+(?:mine|my\s+link|a\s+link)\b/i,
  /\bhere'?s\s+my\s+link\b/i,
  /\bmy\s+link\s+is\b/i,
  /^\s*dropped[!.]/i,
  // v4.2: invite-compliance claims — "this is my first shipped project" under
  // a "drop what you shipped" invite is the same fabrication as "just dropped
  // mine": we do NOT know the user ever shipped anything.
  /\bfirst\s+(?:shipped\s+|launched\s+|built\s+)?(?:project|product|app|saas|tool|build|startup)\b/i,
  // v0.9.0: invite-fab evolutions caught live — "my first shipped THING is a
  // small CLI tool", "built a simple browser extension", "Here's mine: a
  // simple browser extension". The third one names an artifact type so a
  // legit opinion answer ("Here's mine: The Lean Startup") survives.
  /\bfirst\s+(?:shipped|launched|built)?\s*(?:project|product|app|saas|tool|build|startup|thing|stuff|release)\b/i,
  /\b(?:shipped|launched|built)\s+(?:a|an|my)\s+(?:small|simple|tiny|new|free|little|basic)\b/i,
  /\bhere'?s\s+mine\b[^.?!]*\b(?:extension|app|tool|site|website|project|product|startup|saas|bot|api|script|cli|library|framework)\b/i,
  // v4.1: subject-dropped tweet-speak ("Just shipped a React library",
  // "Working on a CLI tool") — these slipped past every pattern above
  // because they omit the "I/we" pronoun. Slight false-positive risk when
  // a reply references a THIRD party's launch — costs one retry, worth it.
  /\bjust\s+(?:shipped|launched|built|started|founded|created|released)\b/i,
  /\bworking\s+on\s+(?:a|an|my|the|our)\b/i,
  /\bexcited\s+to\s+share\b/i,
  /\bproud\s+to\s+(?:announce|share|present)\b/i,
  /\bcheck\s+out\s+my\b/i,
  /\btry\s+(?:my|our)\b/i,
  /\bthe\s+last\s+thing\s+(?:i|we)\s+(?:shipped|built|made|launched)\b/i,
];

function fabricationHit(text: string): string | null {
  for (const re of FAB_PATTERNS) {
    const m = text.match(re);
    if (m) return m[0];
  }
  return null;
}

/*
 * v4.1 topical linter — the relevance safety net. Fires only in the worst
 * case: EVERY variant shares ZERO content words with the tweet, i.e. the
 * model produced pure generic filler that ignores the ask. Conservative on
 * purpose — good replies may use synonyms, but zero lexical overlap across
 * ALL variants is a red flag. Non-Latin tweets (Hindi etc.) are skipped:
 * the keyword matcher is a-z only.
 */
const STOPWORDS = new Set([
  "what", "your", "you're", "you", "this", "that", "with", "from", "have",
  "been", "they", "them", "their", "will", "would", "could", "should",
  "about", "which", "there", "then", "than", "when", "where", "because",
  "really", "actually", "everyone", "else", "some", "just", "like", "want",
  "need", "know", "think", "best", "good", "great", "people", "today",
  "going", "does", "doing", "more", "most", "much", "very", "also", "even",
  "ever", "still", "into", "over", "after", "before", "while", "here",
  "yeah", "okay", "hello", "thanks", "please", "give", "tell", "make",
]);

function tweetKeywords(t: string): string[] {
  const words = t.toLowerCase().match(/[a-z][a-z']{3,}/g) ?? [];
  return [...new Set(words.filter((w) => !STOPWORDS.has(w)))];
}

function topicalFlag(tweet: string, variants: string[]): boolean {
  const kws = tweetKeywords(tweet);
  if (kws.length === 0) return false;
  const joined = variants.join(" \n ").toLowerCase();
  return !kws.some((k) => joined.includes(k));
}

function countWord(n: number): string {
  return n === 1 ? "1 variant" : `${n} variants`;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400, headers: CORS }
    );
  }

  const tweet = typeof body.tweet === "string" ? body.tweet.trim() : "";
  const modeInput = typeof body.mode === "string" ? body.mode : "reply";
  const toneInput = typeof body.tone === "string" ? body.tone : "witty";
  const author = typeof body.author === "string" ? body.author : "";
  const bio =
    typeof body.bio === "string" ? body.bio.trim().slice(0, 300) : "";
  const lengthInput = typeof body.length === "string" ? body.length : "normal";
  const countInput = typeof body.count === "number" ? Math.round(body.count) : 3;
  const count = Math.min(3, Math.max(1, countInput));
  const agent =
    typeof body.agent === "string" ? body.agent.trim().slice(0, 200) : "";

  // v0.9.0 THREAD PACK — sanitize the client-supplied conversation chain:
  // max 3 items (2 parents + target), 400 chars each, author handle only.
  // The chain's last item usually repeats the tweet itself — drop that
  // redundant tail so the prompt holds only NEW context.
  const thread: ThreadItem[] = Array.isArray(body.thread)
    ? (body.thread as unknown[])
        .slice(-3)
        .map((it) => {
          const o = (it ?? {}) as { author?: unknown; text?: unknown };
          return {
            author:
              typeof o.author === "string"
                ? o.author.trim().slice(0, 30)
                : "",
            text: typeof o.text === "string" ? o.text.trim().slice(0, 400) : "",
          };
        })
        .filter((t) => t.text.length > 0)
        .filter((t) => t.text !== tweet.trim().slice(0, 400))
    : [];

  // v0.9.0 VOICE MEMORY — the user's own past replies (device-stored),
  // passed as loose style guidance. Capped hard; treated as untrusted input.
  const style =
    typeof body.style === "string" ? body.style.trim().slice(0, 700) : "";

  if (!tweet) {
    return NextResponse.json(
      { error: "tweet text is required" },
      { status: 400, headers: CORS }
    );
  }
  if (tweet.length > 1200) {
    return NextResponse.json(
      { error: "tweet text too long (max 1200 chars)" },
      { status: 400, headers: CORS }
    );
  }

  const mode = (Object.keys(MODES) as string[]).includes(modeInput)
    ? modeInput
    : "reply";
  const tone = TONES[toneInput] ? toneInput : "witty"; // includes "auto"
  const length = LENGTHS[lengthInput] ? lengthInput : "normal";

  try {
    const zai = await ZAI.create();
    const prompt = buildPrompt(
      tweet,
      mode,
      tone,
      author,
      bio,
      length,
      count,
      agent,
      thread,
      style
    );
    // Linter applies only when we know NOTHING about the user: hook mode is
    // the user's own draft, and a provided bio makes first-person claims real.
    const lintEligible = mode !== "hook" && !bio;

    const ask = (extra: string | undefined, model: string | undefined) =>
      zai.chat.completions.create({
        ...(model ? { model } : {}),
        messages: [
          { role: "system", content: prompt.system },
          {
            role: "user",
            content: extra ? `${prompt.user}\n\n${extra}` : prompt.user,
          },
        ],
        thinking: { type: "enabled" },
      });

    // v0.10.1 UNLIMITED (personal deployment): upstream AI quota (429) windows
    // are ridden out INVISIBLY instead of erroring. The request waits and
    // retries until the provider's per-minute quota resets — from the user's
    // point of view generation is unlimited, just occasionally slower.
    // Patience is env-tunable: RIZZ_AI_RETRIES (default 7 → ~4 min total,
    // sized to stay under typical browser/proxy idle timeouts).
    const RETRY_DELAYS_MS = [8_000, 15_000, 25_000, 35_000, 45_000, 52_000, 60_000];
    const maxRetries = Math.max(
      0,
      Number(process.env.RIZZ_AI_RETRIES ?? RETRY_DELAYS_MS.length)
    );
    const isTransient = (m: string) =>
      /429|too many requests|quota|rate\s*limit|timeout|timed out|5\d\d|econn|fetch failed|network|socket/i.test(
        m
      );
    // Single-flight: concurrent generations SERIALIZE on the one shared AI
    // lane instead of racing each other for quota slots (parallel retries
    // self-saturate a small per-minute window). Each attempt takes a ticket;
    // backoff sleeps happen OFF the queue so the next queued attempt — from
    // this or another waiting request — can seize the window the moment it
    // resets.
    let aiRetries = 0;
    let servedModel: string | undefined;
    // v0.10.2: attempt N rides models[attempt % models.length] — the sticky
    // preferred slot first, then the rest of the rotation chain. The queue
    // ticket is per-ATTEMPT; backoff sleeps happen OFF the queue so the next
    // queued attempt — this or another waiting request — can seize the window
    // the moment it resets.
    const models: Array<string | undefined> = [
      rizzPreferredModel,
      ...RIZZ_MODEL_CHAIN.filter((m) => m !== rizzPreferredModel),
    ];
    const askWithRetry = async (extra?: string) => {
      for (let attempt = 0; ; attempt++) {
        const model = models[attempt % models.length];
        try {
          const run = aiChain.then(
            () => ask(extra, model),
            () => ask(extra, model)
          );
          aiChain = run.then(
            () => undefined,
            () => undefined
          );
          const completion = await run;
          rizzPreferredModel = model; // sticky: this slot worked
          servedModel = model;
          return completion;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!isTransient(msg) || attempt >= maxRetries) throw err;
          aiRetries += 1;
          await new Promise((r) =>
            setTimeout(
              r,
              RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]
            )
          );
        }
      }
    };

    // Pass 1, then ONE self-correcting retry if the linters catch invented
    // claims, zero-overlap filler, or planning-notes meta leak. Whichever
    // attempt has fewer violations wins.
    let completion = await askWithRetry();
    // v0.9.0: lift the NEXT: follow-up line out before parsing so it can
    // never surface as a variant.
    let ex = extractNextMove(completion.choices[0]?.message?.content ?? "");
    let parsed = splitVariants(ex.raw2, count);
    let variants = parsed.variants;
    let nextMove = ex.nextMove;

    // v4.2: meta-leak check applies to EVERY mode — planning notes, tone
    // reasoning and "Variant 1:" headers are never postable, not even in
    // hook mode where the fabrication linter is exempt.
    const metaBad = (vs: string[], dropped: number) =>
      dropped > 0 || vs.some((v) => META_LINE_RE.test(v));
    let metaFix = metaBad(parsed.variants, parsed.metaDropped);

    if (variants.length > 0 && lintEligible) {
      // v4.1: ONE combined self-correcting retry for BOTH failure classes —
      // invented claims AND zero-overlap generic filler. Fewer-violations wins.
      const fabHits = variants
        .map((v) => fabricationHit(v))
        .filter((h): h is string => h !== null);
      const offTopic = topicalFlag(
        thread.length > 0 ? `${tweet} ${thread.map((t) => t.text).join(" ")}` : tweet,
        variants
      );
      // v4.1 question-back linter: the counter-question crutch — more than
      // ONE variant ending with '?' violates the prompt's cap.
      const qEnds = variants.filter((v) => /\?\s*$/.test(v.trim())).length;
      const qBack = qEnds > 1;
      const score =
        fabHits.length +
        (offTopic ? 1 : 0) +
        (qBack ? 1 : 0) +
        (metaFix ? 1 : 0);
      if (score > 0) {
        if (fabHits.length > 0)
          console.warn("[rizz] fabrication linter caught:", fabHits);
        if (offTopic)
          console.warn("[rizz] topical linter: zero keyword overlap with tweet");
        if (qBack)
          console.warn(`[rizz] question-back linter: ${qEnds}/${variants.length} variants end with a question`);
        if (metaFix)
          console.warn(`[rizz] meta-leak linter: dropped ${parsed.metaDropped} planning/meta line(s)`);
        const fixes: string[] = [];
        if (fabHits.length > 0)
          fixes.push(
            `INVENTED claims about the user, like "${fabHits[0]}" — you know nothing about the user: no projects, no products, no bio link, nothing they dropped anywhere. FORBIDDEN shapes: 'just shipped/dropped mine', 'link in bio', 'here's my link', 'working on a …'. If the tweet asks people to share their own work, the user CANNOT comply — react to the offer or count yourself in honestly instead ('in line 👀').`
          );
        if (offTopic)
          fixes.push(
            "replies that ignore what the tweet actually says or asks (generic filler)"
          );
        if (qBack)
          fixes.push(
            `${qEnds} of the variants ended with a question — at most ONE may. Rewrite the others so they END with a direct answer or statement that engages the tweet's actual ask.`
          );
        if (metaFix)
          fixes.push(
            "parts of your output were planning notes / meta commentary (tone reasoning, STEP references, 'Variant' headers) instead of ready-to-post replies — output ONLY the final replies separated by ---, no reasoning, no labels, no headers."
          );
        completion = await askWithRetry(
          `IMPORTANT correction: your previous draft had ${fixes.join(" and ")}. Regenerate ${countWord(count)} that directly engage the tweet's exact content — a question or invite gets REAL answers to THAT ask, never a pivot to your own question — and contain zero claims about the user's own work, links or identity.`
        );
        const exR = extractNextMove(
          completion.choices[0]?.message?.content ?? ""
        );
        const retryParsed = splitVariants(exR.raw2, count);
        const retry = retryParsed.variants;
        const retryFab = retry
          .map((v) => fabricationHit(v))
          .filter((h): h is string => h !== null);
        const retryQEnds = retry.filter((v) => /\?\s*$/.test(v.trim())).length;
        const retryScore =
          retryFab.length +
          (topicalFlag(
            thread.length > 0 ? `${tweet} ${thread.map((t) => t.text).join(" ")}` : tweet,
            retry
          ) ? 1 : 0) +
          (retryQEnds > 1 ? 1 : 0) +
          (metaBad(retryParsed.variants, retryParsed.metaDropped) ? 1 : 0);
        // v4.1: strict acceptance — a retry must be CLEAN or a strict
        // improvement. Swapping one flawed draft for an equally flawed one
        // is what let fabricated retries ship.
        if (retry.length > 0 && (retryScore === 0 || retryScore < score)) {
          variants = retry;
          nextMove = exR.nextMove;
        }
      }
    } else if (metaFix || variants.length === 0) {
      // v4.2: meta leak outside the lint-eligible path (hook mode, bio mode)
      // or a parse that came back empty because everything looked like notes
      // — one plain self-correcting retry, accepted only if it comes back
      // clean of meta text with usable variants.
      console.warn(
        `[rizz] meta-leak linter (${mode}): dropped ${parsed.metaDropped} line(s), parsed ${variants.length}/${count}`
      );
      completion = await askWithRetry(
        `IMPORTANT correction: your previous output contained planning notes / reasoning / labels instead of ONLY ready-to-post replies. Regenerate ${countWord(count)}: final text only, each separated by a line containing only ---, no commentary, no 'Variant' headers, no notes about tone or strategy.`
      );
      const exR2 = extractNextMove(
        completion.choices[0]?.message?.content ?? ""
      );
      const retryParsed = splitVariants(exR2.raw2, count);
      if (
        retryParsed.variants.length > 0 &&
        !metaBad(retryParsed.variants, retryParsed.metaDropped)
      ) {
        variants = retryParsed.variants;
        nextMove = exR2.nextMove;
      }
    }

    if (variants.length === 0) {
      return NextResponse.json(
        { error: "AI returned an empty response, try again" },
        { status: 502, headers: CORS }
      );
    }

    return NextResponse.json(
      {
        variants,
        mode,
        tone,
        length,
        count,
        // v0.9.0 AUTONOMY PACK — smart next move (empty → field omitted)
        ...(nextMove ? { nextMove } : {}),
      },
      // v0.10.2: x-rizz-ai-retries = how many upstream-quota waits this
      // request rode out invisibly (0 = quota was free the whole time);
      // x-rizz-ai-model = which model slot actually served the answer.
      {
        headers: {
          ...CORS,
          "x-rizz-ai-retries": String(aiRetries),
          ...(servedModel ? { "x-rizz-ai-model": servedModel } : {}),
        },
      }
    );
  } catch (err) {
    // v0.10.2: with model rotation the AI lane only fails after ~4 min of
    // patient retries across every model slot — tell the human the truth.
    const message = err instanceof Error ? err.message : "Unknown error";
    const friendly = /429|too many requests|quota|rate\s*limit/i.test(message)
      ? `AI quota stayed busy even after ~4 min of patient retries across ${RIZZ_MODEL_CHAIN.length} model slots — one more try usually lands, and batch mode spaces items out automatically.`
      : `Generation failed: ${message}`;
    return NextResponse.json(
      { error: friendly },
      {
        status: 500,
        headers: { ...CORS, "cache-control": "no-store" },
      }
    );
  }
}
