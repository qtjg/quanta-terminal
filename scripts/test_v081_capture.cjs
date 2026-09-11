// v0.8.1 capture-fix test — simulates X's article DOM shapes with stubs and
// verifies articleText() + articleClamped() from extension/content.js.
const fs = require("fs");
const src = fs.readFileSync("/home/z/my-project/extension/content.js", "utf8");

// Extract the two functions under test (they live inside the IIFE)
function grab(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} not found`);
  let depth = 0,
    i = src.indexOf("{", start);
  for (let j = i; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") {
      depth--;
      if (depth === 0) return src.slice(start, j + 1);
    }
  }
}
const code = `${grab("articleText")}\n${grab("articleClamped")}`;

// --- minimal DOM stubs ---
global.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
function el(tag, attrs = {}, ...children) {
  return {
    tagName: tag.toUpperCase(),
    nodeType: 1,
    attrs,
    children,
    childNodes: children,
    get textContent() {
      return children
        .map((c) => (c.nodeType === 3 ? c.nodeValue : c.textContent || ""))
        .join("");
    },
    getAttribute: (k) => (attrs[k] === undefined ? null : attrs[k]),
    querySelector(sel) {
      for (const c of children) {
        if (matchEl(c, sel)) return c;
        const deep = c.querySelector && c.querySelector(sel);
        if (deep) return deep;
      }
      return null;
    },
    querySelectorAll(sel) {
      const out = [];
      const rec = (n) => n.children && n.children.forEach((c) => { if (matchEl(c, sel)) out.push(c); rec(c); });
      rec(this);
      return out;
    },
  };
}
function txt(s) {
  return { nodeType: 3, nodeValue: s, children: [] };
}
function matchEl(n, sel) {
  if (!n || n.nodeType !== 1) return false;
  if (sel.includes("[data-testid")) {
    const m = sel.match(/data-testid="([^"]+)"/);
    return n.attrs["data-testid"] === m[1];
  }
  if (sel === "a[href*='/status/']")
    return n.tagName === "A" && (n.attrs.href || "").includes("/status/");
  return false;
}

eval(code);

let fails = 0;
function check(label, got, want) {
  const ok = got === want;
  if (!ok) fails++;
  console.log(`${ok ? "✅" : "❌"} ${label}\n   got:  ${JSON.stringify(got)}\n   want: ${JSON.stringify(want)}`);
}

// CASE 1 — the EXACT Uriel tweet from MAYANK's screenshot: 3 lines + emoji img
const uriel = el("article", { "data-testid": "tweet" },
  el("div", { "data-testid": "tweetText" },
    txt("Building in public is free advertisement for your startup"),
    el("br"), el("br"),
    txt("Drop your link below "),
    el("img", { alt: "👇", src: "emoji.svg" }),
    el("br"), el("br"),
    txt("i'll tell you in one sentence what you should be posting about."),
  )
);
check("C1 full read incl. emoji", articleText(uriel),
  "Building in public is free advertisement for your startup\n\nDrop your link below 👇\n\ni'll tell you in one sentence what you should be posting about.");
check("C1 not clamped", articleClamped(uriel), false);

// CASE 2 — timeline clamp: only 2 lines + "Show more" link
const clamped = el("article", { "data-testid": "tweet" },
  el("div", { "data-testid": "tweetText" },
    txt("Building in public is free advertisement for your startup"),
    el("br"), el("br"),
    txt("Drop your link below"),
  ),
  el("a", { href: "/uriel_builds/status/2098041301530706352" }, txt("Show more"))
);
check("C2 clamped detected", articleClamped(clamped), true);
check("C2 text is the visible 2 lines", articleText(clamped),
  "Building in public is free advertisement for your startup\n\nDrop your link below");

// CASE 3 — embedded quote card: old code (blocks[last].innerText) grabbed the
// QUOTE's text; new code must return the MAIN tweet.
const withQuote = el("article", { "data-testid": "tweet" },
  el("div", { "data-testid": "tweetText" },
    txt("Main take: ship small, ship daily ", ), el("img", { alt: "🚢" })),
  el("div", {},
    el("div", { "data-testid": "tweetText" }, txt("quoted person's totally different tweet text"))
  )
);
check("C3 main text wins over quote", articleText(withQuote),
  "Main take: ship small, ship daily 🚢");

// CASE 4 — inline links inside text (mentions) survive the walk
const withLink = el("article", { "data-testid": "tweet" },
  el("div", { "data-testid": "tweetText" },
    txt("go check "),
    el("a", { href: "/XDevelopers" }, txt("@XDevelopers")),
    txt(" for the news ", ),
    el("img", { alt: "🔥" }),
  )
);
check("C4 inline span/anchor text", articleText(withLink),
  "go check @XDevelopers for the news 🔥");

console.log(fails === 0 ? "\nALL CAPTURE TESTS PASS" : `\n${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
