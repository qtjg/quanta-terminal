/* QUANTA text-tools — pure functions, bun-testable (F51-F56 + helpers) */

/* ---------- arg parsing ---------- */

/** quote-aware splitter: `echo "a b" c` -> ["a b","c"] */
export function splitArgs(raw: string): string[] {
  const out: string[] = [];
  let cur = "", q: '"' | "'" | null = null, has = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (q) {
      if (c === q) { q = null; } else cur += c;
    } else if (c === '"' || c === "'") { q = c; has = true; }
    else if (c === " " || c === "\t") {
      if (cur || has) { out.push(cur); cur = ""; has = false; }
    } else cur += c;
  }
  if (cur || has) out.push(cur);
  return out;
}

/** parse -abc style short flags + positionals */
export function parseFlags(args: string[]): { pos: string[]; flags: Set<string> } {
  const pos: string[] = [];
  const flags = new Set<string>();
  for (const a of args) {
    if (a.length > 1 && a.startsWith("-") && !a.startsWith("--") && !/^-\d/.test(a)) {
      for (const ch of a.slice(1)) flags.add(ch);
    } else if (a.startsWith("--") && a.length > 2) {
      flags.add(a.slice(2));
    } else pos.push(a);
  }
  return { pos, flags };
}

/* ---------- F51: regex tester ---------- */

export interface RegexMatch { text: string; index: number; groups: string[] }
export interface RegexLineHit { line: number; text: string; matches: RegexMatch[] }
export type RegexResult = { ok: true; hits: RegexLineHit[]; total: number } |
  { ok: false; error: string };

const MAX_MATCHES = 200;

export function regexLines(pattern: string, flagStr: string, subject: string): RegexResult {
  let re: RegExp;
  try {
    re = new RegExp(pattern, flagStr);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "invalid regex" };
  }
  const isGlobal = re.global;
  const lines = subject.split("\n");
  const hits: RegexLineHit[] = [];
  let total = 0;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[re.multiline ? li : li];
    void line;
  }
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    re.lastIndex = 0;
    const matches: RegexMatch[] = [];
    let guard = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      matches.push({ text: m[0], index: m.index, groups: m.slice(1).map((g) => g ?? "") });
      total++;
      if (!isGlobal) break;           // non-global exec never advances lastIndex
      if (m.index === re.lastIndex) re.lastIndex++; // zero-width safety
      if (total >= MAX_MATCHES || ++guard > MAX_MATCHES) break;
    }
    if (matches.length) hits.push({ line: li + 1, text: line, matches });
    if (total >= MAX_MATCHES) break;
  }
  return { ok: true, hits, total };
}

/* ---------- F52: case transform (11 modes) ---------- */

export type CaseMode =
  | "upper" | "lower" | "title" | "sentence" | "camel" | "pascal"
  | "snake" | "kebab" | "constant" | "alt" | "reverse";

const WORDS_RE = /[A-Za-z0-9]+/g;

export function caseTransform(mode: CaseMode, text: string): string {
  const words = () => text.match(WORDS_RE) ?? [];
  switch (mode) {
    case "upper": return text.toUpperCase();
    case "lower": return text.toLowerCase();
    case "title":
      return text.replace(WORDS_RE, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
    case "sentence": {
      const s = text.toLowerCase();
      return s.replace(/(^\s*\w|[.!?]\s+\w)/g, (c) => c.toUpperCase());
    }
    case "camel": return words().map((w, i) =>
      i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()).join("");
    case "pascal": return words().map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join("");
    case "snake": return words().map((w) => w.toLowerCase()).join("_");
    case "kebab": return words().map((w) => w.toLowerCase()).join("-");
    case "constant": return words().map((w) => w.toUpperCase()).join("_");
    case "alt": return [...text].map((c, i) => (i % 2 ? c.toUpperCase() : c.toLowerCase())).join("");
    case "reverse": return [...text].reverse().join("");
    default: return text;
  }
}

export const CASE_MODES: CaseMode[] = [
  "upper", "lower", "title", "sentence", "camel", "pascal",
  "snake", "kebab", "constant", "alt", "reverse",
];

/* ---------- F53: ascii table ---------- */

export interface AsciiRow { ch: string; dec: number; hex: string; bin: string; bytes: number[] }

export function asciiTable(text: string): AsciiRow[] {
  const enc = new TextEncoder();
  return [...text].map((ch) => {
    const bytes = [...enc.encode(ch)];
    const cp = ch.codePointAt(0) ?? 0;
    return {
      ch: ch === " " ? "␠" : ch,
      dec: cp,
      hex: "0x" + cp.toString(16).toUpperCase().padStart(2, "0"),
      bin: cp.toString(2).padStart(8, "0"),
      bytes,
    };
  });
}

/* ---------- F54: url info / encode / decode ---------- */

export type UrlInfoResult = { ok: true; card: string[] } | { ok: false; error: string };

export function urlInfo(raw: string): UrlInfoResult {
  let u: URL;
  try {
    u = new URL(raw.includes("://") ? raw : "https://" + raw);
  } catch {
    return { ok: false, error: `invalid url: ${raw}` };
  }
  const card = [
    `protocol   ${u.protocol.replace(":", "")}`,
    `host       ${u.host}`,
    `port       ${u.port || "(default)"}`,
    `path       ${u.pathname}`,
    `query      ${[...u.searchParams.keys()].length} param(s)`,
    ...[...u.searchParams.entries()].map(([k, v]) => `  - ${k} = ${v}`),
    `hash       ${u.hash || "(none)"}`,
    `origin     ${u.origin}`,
    `enc(e)     ${encodeURIComponent(raw)}`,
    `dec(d)     ${safeDecode(raw)}`,
  ];
  return { ok: true, card };
}

export function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return "(malformed sequence)"; }
}

/* ---------- F56: diff (LCS line diff) ---------- */

export interface DiffRow { op: "=" | "+" | "-"; line: string }
const MAX_DIFF_LINES = 300;

export function diffText(a: string, b: string): DiffRow[] {
  /* trailing "\n" is a line TERMINATOR (like real diff), not an extra empty line */
  const toLines = (s: string): string[] => {
    if (s === "") return [];
    const lines = s.split("\n");
    if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
    return lines;
  };
  const A = toLines(a);
  const B = toLines(b);
  if (A.length > MAX_DIFF_LINES || B.length > MAX_DIFF_LINES) {
    return [{ op: "=", line: `(diff capped at ${MAX_DIFF_LINES} lines per side)` }];
  }
  const n = A.length, m = B.length;
  // LCS dp table
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const rows: DiffRow[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { rows.push({ op: "=", line: A[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { rows.push({ op: "-", line: A[i] }); i++; }
    else { rows.push({ op: "+", line: B[j] }); j++; }
  }
  while (i < n) rows.push({ op: "-", line: A[i++] });
  while (j < m) rows.push({ op: "+", line: B[j++] });
  return rows;
}

export function diffStat(rows: DiffRow[]): string {
  const add = rows.filter((r) => r.op === "+").length;
  const del = rows.filter((r) => r.op === "-").length;
  const same = rows.filter((r) => r.op === "=").length;
  return `+${add} -${del} =${same}`;
}

/* ---------- F55: stopwatch format ---------- */

export function fmtElapsed(ms: number, opts?: { live?: boolean; precise?: boolean }): string {
  const total = Math.max(0, Math.floor(ms));
  const h = Math.floor(total / 3600000);
  const m = Math.floor((total % 3600000) / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const msPart = total % 1000;
  const live = opts?.live ?? false;
  const precise = opts?.precise ?? false;
  const core = h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  if (live) return `${core}.${String(Math.floor(msPart / 100))}`;    // 1-decimal, updates fast
  if (precise) return `${core}.${String(msPart).padStart(3, "0")}`;  // full ms
  return core;
}

/* ---------- base64 / hash / uuid / rand ---------- */

export function b64encode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function b64decode(b64: string): string {
  const bin = atob(b64.trim());
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export async function shaHex(algo: "SHA-1" | "SHA-256" | "SHA-384" | "SHA-512", text: string): Promise<string> {
  const buf = await crypto.subtle.digest(algo, new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function uuidV4(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/* ---------- safe calculator (tokenizer + shunting-yard, no eval) ---------- */

type Tok = { t: "num" | "op" | "lp" | "rp" | "fn"; v: string };

const FNS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor,
  ceil: Math.ceil, sin: Math.sin, cos: Math.cos, tan: Math.tan, log: Math.log10, ln: Math.log,
};

function tokenizeCalc(src: string): Tok[] | null {
  const toks: Tok[] = [];
  let i = 0;
  const s = src.replace(/\s+/g, "").replace(/×/g, "*").replace(/÷/g, "/").toLowerCase();
  while (i < s.length) {
    const c = s[i];
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      const num = s.slice(i, j);
      if ((num.match(/\./g) ?? []).length > 1) return null;
      toks.push({ t: "num", v: num });
      i = j;
    } else if ("+-*/%^".includes(c)) {
      toks.push({ t: "op", v: c });
      i++;
    } else if (c === "(") { toks.push({ t: "lp", v: c }); i++; }
    else if (c === ")") { toks.push({ t: "rp", v: c }); i++; }
    else if (/[a-z]/.test(c)) {
      let j = i;
      while (j < s.length && /[a-z]/.test(s[j])) j++;
      const word = s.slice(i, j);
      if (word === "pi") toks.push({ t: "num", v: String(Math.PI) });
      else if (word === "e") toks.push({ t: "num", v: String(Math.E) });
      else if (FNS[word]) toks.push({ t: "fn", v: word });
      else return null; // unknown identifier
      i = j;
    } else return null;
  }
  return toks;
}

const PREC: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2, "%": 2, "^": 3 };

export function calcEval(expr: string): number | null {
  const toks = tokenizeCalc(expr);
  if (!toks || toks.length === 0) return null;
  const out: Tok[] = [], ops: Tok[] = [];
  let prev: Tok | null = null;
  for (const tok of toks) {
    if (tok.t === "num") out.push(tok);
    else if (tok.t === "fn") ops.push(tok);
    else if (tok.t === "op") {
      // unary minus / plus
      if ((tok.v === "-" || tok.v === "+") &&
        (prev === null || prev.t === "op" || prev.t === "lp")) {
        out.push({ t: "num", v: "0" });
      }
      while (ops.length) {
        const top = ops[ops.length - 1];
        if (top.t === "fn" || (top.t === "op" && PREC[top.v] >= PREC[tok.v] && tok.v !== "^")) {
          out.push(ops.pop() as Tok);
        } else break;
      }
      ops.push(tok);
    } else if (tok.t === "lp") ops.push(tok);
    else if (tok.t === "rp") {
      let matched = false;
      while (ops.length) {
        const top = ops.pop() as Tok;
        if (top.t === "lp") { matched = true; break; }
        out.push(top);
      }
      if (!matched) return null;
      if (ops.length && ops[ops.length - 1].t === "fn") out.push(ops.pop() as Tok);
    }
    prev = tok;
  }
  while (ops.length) {
    const top = ops.pop() as Tok;
    if (top.t === "lp") return null;
    out.push(top);
  }
  // RPN eval
  const st: number[] = [];
  for (const tok of out) {
    if (tok.t === "num") st.push(parseFloat(tok.v));
    else if (tok.t === "fn") {
      const x = st.pop();
      if (x === undefined) return null;
      st.push(FNS[tok.v](x));
    } else {
      const b = st.pop(), a = st.pop();
      if (a === undefined || b === undefined) return null;
      switch (tok.v) {
        case "+": st.push(a + b); break;
        case "-": st.push(a - b); break;
        case "*": st.push(a * b); break;
        case "/": st.push(b === 0 ? NaN : a / b); break;
        case "%": st.push(a % b); break;
        case "^": st.push(a ** b); break;
        default: return null;
      }
    }
  }
  if (st.length !== 1 || !isFinite(st[0])) return st.length === 1 && Number.isNaN(st[0]) ? NaN : null;
  return st[0];
}

/* ---------- unit conversion ---------- */

const UNIT_TABLE: Record<string, { base: number; cat: string }> = {
  km: { base: 1000, cat: "m" }, m: { base: 1, cat: "m" }, cm: { base: 0.01, cat: "m" },
  mm: { base: 0.001, cat: "m" }, mi: { base: 1609.344, cat: "m" }, ft: { base: 0.3048, cat: "m" },
  in: { base: 0.0254, cat: "m" }, yd: { base: 0.9144, cat: "m" },
  kg: { base: 1, cat: "kg" }, g: { base: 0.001, cat: "kg" }, lb: { base: 0.45359237, cat: "kg" },
  oz: { base: 0.028349523, cat: "kg" }, t: { base: 1000, cat: "kg" },
  l: { base: 1, cat: "l" }, ml: { base: 0.001, cat: "l" }, gal: { base: 3.785411784, cat: "l" },
  c: { base: 1, cat: "temp" }, f: { base: 1, cat: "temp" }, k: { base: 1, cat: "temp" },
};

export function convert(val: number, from: string, to: string): number | null {
  const f = UNIT_TABLE[from.toLowerCase()], t = UNIT_TABLE[to.toLowerCase()];
  if (!f || !t || f.cat !== t.cat) return null;
  if (f.cat === "temp") return tempConvert(val, from.toLowerCase(), to.toLowerCase());
  return (val * f.base) / t.base;
}

function tempConvert(v: number, from: string, to: string): number {
  const c = from === "c" ? v : from === "f" ? ((v - 32) * 5) / 9 : v - 273.15;
  return to === "c" ? c : to === "f" ? (c * 9) / 5 + 32 : c + 273.15;
}

/* ---------- banner (5-row block font) ---------- */

const GLYPHS: Record<string, string> = {
  A: "▛▀▀▜ ████ █▀▀█", B: "████ ████ ████", C: "▛▀▀▜ █    ▜▀▀▛",
  D: "██▖█ ████ ██▌█", E: "████ ███▀ ████", F: "████ ███▀ █   ",
  G: "▛▀▀▜ █ ▜█ ▜▀▀█", H: "█▀▀█ ████ █▀▀█", I: "███  █ █  ███",
  J: "  ██   █ ▜▀▜█", K: "█ ▜█ ██▀ █ ▜█", L: "█    █    ████",
  M: "█▜▖█ █ ▖█ █  █", N: "█▖ █ ████ █ ▌█", O: "▛▀▀▜ ████ ▜▀▀▛",
  P: "████ ████ █   ", Q: "▛▀▀▜ █ ▜█ ▜▀▜▛", R: "████ ████ █ ▜█",
  S: "▛██▜ █▀▀▖ ▜██▛", T: "████  █    █  ", U: "█  █ █  █ ▜▀▀▛",
  V: "█  █ █  █  ██  ", W: "█  █ █ █ █ ▜ ▛", X: "█  █  ██  █  █",
  Y: "█  █  ██    █  ", Z: "████  █   ████", "0": "▛▀▀▜ █ ▜█ ▜▀▀▛",
  "1": " ▀█  █ █  ███", "2": "▛▀▀▜ ▖▄▄█ ████", "3": "▛▀▀▜  ▄█ ▜▀▀▛",
  "4": "█  █ ████   █ ", "5": "████ █▀▀▖ ▜██▛", "6": "████ ████ ▜██▛",
  "7": "████   █   █  ", "8": "▛▀▀▜ ████ ▜▀▀▛", "9": "▛▀▀▜ ████  ▜█▛",
  " ": "    ", "!": " █  █ █    ", "?": "▛▀▜  ▖█   █  ",
};

export function bannerText(text: string): string[] {
  const rows = ["", "", ""];
  for (const rawCh of text.toUpperCase()) {
    const g = GLYPHS[rawCh] ?? GLYPHS["?"];
    const parts = g.split(" ");
    for (let r = 0; r < 3; r++) rows[r] += (parts[r] ?? "   ") + " ";
  }
  return rows;
}

/* ---------- cowsay / fortune ---------- */

export function cowsay(text: string): string[] {
  const msg = text.slice(0, 200);
  const w = msg.length;
  const border = "-".repeat(w + 2);
  return [
    ` _${border}_`,
    `< ${msg} >`,
    ` -${border}-`,
    `        \\   ^__^`,
    `         \\  (oo)\\_______`,
    `            (__)\\       )\\/\\`,
    `                ||----w |`,
    `                ||     ||`,
  ];
}

export const FORTUNES: string[] = [
  "A bug reported today is a feature shipped tomorrow. — ancient dev proverb",
  "The best time to read the docs was before deploying. The second best time is now.",
  "rm -rf builds character. And sometimes rebuilds it.",
  "There are only two hard things in CS: cache invalidation, naming things, and off-by-one errors.",
  "A tidy terminal is a tidy mind. Run clear, feel peace.",
  "It works on my machine — ship the machine.",
  "Every commit is a letter to your future self. Write nicely.",
  "The cloud is just someone else's computer. Quanta is yours.",
];

/* ---------- misc format helpers ---------- */

export function wrapText(s: string, width: number): string[] {
  const out: string[] = [];
  for (const para of s.split("\n")) {
    if (para.length <= width) { out.push(para); continue; }
    let line = "";
    for (const word of para.split(" ")) {
      if ((line + (line ? " " : "") + word).length > width && line) { out.push(line); line = word; }
      else line += (line ? " " : "") + word;
    }
    if (line) out.push(line);
  }
  return out;
}

export function padCell(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length);
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} K`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} M`;
  return `${(n / 1024 ** 3).toFixed(1)} G`;
}

/* ---------- v0.6: JSON toolkit ---------- */

export function jsonParseChecked(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.split("\n")[0] : String(e) };
  }
}

export function jsonType(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/** walk a JSON value via dot path: a.b.0.c — numeric segments index arrays */
export function jsonGet(value: unknown, path: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const segs = path.split(".").filter(Boolean);
  let cur: unknown = value;
  for (const seg of segs) {
    if (cur === null || typeof cur !== "object") {
      return { ok: false, error: `cannot descend into ${jsonType(cur)} at '${seg}'` };
    }
    if (Array.isArray(cur)) {
      const i = Number(seg);
      if (!Number.isInteger(i) || i < 0 || i >= cur.length) {
        return { ok: false, error: `index '${seg}' out of range (0..${cur.length - 1})` };
      }
      cur = cur[i];
    } else {
      const rec = cur as Record<string, unknown>;
      if (!(seg in rec)) return { ok: false, error: `key '${seg}' not found` };
      cur = rec[seg];
    }
  }
  return { ok: true, value: cur };
}

/* ---------- v0.6: slugify ---------- */

export function slugify(text: string, sep = "-"): string {
  const safeSep = sep.replace(/[^-_.~]/g, "") || "-";
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[''`]/g, "")
    .replace(/[^a-z0-9]+/g, safeSep)
    .split(safeSep === "." ? "." : safeSep)
    .filter(Boolean)
    .join(safeSep)
    .slice(0, 96);
}

/* ---------- v0.6: word frequency ---------- */

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with",
  "at", "by", "from", "is", "are", "was", "were", "be", "been", "it", "its",
  "this", "that", "as", "i", "you", "he", "she", "we", "they", "not", "no",
]);

export function wordFreq(text: string, stop = false): Array<[string, number]> {
  const words = text.toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) ?? [];
  const freq = new Map<string, number>();
  for (const w of words) {
    if (stop && STOP_WORDS.has(w)) continue;
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/* ---------- v0.6: text alignment ---------- */

export function alignLine(text: string, width: number, mode: "left" | "right" | "center"): string {
  const w = Math.max(1, Math.min(width, 200));
  if (text.length >= w) return text;
  const padN = w - text.length;
  if (mode === "right") return " ".repeat(padN) + text;
  if (mode === "center") {
    const l = Math.floor(padN / 2);
    return " ".repeat(l) + text + " ".repeat(padN - l);
  }
  return text + " ".repeat(padN);
}

/* ---------- v0.6: lorem ipsum ---------- */

const LOREM_WORDS =
  "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum".split(" ");

export function loremIpsum(paragraphs: number): string[] {
  const rand = (n: number) => Math.floor(Math.random() * n);
  const sentence = () => {
    const words = Array.from({ length: 6 + rand(10) }, () => LOREM_WORDS[rand(LOREM_WORDS.length)]);
    return words[0][0].toUpperCase() + words[0].slice(1) + " " + words.slice(1).join(" ") + ".";
  };
  const paragraph = () => Array.from({ length: 3 + rand(4) }, sentence).join(" ");
  return Array.from({ length: Math.max(1, Math.min(paragraphs, 8)) }, paragraph);
}

/* ---------- v0.6: tab expansion ---------- */

/** expand tabs to spaces at fixed tab stops (classic expand) */
export function expandTabs(text: string, width = 4): string {
  const w = Math.max(1, Math.min(width, 16));
  return text.split("\n").map((line) => {
    let col = 0;
    let out = "";
    for (const ch of line) {
      if (ch === "\t") {
        const spaces = w - (col % w);
        out += " ".repeat(spaces);
        col += spaces;
      } else {
        out += ch;
        col++;
      }
    }
    return out;
  }).join("\n");
}

/* ---------- v0.6: shuffle ---------- */

export function shuffled<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ---------- v0.6: dice ---------- */

/** roll NdM dice; returns individual rolls (null if the spec is invalid) */
export function rollDice(spec: string): { rolls: number[]; sides: number } | null {
  const m = /^(\d{0,3})d(\d{1,3})$/i.exec(spec.trim());
  if (!m) return null;
  const count = Math.min(Math.max(parseInt(m[1] || "1", 10), 1), 10);
  const sides = Math.min(Math.max(parseInt(m[2], 10), 2), 1000);
  return {
    rolls: Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1),
    sides,
  };
}

/* ---------- v0.6: prime factorization ---------- */

/** trial division; returns prime factors (with repetition), [] for n < 2 */
export function primeFactors(n: number): number[] {
  if (!Number.isInteger(n) || n < 2) return [];
  const out: number[] = [];
  let v = n;
  for (let p = 2; p * p <= v; p += p === 2 ? 1 : 2) {
    while (v % p === 0) {
      out.push(p);
      v /= p;
    }
  }
  if (v > 1) out.push(v);
  return out;
}

/* ---------- v0.6: edit distance ---------- */

/** classic Levenshtein distance (DP, O(len(a)×len(b))) */
export function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[n];
}
