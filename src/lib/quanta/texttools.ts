/**
 * QUANTA — pure text/compute tools. No React, no DOM (except b64 uses a
 * unicode-safe manual base64 so it works identically in bun and browser).
 */

/* ------------------------------- regex ---------------------------------- */

export interface RegexMatchRow {
  index: number
  text: string
  groups: string[]
  line?: number
}

const MAX_MATCHES = 200

/** Zero-width advance guard: ensure lastIndex always moves forward. */
export function regexMatches(pattern: string, flags: string, subject: string): RegexMatchRow[] {
  const rows: RegexMatchRow[] = []
  let re: RegExp
  try {
    re = new RegExp(pattern, flags.includes('g') ? flags : flags + 'g')
  } catch (e) {
    throw new Error(`invalid regex: ${(e as Error).message}`)
  }
  let guard = 0
  while (guard++ < MAX_MATCHES + 1) {
    const m = re.exec(subject)
    if (!m) break
    rows.push({ index: m.index, text: m[0], groups: m.slice(1).map((g) => (g === undefined ? '' : g)) })
    if (m[0] === '') {
      // zero-width match: force progress
      re.lastIndex++
      if (re.lastIndex > subject.length) break
      continue
    }
    if (!re.global) break
    if (rows.length >= MAX_MATCHES) break
  }
  return rows
}

/* -------------------------------- case ---------------------------------- */

export const CASE_MODES = [
  'upper', 'lower', 'title', 'sentence', 'camel', 'pascal',
  'snake', 'kebab', 'constant', 'alternating', 'reverse',
] as const
export type CaseMode = (typeof CASE_MODES)[number]

const wordsOf = (s: string): string[] =>
  s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)

export function caseTransform(mode: CaseMode, text: string): string {
  const w = wordsOf(text)
  switch (mode) {
    case 'upper':
      return text.toUpperCase()
    case 'lower':
      return text.toLowerCase()
    case 'title':
      return text.replace(/\w\S*/g, (t) => t[0].toUpperCase() + t.slice(1).toLowerCase())
    case 'sentence':
      return text
        .toLowerCase()
        .replace(/(^\s*\w|[.!?]\s*\w)/g, (c) => c.toUpperCase())
    case 'camel':
      return w
        .map((x, i) => (i === 0 ? x.toLowerCase() : x[0].toUpperCase() + x.slice(1).toLowerCase()))
        .join('')
    case 'pascal':
      return w.map((x) => x[0].toUpperCase() + x.slice(1).toLowerCase()).join('')
    case 'snake':
      return w.map((x) => x.toLowerCase()).join('_')
    case 'kebab':
      return w.map((x) => x.toLowerCase()).join('-')
    case 'constant':
      return w.map((x) => x.toUpperCase()).join('_')
    case 'alternating':
      return text
        .split('')
        .map((c, i) => (i % 2 === 0 ? c.toLowerCase() : c.toUpperCase()))
        .join('')
    case 'reverse':
      return text.split('').reverse().join('')
  }
}

/* -------------------------------- ascii --------------------------------- */

export interface AsciiRow {
  ch: string
  cp: number
  dec: number
  hex: string
  bin: string
  utf8: number[]
}

export function asciiTable(text: string): AsciiRow[] {
  const rows: AsciiRow[] = []
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    const utf8: number[] = []
    for (const b of new TextEncoder().encode(ch)) utf8.push(b)
    rows.push({
      ch: ch === ' ' ? '␠' : ch,
      cp,
      dec: cp,
      hex: '0x' + cp.toString(16).toUpperCase().padStart(2, '0'),
      bin: cp.toString(2).padStart(8, '0'),
      utf8,
    })
  }
  return rows
}

/* --------------------------------- url ---------------------------------- */

export interface UrlInfo {
  href: string
  protocol: string
  host: string
  hostname: string
  port: string
  pathname: string
  search: string
  hash: string
  origin: string
  params: Array<[string, string]>
  encoded: string
  decoded: string
}

export function urlInfo(raw: string): UrlInfo {
  let u: URL
  try {
    u = new URL(raw.includes('://') ? raw : `https://${raw}`)
  } catch {
    throw new Error(`invalid url: ${raw}`)
  }
  const params: Array<[string, string]> = []
  u.searchParams.forEach((v, k) => params.push([k, v]))
  return {
    href: u.href,
    protocol: u.protocol,
    host: u.host,
    hostname: u.hostname,
    port: u.port,
    pathname: u.pathname,
    search: u.search,
    hash: u.hash,
    origin: u.origin,
    params,
    encoded: encodeURIComponent(raw),
    decoded: (() => {
      try {
        return decodeURIComponent(raw)
      } catch {
        return '(not decodable)'
      }
    })(),
  }
}

/* --------------------------------- diff --------------------------------- */

export interface DiffRow {
  type: 'same' | 'add' | 'del'
  aLine?: number
  bLine?: number
  text: string
}

const splitLines = (s: string): string[] => (s === '' ? [] : s.split('\n'))

/** Classic LCS line diff, capped at 300 lines per side. */
export function diffText(a: string, b: string): DiffRow[] {
  const A = splitLines(a).slice(0, 300)
  const B = splitLines(b).slice(0, 300)
  const n = A.length
  const m = B.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const rows: DiffRow[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      rows.push({ type: 'same', aLine: i + 1, bLine: j + 1, text: A[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ type: 'del', aLine: i + 1, text: A[i] })
      i++
    } else {
      rows.push({ type: 'add', bLine: j + 1, text: B[j] })
      j++
    }
  }
  while (i < n) rows.push({ type: 'del', aLine: ++i, text: A[i - 1] })
  while (j < m) rows.push({ type: 'add', bLine: ++j, text: B[j - 1] })
  return rows
}

/* --------------------------------- calc --------------------------------- */
/** Safe expression evaluator: shunting-yard, no eval, no Function(). */

type Tok = { t: 'num'; v: number } | { t: 'op'; v: string } | { t: 'fn'; v: string } | { t: 'paren'; v: '(' | ')' } | { t: 'comma' }

const FNS: Record<string, (...a: number[]) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  log: Math.log10,
  ln: Math.log,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
}
const PREC: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2, '^': 3 }

export function calcExpression(input: string): number {
  const src = input.replace(/\bpi\b/gi, String(Math.PI)).replace(/\be\b/g, String(Math.E))
  const toks: Tok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) { i++; continue }
    if (/[0-9.]/.test(c)) {
      let j = i
      while (j < src.length && /[0-9.]/.test(src[j])) j++
      const num = Number(src.slice(i, j))
      if (!Number.isFinite(num)) throw new Error(`bad number: ${src.slice(i, j)}`)
      toks.push({ t: 'num', v: num })
      i = j
      continue
    }
    if (/[a-z]/i.test(c)) {
      let j = i
      while (j < src.length && /[a-z0-9]/i.test(src[j])) j++
      const name = src.slice(i, j).toLowerCase()
      if (!(name in FNS)) throw new Error(`unknown function: ${name}`)
      toks.push({ t: 'fn', v: name })
      i = j
      continue
    }
    if (c === '(' || c === ')') { toks.push({ t: 'paren', v: c }); i++; continue }
    if (c === ',') { toks.push({ t: 'comma' }); i++; continue }
    if (c in PREC) {
      // unary minus
      const prev = toks[toks.length - 1]
      if (c === '-' && (!prev || prev.t === 'op' || (prev.t === 'paren' && prev.v === '(') || prev.t === 'comma')) {
        toks.push({ t: 'num', v: 0 })
      }
      toks.push({ t: 'op', v: c })
      i++
      continue
    }
    throw new Error(`unexpected char: ${c}`)
  }

  const out: Tok[] = []
  const ops: Tok[] = []
  for (const tk of toks) {
    if (tk.t === 'num') out.push(tk)
    else if (tk.t === 'fn') ops.push(tk)
    else if (tk.t === 'comma') {
      while (ops.length && !(ops[ops.length - 1].t === 'paren')) out.push(ops.pop()!)
    } else if (tk.t === 'op') {
      while (
        ops.length &&
        ops[ops.length - 1].t === 'op' &&
        PREC[(ops[ops.length - 1] as { v: string }).v] >= PREC[tk.v] &&
        tk.v !== '^'
      ) {
        out.push(ops.pop()!)
      }
      ops.push(tk)
    } else if (tk.t === 'paren') {
      if (tk.v === '(') ops.push(tk)
      else {
        while (ops.length && !(ops[ops.length - 1].t === 'paren' && (ops[ops.length - 1] as { v: string }).v === '(')) {
          out.push(ops.pop()!)
        }
        if (!ops.length) throw new Error('unbalanced parens')
        ops.pop() // drop '('
        if (ops.length && ops[ops.length - 1].t === 'fn') out.push(ops.pop()!)
      }
    }
  }
  while (ops.length) {
    const op = ops.pop()!
    if (op.t === 'paren') throw new Error('unbalanced parens')
    out.push(op)
  }

  const st: number[] = []
  for (const tk of out) {
    if (tk.t === 'num') st.push(tk.v)
    else if (tk.t === 'op') {
      if (st.length < 2) throw new Error('operand missing')
      const b = st.pop()!
      const a = st.pop()!
      switch (tk.v) {
        case '+': st.push(a + b); break
        case '-': st.push(a - b); break
        case '*': st.push(a * b); break
        case '/': st.push(a / b); break
        case '%': st.push(a % b); break
        case '^': st.push(Math.pow(a, b)); break
      }
    } else if (tk.t === 'fn') {
      const fn = FNS[tk.v]
      const arity = tk.v === 'min' || tk.v === 'max' || tk.v === 'pow' ? 2 : 1
      if (st.length < arity) throw new Error(`missing args for ${tk.v}`)
      const args = st.splice(st.length - arity, arity)
      st.push(fn(...args))
    }
  }
  if (st.length !== 1) throw new Error('malformed expression')
  return st[0]
}

export function fmtNum(n: number): string {
  if (Number.isInteger(n)) return String(n)
  return String(Number(n.toFixed(10)))
}

/* ------------------------------ base64 / hex ---------------------------- */

export function b64encode(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

export function b64decode(b64: string): string {
  const bin = atob(b64.trim())
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/* -------------------------------- format -------------------------------- */

export function fmtElapsed(ms: number, opts: { precise?: boolean } = {}): string {
  const total = Math.max(0, Math.floor(ms))
  const h = Math.floor(total / 3_600_000)
  const m = Math.floor((total % 3_600_000) / 60_000)
  const s = Math.floor((total % 60_000) / 1000)
  const cs = Math.floor((total % 1000) / 10)
  const pad = (v: number, w = 2) => String(v).padStart(w, '0')
  const core = `${pad(h)}:${pad(m)}:${pad(s)}`
  return opts.precise ? `${core}.${pad(cs)}` : core
}
