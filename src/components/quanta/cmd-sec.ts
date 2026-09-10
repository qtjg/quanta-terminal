/* QUANTA security toolkit: jwt cipher passwd crackme recon
   Real crypto via WebCrypto, real recon data via the quanta backend. */

import { CmdCtx, CmdDef, err, hasStdin } from "./core";
import { shannonEntropy, shannonVerdict } from "../../lib/quanta-sec";

/* ---------- shared crypto helpers (browser + bun compatible) ---------- */

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function b64urlDecode(s: string): string {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  return new TextDecoder("utf-8", { fatal: false }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/* cryptographically strong random int in [0, n) */
function randInt(n: number): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] % n;
}

/* ---------- jwt ---------- */

interface JwtParsed {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signatureLen: number; // -1 when absent
}

function parseJwt(tok: string): JwtParsed | null {
  const parts = tok.trim().split(".");
  if (parts.length < 2 || parts.length > 5) return null; // JWE has 5; we audit JWS (3)
  if (parts.length > 3) return null;
  try {
    const header = JSON.parse(b64urlDecode(parts[0])) as Record<string, unknown>;
    const payload = JSON.parse(b64urlDecode(parts[1])) as Record<string, unknown>;
    return { header, payload, signatureLen: parts[2] ? parts[2].length : -1 };
  } catch {
    return null;
  }
}

function jwtDate(unix: unknown): string {
  return new Date(Number(unix) * 1000).toISOString().slice(0, 10);
}

function auditJwt(j: JwtParsed): string[] {
  const out: string[] = [];
  const now = Date.now() / 1000;
  const alg = String(j.header.alg ?? "?");
  if (alg === "none") out.push("  ⚠ alg:none — UNSIGNED token, anyone can forge it");
  if (j.signatureLen < 0 && alg !== "none") out.push("  ⚠ signature missing on an signed-alg token");
  if (typeof j.payload.exp === "number") {
    if (j.payload.exp < now) {
      const days = Math.floor((now - j.payload.exp) / 86400);
      out.push(`  ⚠ EXPIRED ${jwtDate(j.payload.exp)} (${days} day(s) ago)`);
    } else {
      const hrs = Math.round((j.payload.exp - now) / 3600);
      out.push(`  ✓ exp valid for ~${hrs >= 48 ? `${Math.round(hrs / 24)} day(s)` : `${hrs} hour(s)`}`);
    }
  } else {
    out.push("  ⚠ no exp claim — token never expires (risky)");
  }
  if (typeof j.payload.iat === "number") out.push(`  iat issued ${jwtDate(j.payload.iat)}`);
  if (typeof j.payload.nbf === "number" && j.payload.nbf > now) out.push("  ⚠ nbf in the future — not yet valid");
  out.push(
    alg === "none"
      ? "  verdict  DO NOT TRUST — unsigned"
      : `  verdict  parses clean · alg ${alg}${j.signatureLen > 0 ? ` · signature present (not verified — no key)` : ""}`,
  );
  return out;
}

/* ---------- cipher ---------- */

function rot13(s: string): string {
  return s.replace(/[a-zA-Z]/g, (c) => {
    const base = c <= "Z" ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
}

function caesar(s: string, shift: number): string {
  const n = ((shift % 26) + 26) % 26;
  return s.replace(/[a-zA-Z]/g, (c) => {
    const base = c <= "Z" ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + n) % 26) + base);
  });
}

function toHex(s: string): string {
  return [...new TextEncoder().encode(s)].map((b) => b.toString(16).padStart(2, "0")).join(" ");
}

function fromHex(s: string): string | null {
  const clean = s.replace(/0x/gi, "").replace(/[\s,]+/g, "");
  if (!clean || !/^[0-9a-f]+$/i.test(clean) || clean.length % 2) return null;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function toBin(s: string): string {
  return [...new TextEncoder().encode(s)].map((b) => b.toString(2).padStart(8, "0")).join(" ");
}

function fromBin(s: string): string | null {
  const clean = s.replace(/[^01]/g, "");
  if (!clean || clean.length % 8) return null;
  const bytes = new Uint8Array(clean.length / 8);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.slice(i * 8, i * 8 + 8), 2);
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

/* ---------- passwd ---------- */

const CHARSETS = {
  lower: "abcdefghijklmnopqrstuvwxyz",
  upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  digits: "0123456789",
  symbols: "!@#$%^&*()-_=+[]{};:,.?/",
};

function genPassword(len: number): string {
  const pool = Object.values(CHARSETS).join("");
  const chars: string[] = [];
  /* guarantee one of each class, fill the rest from the full pool */
  for (const cs of Object.values(CHARSETS)) chars.push(cs[randInt(cs.length)]);
  while (chars.length < len) chars.push(pool[randInt(pool.length)]);
  /* Fisher-Yates shuffle with crypto randomness */
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.slice(0, len).join("");
}

function entropyBits(len: number): number {
  const poolSize = Object.values(CHARSETS).join("").length;
  return Math.round(len * Math.log2(poolSize) * 10) / 10;
}

function strengthBar(bits: number): string {
  const pct = Math.min(1, bits / 128);
  const filled = Math.round(pct * 14);
  const label = bits >= 100 ? "FORTRESS" : bits >= 80 ? "STRONG" : bits >= 60 ? "DECENT" : "WEAK";
  return `[${"█".repeat(filled)}${"·".repeat(14 - filled)}] ${bits} bits — ${label}`;
}

/* ---------- crackme ---------- */

const WORDLIST = [
  "password", "123456", "12345678", "qwerty", "abc123", "monkey", "dragon", "letmein",
  "football", "iloveyou", "admin", "welcome", "login", "princess", "sunshine", "master",
  "shadow", "superman", "batman", "trustno1", "hunter2", "quanta", "mayank", "tokyo",
  "root", "toor", "pass123", "password1", "password123", "qwerty123", "1q2w3e4r",
  "starwars", "hello", "freedom", "whatever", "secret", "google", "anime", "naruto",
  "pokemon", "computer", "internet", "samsung", "michael", "jordan25",
];

let challenge: { hash: string; word: string; guesses: number } | null = null;

/* dictionary attack: plain list + the classic weak mutations */
async function dictionaryAttack(hash: string): Promise<{ word: string | null; tried: number }> {
  const candidates: string[] = [];
  for (const w of WORDLIST) {
    candidates.push(w, w.toUpperCase(), w[0].toUpperCase() + w.slice(1), `${w}1`, `${w}!`, `${w}123`, `P${w}`);
  }
  let tried = 0;
  for (const c of candidates) {
    tried++;
    if ((await sha256Hex(c)) === hash) return { word: c, tried };
  }
  return { word: null, tried };
}

/* ---------- recon ---------- */

interface ReconResponse {
  ok: boolean;
  error?: string;
  domain?: string;
  dns?: {
    A?: string[]; AAAA?: string[]; MX?: string[]; NS?: string[]; TXT?: string[];
    note?: string;
  };
  rdap?: { registrar?: string; created?: string; updated?: string; expires?: string; status?: string[] } | null;
  http?: {
    status?: number; server?: string; poweredBy?: string; timeMs?: number;
    security?: Record<string, boolean>; missing?: string[]; grade?: string;
  } | null;
  timeMs?: number;
}

const SECURITY_HEADERS = ["strict-transport-security", "content-security-policy", "x-frame-options", "x-content-type-options", "referrer-policy", "permissions-policy"];

function reconGrade(missing: string[]): string {
  const n = SECURITY_HEADERS.length - missing.length;
  return n === 6 ? "A — hardened" : n === 5 ? "B" : n === 4 ? "C" : n === 3 ? "D" : "F — exposed";
}

async function runRecon(apiBase: string, domain: string): Promise<ReconResponse> {
  try {
    const res = await fetch(`${apiBase}/api/quanta/recon`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain }),
    });
    return (await res.json()) as ReconResponse;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "recon request failed" };
  }
}

function renderRecon(j: ReconResponse): string[] {
  const d = j.domain ?? "?";
  const out = [`DOMAIN RECON — ${d}`, ""];
  if (j.dns) {
    const dns = j.dns;
    out.push(`  dns       A     ${dns.A?.length ? dns.A.join(", ") : "—"}`);
    out.push(`            AAAA  ${dns.AAAA?.length ? dns.AAAA.join(", ") : "—"}`);
    out.push(`            MX    ${dns.MX?.length ? dns.MX.join(", ") : "none (no mail)"}`);
    out.push(`            NS    ${dns.NS?.length ? dns.NS.join(", ") : "—"}`);
    out.push(`            TXT   ${dns.TXT?.length ? `${dns.TXT.length} record(s): ${dns.TXT.slice(0, 2).map((t) => t.slice(0, 46)).join(" · ")}` : "—"}`);
  }
  if (j.rdap) {
    const r = j.rdap;
    out.push(`  whois     registrar: ${r.registrar ?? "unknown"}`);
    out.push(`            created ${r.created ?? "?"} · updated ${r.updated ?? "?"} · expires ${r.expires ?? "?"}`);
    if (r.status?.length) out.push(`            status: ${r.status.slice(0, 3).join(", ")}`);
  } else {
    out.push("  whois     no RDAP record for this TLD");
  }
  if (j.http) {
    const h = j.http;
    out.push(`  http      ${h.status ?? "?"} · server: ${h.server ?? "hidden"}${h.poweredBy ? ` · powered-by: ${h.poweredBy}` : ""} (${h.timeMs} ms)`);
    if (h.security) {
      const got = SECURITY_HEADERS.length - (h.missing?.length ?? 0);
      out.push(`  headers   security: ${got}/${SECURITY_HEADERS.length}`);
      out.push(`            missing: ${h.missing?.length ? h.missing.join(", ") : "none — full coverage"}`);
    }
  } else {
    out.push("  http      site unreachable over https (or no web server)");
  }
  out.push("", `  grade     ${j.http?.grade ?? "n/a"}`, `  source    dns.google · rdap.org · direct fetch · ${j.timeMs ?? "?"} ms total`);
  return out;
}

/* ---------- commands ---------- */

export const SEC_COMMANDS: CmdDef[] = [
  {
    name: "jwt", cat: "sec", desc: "decode & audit a JSON web token", usage: "jwt <header.payload.signature>  ·  cat token.txt | jwt",
    run: async (ctx) => {
      const tok = hasStdin(ctx) && ctx.stdin!.trim() ? ctx.stdin!.trim() : ctx.raw.trim();
      if (!tok) return err("usage: jwt <token>  ·  cat token.txt | jwt");
      const j = parseJwt(tok);
      if (!j) return err("jwt: not a valid JWS token — expected header.payload[.signature] base64url JSON");
      const out = [
        "JWT AUDIT",
        `  header    ${JSON.stringify(j.header)}`,
        `  payload   ${JSON.stringify(j.payload)}`,
        "",
        "  claims",
      ];
      return [...out, ...auditJwt(j)];
    },
  },
  {
    name: "cipher", cat: "sec", desc: "classic cipher toolbox (rot13/caesar/hex/bin)", usage: "cipher rot13 <text> · cipher caesar <n> <text> · cipher hex e|d <x> · cipher bin e|d <x>",
    run: (ctx) => {
      const sub = (ctx.args.shift() ?? "").toLowerCase();
      if (!sub) return err("usage: cipher rot13|caesar|hex|bin — see 'man cipher'");
      const piped = hasStdin(ctx) && ctx.stdin!.trim() ? ctx.stdin!.trim() : "";
      /* hex/bin take a mode letter (e|d) — must be shifted out BEFORE joining the payload */
      const mode = sub === "hex" || sub === "bin" ? (ctx.args.shift() ?? "e").toLowerCase() : "";
      const text = piped || ctx.args.join(" ");
      switch (sub) {
        case "rot13":
          if (!text) return err("cipher rot13: no text (args or pipe)");
          return [rot13(text), "(rot13 is its own inverse — run again to decode)"];
        case "caesar": {
          if (!text) return err("cipher caesar: no text (args or pipe)");
          const shift = parseInt(ctx.args[0] ?? "", 10);
          if (!Number.isFinite(shift)) return err("usage: cipher caesar <shift 1-25> <text> — negative shift decrypts");
          const body = ctx.args.slice(1).join(" ") || text;
          return [caesar(body, shift), `(shift ${shift} — run with ${-shift} to reverse)`];
        }
        case "hex": {
          if (!text) return err("usage: cipher hex e|d <text|hex>");
          if (mode === "e") return [toHex(text), "(hex encode)"];
          if (mode === "d") {
            const dec = fromHex(text);
            return dec === null ? err("cipher hex d: bad hex (even-length 0-9a-f expected)") : [dec, "(hex decode)"];
          }
          return err("usage: cipher hex e|d <text|hex>");
        }
        case "bin": {
          if (!text) return err("usage: cipher bin e|d <text|binary>");
          if (mode === "e") return [toBin(text), "(binary encode)"];
          if (mode === "d") {
            const dec = fromBin(text);
            return dec === null ? err("cipher bin d: bad binary (groups of 8 bits expected)") : [dec, "(binary decode)"];
          }
          return err("usage: cipher bin e|d <text|binary>");
        }
        default:
          return err(`cipher: unknown subcommand '${sub}' — try rot13 · caesar · hex · bin`);
      }
    },
  },
  {
    name: "passwd", cat: "sec", desc: "strong password generator with entropy meter", usage: "passwd [length 8-64] [count 1-10]",
    run: (ctx) => {
      const len = Math.min(Math.max(parseInt(ctx.args[0] ?? "20", 10) || 20, 8), 64);
      const count = Math.min(Math.max(parseInt(ctx.args[1] ?? "1", 10) || 1, 1), 10);
      const bits = entropyBits(len);
      const out: string[] = [];
      for (let i = 0; i < count; i++) out.push(`  ${genPassword(len)}`);
      out.push("", `  strength  ${strengthBar(bits)}`, "  entropy   crypto.getRandomValues — never Math.random", "  tip       unique password per site — length beats complexity tricks");
      return out;
    },
  },
  {
    name: "crackme", cat: "sec", desc: "hash cracking: challenge game + real dictionary attack", usage: "crackme · crackme guess <word> · crackme giveup · crackme demo · crackme <sha256-hex>",
    run: async (ctx) => {
      const arg = ctx.raw.trim();
      if (!arg) {
        /* new challenge */
        const word = WORDLIST[randInt(WORDLIST.length)];
        challenge = { hash: await sha256Hex(word), word, guesses: 0 };
        return [
          "CRACKME — sha256 challenge",
          `  target:  ${challenge.hash}`,
          `  hint:    ${word.length} chars · lowercase · in the weak-password dictionary`,
          "",
          "  guess:   crackme guess <word>   give up: crackme giveup   demo: crackme demo",
        ];
      }
      if (arg === "demo") {
        const word = WORDLIST[randInt(WORDLIST.length)];
        const hash = await sha256Hex(word);
        const t0 = Date.now();
        const { word: cracked, tried } = await dictionaryAttack(hash);
        const ms = Date.now() - t0;
        if (cracked) {
          return [
            "DICTIONARY ATTACK — live demo (real sha256, real loop)",
            `  target hash:  ${hash}`,
            `  cracked:      "${cracked}" after ${tried} candidate hashes in ${ms} ms`,
            "  lesson:       weak passwords die in milliseconds — length + randomness win",
          ];
        }
        return err("crackme demo: wordlist walk failed to hit its own target (should not happen)");
      }
      if (arg === "giveup") {
        if (!challenge) return err("crackme: no active challenge — run 'crackme' first");
        const w = challenge.word;
        challenge = null;
        return [`the secret was "${w}" — try another: crackme`];
      }
      if (arg.startsWith("guess ")) {
        const guess = arg.slice(6).trim().toLowerCase();
        if (!challenge) return err("crackme: no active challenge — run 'crackme' first");
        challenge.guesses++;
        if ((await sha256Hex(guess)) === challenge.hash) {
          const n = challenge.guesses;
          challenge = null;
          return [`CRACKED ✓ "${guess}" was the secret — cracked in ${n} guess(es)`];
        }
        return [`miss (${challenge.guesses} guess(es)) — hash of "${guess}" ≠ target`];
      }
      if (/^[0-9a-f]{64}$/i.test(arg)) {
        /* real dictionary attack against a user-supplied sha256 */
        const t0 = Date.now();
        const { word, tried } = await dictionaryAttack(arg.toLowerCase());
        const ms = Date.now() - t0;
        return word
          ? [
              `CRACKED ✓ sha256 ${arg.slice(0, 16)}…`,
              `  password:  "${word}"`,
              `  method:    dictionary (${WORDLIST.length} words + weak mutations = ${tried} hashes) in ${ms} ms`,
              "  verdict:   if this guards anything real — rotate it NOW",
            ]
          : [
              `not in dictionary — ${tried} candidate hashes tried in ${ms} ms`,
              "  good (or out of list). strong passwords beat wordlists.",
            ];
      }
      return err("usage: crackme · crackme guess <word> · crackme giveup · crackme demo · crackme <sha256-hex>");
    },
  },
  {
    name: "recon", cat: "sec", desc: "REAL domain recon: DNS + RDAP whois + HTTP header audit", usage: "recon <domain>",
    run: async (ctx) => {
      const domain = ctx.args[0]?.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      if (!domain) return err("usage: recon <domain>   e.g. recon example.com");
      if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(domain)) {
        return err("recon: that is not a valid domain name (bare IPs/paths not allowed)");
      }
      const j = await runRecon(ctx.apiBase, domain);
      if (!j.ok) return err(`recon: ${j.error ?? "request failed"}`);
      return renderRecon(j);
    },
  },
  {
    name: "entropy", cat: "sec", desc: "Shannon entropy analysis of text/passwords", usage: "entropy <text>  ·  cat file | entropy",
    run: (ctx) => {
      let text = "";
      if (hasStdin(ctx)) text = ctx.stdin ?? "";
      else {
        text = ctx.args.join(" ");
        if (!text) return err("usage: entropy <text>  ·  cat file | entropy");
      }
      if (!text.trim()) return err("entropy: empty input");
      const r = shannonEntropy(text.replace(/\n$/, ""));
      const c = r.classes;
      const cls = [
        c.lower ? "lower" : null,
        c.upper ? "upper" : null,
        c.digits ? "digits" : null,
        c.symbols ? "symbols" : null,
        c.spaces ? "spaces" : null,
      ].filter(Boolean).join(" · ");
      return [
        `shannon entropy: ${r.bitsPerChar} bits/char`,
        `length: ${r.length} chars, ${r.unique} unique symbols`,
        `classes present: ${cls || "(none)"}`,
        `brute-force space ≈ 2^${r.guessSpaceBits} (observed alphabet)`,
        `verdict: ${shannonVerdict(r.bitsPerChar)}`,
      ];
    },
  },
];
