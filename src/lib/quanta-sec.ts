/*
 * QUANTA security toolkit — pure, real computations (no mocks).
 *
 * md5: compact pure-JS RFC 1321 implementation (Web Crypto has no MD5).
 * crack: a REAL dictionary attack over a built-in wordlist (md5/sha1/sha256) —
 *        demonstrates why weak passwords die instantly, runs locally.
 * jwt: real base64url decode of header/payload (signature is NOT verified).
 * pwgen/macgen/rot13/caesar/hex: real transforms.
 *
 * The only simulated tool in the sec suite is `nmap` (a browser sandbox
 * cannot open raw TCP sockets) — the command output says so explicitly.
 */

/* ---------- md5 (RFC 1321, little-endian, over UTF-8 bytes) ---------- */

const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const MD5_K = (() => {
  const k = new Uint32Array(64);
  for (let i = 0; i < 64; i++) k[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0;
  return k;
})();

function rotl(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

/** real MD5 hex digest of a UTF-8 string */
export function md5Hex(input: string): string {
  const msg = new TextEncoder().encode(input);
  const bitLen = msg.length * 8;
  /* padded length: message + 0x80 + zeros + 8-byte LE length, multiple of 64 */
  const total = (((msg.length + 8) >> 6) + 1) * 64;
  const buf = new Uint8Array(total);
  buf.set(msg);
  buf[msg.length] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, bitLen >>> 0, true);
  dv.setUint32(total - 4, Math.floor(bitLen / 2 ** 32), true);

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;

  for (let off = 0; off < total; off += 64) {
    const m = new Uint32Array(16);
    for (let i = 0; i < 16; i++) m[i] = dv.getUint32(off + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F: number, g: number;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + MD5_K[i] + m[g]) >>> 0;
      A = D; D = C; C = B;
      B = (B + rotl(F, MD5_S[i])) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  const le = (n: number) => {
    let s = "";
    for (let i = 0; i < 4; i++) s += ((n >>> (i * 8)) & 0xff).toString(16).padStart(2, "0");
    return s;
  };
  return le(a0) + le(b0) + le(c0) + le(d0);
}

/* ---------- classic cipher toys ---------- */

export function rot13(text: string): string {
  return text.replace(/[a-z]/gi, (ch) => {
    const base = ch <= "Z" ? 65 : 97;
    return String.fromCharCode(((ch.charCodeAt(0) - base + 13) % 26) + base);
  });
}

export function caesar(text: string, shift: number): string {
  const n = ((shift % 26) + 26) % 26;
  return text.replace(/[a-z]/gi, (ch) => {
    const base = ch <= "Z" ? 65 : 97;
    return String.fromCharCode(((ch.charCodeAt(0) - base + n) % 26) + base);
  });
}

/* ---------- hex encode/decode (utf-8) ---------- */

export function hexEncode(text: string): string {
  return [...new TextEncoder().encode(text)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function hexDecode(hex: string): string {
  const h = hex.trim().replace(/\s+/g, "");
  if (!/^[0-9a-fA-F]*$/.test(h) || h.length % 2 !== 0) return "";
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return new TextDecoder().decode(bytes);
}

/* ---------- password generator (real crypto randomness) ---------- */

const PW_LOWER = "abcdefghijkmnopqrstuvwxyz";
const PW_UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const PW_DIGIT = "23456789";
const PW_SYMBOL = "!@#$%^&*()-_=+[]{};:,.?/";

function randInt(maxExclusive: number): number {
  /* reject sampling on crypto.getRandomValues — unbiased */
  const lim = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
  const buf = new Uint32Array(1);
  do {
    crypto.getRandomValues(buf);
  } while (buf[0] >= lim);
  return buf[0] % maxExclusive;
}

export function pwgen(length = 16): string {
  const len = Math.min(64, Math.max(8, length));
  const pools = [PW_LOWER, PW_UPPER, PW_DIGIT, PW_SYMBOL];
  const all = pools.join("");
  /* guarantee one char from each class, fill the rest, then shuffle (Fisher-Yates) */
  const chars = pools.map((p) => p[randInt(p.length)]);
  while (chars.length < len) chars.push(all[randInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

export function entropyBits(pw: string): number {
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/[0-9]/.test(pw)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) pool += 24;
  return pool > 0 ? Math.round(pw.length * Math.log2(pool)) : 0;
}

/* ---------- MAC generator (locally administered, unicast) ---------- */

export function macgen(): string {
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  b[0] = (b[0] | 0x02) & 0xfe; /* set "locally administered", clear multicast bit */
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join(":");
}

/* ---------- JWT decode (real base64url; signature NOT verified) ---------- */

export interface JwtParts { header?: Record<string, unknown>; payload?: Record<string, unknown>; error?: string }

function b64urlDecode(part: string): string | null {
  try {
    let b = part.replace(/-/g, "+").replace(/_/g, "/");
    while (b.length % 4) b += "=";
    const bin = atob(b);
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

export function jwtDecode(token: string): JwtParts {
  const parts = token.trim().split(".");
  if (parts.length < 2 || parts.length > 3) return { error: `expected 2-3 dot-separated segments, got ${parts.length}` };
  const out: JwtParts = {};
  const h = b64urlDecode(parts[0]);
  if (!h) return { error: "header is not valid base64url" };
  try { out.header = JSON.parse(h) as Record<string, unknown>; } catch { return { error: "header is not valid JSON" }; }
  const p = b64urlDecode(parts[1]);
  if (!p) return { error: "payload is not valid base64url" };
  try { out.payload = JSON.parse(p) as Record<string, unknown>; } catch { return { error: "payload is not valid JSON" }; }
  return out;
}

/* ---------- REAL dictionary attack (md5/sha1/sha256) ---------- */

export const CRACK_WORDLIST = [
  "123456", "password", "12345678", "qwerty", "abc123", "111111", "123123",
  "admin", "letmein", "welcome", "monkey", "dragon", "football", "iloveyou",
  "password1", "admin123", "root", "toaster", "quanta", "tokyo", "000000",
  "121212", "654321", "superman", "batman", "trustno1", "hello", "freedom",
  "whatever", "qazwsx", "sunlight", "master", "michael", "shadow", "jordan",
  "harley", "ranger", "buster", "hunter", "thomas", "soccer", "hockey",
  "killer", "george", "sexy", "andrew", "charlie", "tigger", "password!",
];

export interface CrackResult {
  found: boolean;
  algo?: "md5" | "sha1" | "sha256";
  plain?: string;
  attempts: number;
  timeMs: number;
}

/** real dictionary attack: tries every candidate against md5, sha1 and sha256 */
export async function crackHash(target: string, sha: (algo: "SHA-1" | "SHA-256", t: string) => Promise<string>): Promise<CrackResult> {
  const t0 = Date.now();
  const h = target.trim().toLowerCase();
  if (!/^[0-9a-f]{32}$|^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(h)) {
    return { found: false, attempts: 0, timeMs: Date.now() - t0 };
  }
  const wantLen = h.length;
  let attempts = 0;
  for (const w of CRACK_WORDLIST) {
    attempts++;
    if (wantLen === 32 && md5Hex(w) === h) return { found: true, algo: "md5", plain: w, attempts, timeMs: Date.now() - t0 };
    if (wantLen === 40 && (await sha("SHA-1", w)) === h) return { found: true, algo: "sha1", plain: w, attempts, timeMs: Date.now() - t0 };
    if (wantLen === 64 && (await sha("SHA-256", w)) === h) return { found: true, algo: "sha256", plain: w, attempts, timeMs: Date.now() - t0 };
  }
  return { found: false, attempts, timeMs: Date.now() - t0 };
}

/* ---------- deterministic pseudo-target generator for the nmap SIMULATION ---------- */

/** stable 32-bit hash of a string (FNV-1a) — keeps simulated scans reproducible per host */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/* ---------- Shannon entropy (measured symbol distribution) ---------- */

export interface ShannonResult {
  bitsPerChar: number;
  length: number;
  unique: number;
  classes: { lower: number; upper: number; digits: number; symbols: number; spaces: number };
  guessSpaceBits: number;
}

/** real Shannon entropy of the actual character distribution, plus charset classes */
export function shannonEntropy(text: string): ShannonResult {
  const length = text.length;
  const classes = { lower: 0, upper: 0, digits: 0, symbols: 0, spaces: 0 };
  const freq = new Map<string, number>();
  for (const ch of text) {
    freq.set(ch, (freq.get(ch) ?? 0) + 1);
    if (ch >= "a" && ch <= "z") classes.lower++;
    else if (ch >= "A" && ch <= "Z") classes.upper++;
    else if (ch >= "0" && ch <= "9") classes.digits++;
    else if (ch === " " || ch === "\t") classes.spaces++;
    else classes.symbols++;
  }
  let h = 0;
  for (const count of freq.values()) {
    const p = count / length;
    h -= p * Math.log2(p);
  }
  /* effective key space if every position were drawn from the observed alphabet */
  const alphabet = classes.lower + classes.upper + classes.digits + classes.symbols + (classes.spaces > 0 ? 1 : 0);
  const guessSpaceBits = length > 0 ? Math.log2(Math.max(alphabet, 2)) * length : 0;
  return {
    bitsPerChar: length ? Math.round(h * 100) / 100 : 0,
    length,
    unique: freq.size,
    classes,
    guessSpaceBits: Math.round(guessSpaceBits),
  };
}

export function shannonVerdict(bitsPerChar: number): string {
  if (bitsPerChar >= 4) return "very high — effectively random";
  if (bitsPerChar >= 3) return "high — hard to predict";
  if (bitsPerChar >= 2) return "moderate — some structure";
  if (bitsPerChar >= 1) return "low — patterned text (natural language ≈ 1.0-1.5)";
  return "very low — repeated symbols";
}
