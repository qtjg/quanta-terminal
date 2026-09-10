/**
 * QUANTA — command engine.
 * Pure TypeScript. Each command really operates on the QuantaFS / real
 * environment data. Runs in browser and under `bun` for tests.
 */

import {
  baseName,
  dirName,
  FsError,
  QuantaFS,
} from './fs'
import {
  asciiTable,
  b64decode,
  b64encode,
  calcExpression,
  CASE_MODES,
  caseTransform,
  diffText,
  fmtElapsed,
  fmtNum,
  regexMatches,
  urlInfo,
  type CaseMode,
  type DiffRow,
} from './texttools'

/* ------------------------------ output types ---------------------------- */

export type OutClass = 'err' | 'dim' | 'ok' | 'warn' | 'accent' | 'head'

export interface OutLine {
  text: string
  cls?: OutClass
}

export interface CmdResult {
  lines: OutLine[]
  /** clear the whole screen after this command */
  clear?: boolean
  /** apply a new theme */
  theme?: string
}

export interface SysInfo {
  platform: string
  cores: number
  deviceMemory?: number
  ua: string
  screen: string
  dpr: number
  lang: string
  tz: string
  online: boolean
  storageQuota?: number
  storageUsage?: number
  runtime: string
}

export interface StopwatchState {
  running: boolean
  startedAt: number
  base: number
  laps: number[]
}

export interface QuantaCtx {
  fs: QuantaFS
  cwd: string
  env: Record<string, string>
  history: string[]
  theme: string
  bootAt: number
  sw: StopwatchState
  sys: SysInfo
  ai: (prompt: string, ctxInfo: { cwd: string; listing: string }) => Promise<{ command: string; rationale: string }>
}

export interface Command {
  name: string
  usage: string
  desc: string
  group: 'filesystem' | 'session' | 'tools' | 'ai'
  run(args: string[], ctx: QuantaCtx): Promise<CmdResult> | CmdResult
}

/* ------------------------------ tokenizer ------------------------------- */

export function tokenize(input: string): string[] {
  const toks: string[] = []
  let cur = ''
  let quote: '"' | "'" | null = null
  let has = false
  for (let i = 0; i < input.length; i++) {
    const c = input[i]
    if (quote) {
      if (c === quote) quote = null
      else cur += c
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      has = true
      continue
    }
    if (/\s/.test(c)) {
      if (cur !== '' || has) toks.push(cur)
      cur = ''
      has = false
      continue
    }
    if (c === '>' ) {
      if (cur !== '' || has) toks.push(cur)
      cur = ''
      has = false
      if (input[i + 1] === '>') {
        toks.push('>>')
        i++
      } else toks.push('>')
      continue
    }
    cur += c
  }
  if (cur !== '' || has) toks.push(cur)
  return toks
}

export interface Redirect {
  path: string
  append: boolean
}

export function splitRedirect(tokens: string[]): { argv: string[]; redirect: Redirect | null } {
  const idx = tokens.findIndex((t) => t === '>' || t === '>>')
  if (idx === -1) return { argv: tokens, redirect: null }
  const path = tokens[idx + 1]
  if (!path) throw new Error('syntax error near unexpected token `newline\'')
  return { argv: tokens.slice(0, idx), redirect: { path, append: tokens[idx] === '>>' } }
}

/* ------------------------------ flag parser ----------------------------- */

export function parseFlags(
  argv: string[],
  bools: string[],
  valued: string[] = [],
): { flags: Set<string>; values: Record<string, string>; rest: string[] } {
  const flags = new Set<string>()
  const values: Record<string, string> = {}
  const rest: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const name = a.slice(2)
      if (valued.includes(name) && i + 1 < argv.length) values[name] = argv[++i]
      else if (bools.includes(name)) flags.add(name)
      else throw new Error(`unknown option: ${a}`)
      continue
    }
    if (a.startsWith('-') && a.length > 1 && !/^-\d+$/.test(a)) {
      const chars = a.slice(1).split('')
      for (const ch of chars) {
        if (bools.includes(ch)) flags.add(ch)
        else if (valued.includes(ch)) values[ch] = argv[++i] ?? ''
        else throw new Error(`unknown option: -${ch}`)
      }
      continue
    }
    rest.push(a)
  }
  return { flags, values, rest }
}

/* -------------------------------- helpers ------------------------------- */

const L = (text: string, cls?: OutClass): OutLine => ({ text, cls })

function needFsPath(ctx: QuantaCtx, p: string): string {
  return ctx.fs.resolve(p, ctx.cwd)
}

function fileArg(ctx: QuantaCtx, p: string): string {
  const abs = ctx.fs.resolve(p, ctx.cwd)
  if (!ctx.fs.isFile(abs)) throw new FsError(`${p}: no such file`)
  return abs
}

function globToRegex(glob: string): RegExp {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp(`^${esc}$`, 'i')
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 0; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return dp[a.length][b.length]
}

function swElapsed(ctx: QuantaCtx): number {
  return ctx.sw.base + (ctx.sw.running ? Date.now() - ctx.sw.startedAt : 0)
}

export const QUANTA_VERSION = '1.0.0'

/* -------------------------------- registry ------------------------------ */

const commands = new Map<string, Command>()

function cmd(c: Command) {
  commands.set(c.name, c)
}

/* ----- filesystem group ----- */

cmd({
  name: 'help',
  usage: 'help [command]',
  desc: 'list all commands, or show usage for one',
  group: 'session',
  run(args) {
    const [target] = args
    if (target) {
      const c = commands.get(target)
      if (!c) throw new FsError(`no help topics match '${target}'`)
      return { lines: [L(`${c.name} — ${c.desc}`, 'head'), L(`  usage: ${c.usage}`, 'dim')] }
    }
    const lines: OutLine[] = [L(`QUANTA v${QUANTA_VERSION} — ${commands.size} real commands`, 'head'), L('')]
    const groups: Array<[Command['group'], string]> = [
      ['filesystem', 'FILESYSTEM'],
      ['tools', 'TOOLS'],
      ['ai', 'AI'],
      ['session', 'SESSION'],
    ]
    for (const [g, label] of groups) {
      lines.push(L(label, 'accent'))
      for (const c of [...commands.values()].filter((x) => x.group === g)) {
        lines.push(L(`  ${c.usage.padEnd(34)} ${c.desc}`))
      }
      lines.push(L(''))
    }
    lines.push(L("tab: autocomplete   ↑/↓: history   try `neofetch`, `ai <intent>`, `tree`", 'dim'))
    return { lines }
  },
})

cmd({
  name: 'man',
  usage: 'man <command>',
  desc: 'alias of help <command>',
  group: 'session',
  run(args, ctx) {
    return commands.get('help')!.run(args, ctx)
  },
})

cmd({
  name: 'pwd',
  usage: 'pwd',
  desc: 'print working directory',
  group: 'filesystem',
  run(_args, ctx) {
    return { lines: [L(ctx.cwd)] }
  },
})

cmd({
  name: 'ls',
  usage: 'ls [-l|-a|-la] [path]',
  desc: 'list directory contents',
  group: 'filesystem',
  run(args, ctx) {
    const { flags, rest } = parseFlags(args, ['l', 'a'])
    const target = rest[0] ?? '.'
    const abs = ctx.fs.resolve(target, ctx.cwd)
    const entries = ctx.fs.list(abs)
    const lines: OutLine[] = []
    const show = entries.filter(([n]) => flags.has('a') || !n.startsWith('.'))
    if (flags.has('l')) {
      lines.push(L(`total ${show.length}`, 'dim'))
      for (const [name, node] of show) {
        const kind = node.kind === 'dir' ? 'd' : '-'
        const size = String(node.kind === 'dir' ? Object.keys(node.children ?? {}).length : (node.content ?? '').length)
        const when = new Date(node.mtime).toISOString().slice(0, 16).replace('T', ' ')
        lines.push(L(`${kind}rw-r--r--  ${size.padStart(8)}  ${when}  ${name}${node.kind === 'dir' ? '/' : ''}`))
      }
    } else {
      if (show.length === 0) return { lines: [] }
      const names = show.map(([n, node]) => (node.kind === 'dir' ? `${n}/` : n))
      // single column when any name is long, else grid of 4
      const maxLen = Math.max(...names.map((n) => n.length))
      if (maxLen > 24) for (const n of names) lines.push(L(n))
      else {
        const cols = 4
        for (let i = 0; i < names.length; i += cols) {
          lines.push(L(names.slice(i, i + cols).map((n) => n.padEnd(maxLen + 3)).join('')))
        }
      }
    }
    return { lines }
  },
})

cmd({
  name: 'cd',
  usage: 'cd <path> | cd -',
  desc: 'change working directory',
  group: 'filesystem',
  run(args, ctx) {
    const [target] = args
    if (!target || target === '~') {
      ctx.cwd = ctx.env.HOME ?? '/home/quanta'
      return { lines: [] }
    }
    if (target === '-') {
      const prev = ctx.env.OLDPWD
      if (!prev) throw new FsError('no previous directory')
      ctx.env.OLDPWD = ctx.cwd
      ctx.cwd = prev
      return { lines: [L(prev, 'dim')] }
    }
    const abs = ctx.fs.resolve(target, ctx.cwd)
    if (!ctx.fs.exists(abs)) throw new FsError(`${target}: no such file or directory`)
    if (!ctx.fs.isDir(abs)) throw new FsError(`${target}: not a directory`)
    ctx.env.OLDPWD = ctx.cwd
    ctx.cwd = abs
    return { lines: [] }
  },
})

cmd({
  name: 'cat',
  usage: 'cat <file...>',
  desc: 'concatenate and print files',
  group: 'filesystem',
  run(args, ctx) {
    if (!args.length) throw new FsError('missing file operand')
    const lines: OutLine[] = []
    for (const a of args) lines.push(...ctx.fs.readFile(fileArg(ctx, a)).split('\n').map((t, i, arr) => L(i === arr.length - 1 && t === '' ? '' : t)))
    if (lines.length && lines[lines.length - 1].text === '') lines.pop()
    return { lines }
  },
})

cmd({
  name: 'echo',
  usage: 'echo <text...>',
  desc: 'print text (redirect with > or >>)',
  group: 'filesystem',
  run(args) {
    const noNl = args[0] === '-n'
    return { lines: [L((noNl ? args.slice(1) : args).join(' '))] }
  },
})

cmd({
  name: 'touch',
  usage: 'touch <file...>',
  desc: 'create empty files / bump timestamps',
  group: 'filesystem',
  run(args, ctx) {
    if (!args.length) throw new FsError('missing file operand')
    for (const a of args) {
      const abs = ctx.fs.resolve(a, ctx.cwd)
      if (ctx.fs.exists(abs)) {
        const node = ctx.fs.get(abs)!
        node.mtime = Date.now()
      } else ctx.fs.writeFile(abs, '')
    }
    return { lines: [] }
  },
})

cmd({
  name: 'mkdir',
  usage: 'mkdir [-p] <dir...>',
  desc: 'create directories',
  group: 'filesystem',
  run(args, ctx) {
    const { flags, rest } = parseFlags(args, ['p'])
    if (!rest.length) throw new FsError('missing operand')
    for (const d of rest) {
      const abs = ctx.fs.resolve(d, ctx.cwd)
      if (ctx.fs.exists(abs) && !flags.has('p')) throw new FsError(`${d}: file exists`)
      ctx.fs.mkdirp(abs)
    }
    return { lines: [] }
  },
})

cmd({
  name: 'rm',
  usage: 'rm [-r|-f|-rf] <path...>',
  desc: 'remove files or directories',
  group: 'filesystem',
  run(args, ctx) {
    const { flags, rest } = parseFlags(args, ['r', 'f', 'rf'])
    const recursive = flags.has('r') || flags.has('rf')
    const force = flags.has('f') || flags.has('rf')
    if (!rest.length) throw new FsError('missing operand')
    for (const a of rest) ctx.fs.rm(ctx.fs.resolve(a, ctx.cwd), { recursive, force }, '/')
    return { lines: [] }
  },
})

cmd({
  name: 'mv',
  usage: 'mv <src...> <dest>',
  desc: 'move / rename files or directories',
  group: 'filesystem',
  run(args, ctx) {
    if (args.length < 2) throw new FsError('missing destination operand')
    const dest = args[args.length - 1]
    for (const src of args.slice(0, -1)) ctx.fs.mv(ctx.fs.resolve(src, ctx.cwd), ctx.fs.resolve(dest, ctx.cwd), '/')
    return { lines: [] }
  },
})

cmd({
  name: 'cp',
  usage: 'cp [-r] <src...> <dest>',
  desc: 'copy files or directories',
  group: 'filesystem',
  run(args, ctx) {
    const { flags, rest } = parseFlags(args, ['r'])
    if (rest.length < 2) throw new FsError('missing destination operand')
    const dest = rest[rest.length - 1]
    for (const src of rest.slice(0, -1)) ctx.fs.cp(ctx.fs.resolve(src, ctx.cwd), ctx.fs.resolve(dest, ctx.cwd), { recursive: flags.has('r') }, '/')
    return { lines: [] }
  },
})

cmd({
  name: 'tree',
  usage: 'tree [path]',
  desc: 'recursive directory tree',
  group: 'filesystem',
  run(args, ctx) {
    const abs = ctx.fs.resolve(args[0] ?? '.', ctx.cwd)
    if (!ctx.fs.exists(abs)) throw new FsError(`${args[0]}: no such file or directory`)
    const lines: OutLine[] = [L(abs, 'head')]
    let files = 0
    let dirs = 0
    const walk = (p: string, prefix: string) => {
      const entries = ctx.fs.list(p)
      entries.forEach(([name, node], idx) => {
        const last = idx === entries.length - 1
        const branch = last ? '└── ' : '├── '
        lines.push(L(prefix + branch + name + (node.kind === 'dir' ? '/' : ''), node.kind === 'dir' ? 'accent' : undefined))
        if (node.kind === 'dir') {
          dirs++
          walk(p === '/' ? `/${name}` : `${p}/${name}`, prefix + (last ? '    ' : '│   '))
        } else files++
      })
    }
    if (ctx.fs.isDir(abs)) walk(abs, '')
    lines.push(L('', 'dim'))
    lines.push(L(`${dirs} director${dirs === 1 ? 'y' : 'ies'}, ${files} file${files === 1 ? '' : 's'}`, 'dim'))
    return { lines }
  },
})

cmd({
  name: 'find',
  usage: 'find [path] -name <glob>',
  desc: 'search files by name pattern',
  group: 'filesystem',
  run(args, ctx) {
    const ni = args.indexOf('-name')
    if (ni === -1 || !args[ni + 1]) throw new FsError('usage: find [path] -name <glob>')
    const start = ni > 0 ? args.slice(0, ni).join(' ') : '.'
    const pattern = args[ni + 1]
    const abs = ctx.fs.resolve(start, ctx.cwd)
    if (!ctx.fs.exists(abs)) throw new FsError(`${start}: no such file or directory`)
    const re = globToRegex(pattern)
    const hits = ctx.fs.walk(abs).filter((p) => re.test(baseName(p)))
    return { lines: hits.length ? hits.map((p) => L(p)) : [L('no matches', 'dim')] }
  },
})

cmd({
  name: 'wc',
  usage: 'wc [-l|-w|-c] <file>',
  desc: 'count lines / words / chars',
  group: 'filesystem',
  run(args, ctx) {
    const { flags, rest } = parseFlags(args, ['l', 'w', 'c'])
    if (!rest.length) throw new FsError('missing file operand')
    const content = ctx.fs.readFile(fileArg(ctx, rest[0]))
    const lc = content.split('\n').length - (content.endsWith('\n') || content === '' ? 1 : 0)
    const wordCount = content.split(/\s+/).filter(Boolean).length
    const charCount = content.length
    if (flags.has('l')) return { lines: [L(String(lc))] }
    if (flags.has('w')) return { lines: [L(String(wordCount))] }
    if (flags.has('c')) return { lines: [L(String(charCount))] }
    return { lines: [L(`${String(lc).padStart(6)} ${String(wordCount).padStart(6)} ${String(charCount).padStart(6)} ${rest[0]}`)] }
  },
})

cmd({
  name: 'head',
  usage: 'head [-n N] <file>',
  desc: 'first N lines (default 10)',
  group: 'filesystem',
  run(args, ctx) {
    const { values, rest } = parseFlags(args, [], ['n'])
    const n = Number(values.n ?? 10)
    if (!Number.isFinite(n) || n < 0) throw new FsError('bad line count')
    if (!rest.length) throw new FsError('missing file operand')
    const content = ctx.fs.readFile(fileArg(ctx, rest[0]))
    return { lines: content.split('\n').slice(0, n).map((t) => L(t)) }
  },
})

cmd({
  name: 'tail',
  usage: 'tail [-n N] <file>',
  desc: 'last N lines (default 10)',
  group: 'filesystem',
  run(args, ctx) {
    const { values, rest } = parseFlags(args, [], ['n'])
    const n = Number(values.n ?? 10)
    if (!Number.isFinite(n) || n < 0) throw new FsError('bad line count')
    if (!rest.length) throw new FsError('missing file operand')
    const content = ctx.fs.readFile(fileArg(ctx, rest[0]))
    const arr = content.split('\n')
    if (arr[arr.length - 1] === '') arr.pop()
    return { lines: arr.slice(-n).map((t) => L(t)) }
  },
})

cmd({
  name: 'grep',
  usage: 'grep [-i|-n|-c] <pattern> <file...>',
  desc: 'regex search inside files',
  group: 'filesystem',
  run(args, ctx) {
    const { flags, rest } = parseFlags(args, ['i', 'n', 'c'])
    if (rest.length < 1) throw new FsError('usage: grep [-i|-n|-c] <pattern> <file...>')
    const pattern = rest[0]
    const files = rest.slice(1)
    if (!files.length) throw new FsError('missing file operand')
    const re = new RegExp(pattern, flags.has('i') ? 'iu' : 'u')
    const lines: OutLine[] = []
    let total = 0
    for (const f of files) {
      const abs = fileArg(ctx, f)
      const content = ctx.fs.readFile(abs)
      const src = content.split('\n')
      if (src[src.length - 1] === '') src.pop()
      let count = 0
      src.forEach((line, idx) => {
        const m = re.test(line)
        if (!m) return
        count++
        if (flags.has('c')) return
        const prefix = files.length > 1 ? `${baseName(abs)}:` : ''
        const lnum = flags.has('n') ? `${idx + 1}:` : ''
        lines.push(L(`${prefix}${lnum}${line}`))
      })
      total += count
      if (flags.has('c')) lines.push(L(files.length > 1 ? `${baseName(abs)}:${count}` : String(count)))
    }
    if (!flags.has('c') && total === 0) return { lines: [L('no matches', 'dim')] }
    return { lines }
  },
})

cmd({
  name: 'sort',
  usage: 'sort [-r] <file>',
  desc: 'sort lines of a file',
  group: 'filesystem',
  run(args, ctx) {
    const { flags, rest } = parseFlags(args, ['r'])
    if (!rest.length) throw new FsError('missing file operand')
    const content = ctx.fs.readFile(fileArg(ctx, rest[0]))
    const arr = content.split('\n')
    if (arr[arr.length - 1] === '') arr.pop()
    arr.sort((a, b) => a.localeCompare(b))
    if (flags.has('r')) arr.reverse()
    return { lines: arr.map((t) => L(t)) }
  },
})

cmd({
  name: 'uniq',
  usage: 'uniq [-c] <file>',
  desc: 'collapse repeated adjacent lines',
  group: 'filesystem',
  run(args, ctx) {
    const { flags, rest } = parseFlags(args, ['c'])
    if (!rest.length) throw new FsError('missing file operand')
    const content = ctx.fs.readFile(fileArg(ctx, rest[0]))
    const arr = content.split('\n')
    if (arr[arr.length - 1] === '') arr.pop()
    const lines: OutLine[] = []
    let prev: string | null = null
    let n = 0
    const flush = () => {
      if (prev !== null) lines.push(L(flags.has('c') ? `${String(n).padStart(6)} ${prev}` : prev))
    }
    for (const line of arr) {
      if (line === prev) n++
      else {
        flush()
        prev = line
        n = 1
      }
    }
    flush()
    return { lines }
  },
})

cmd({
  name: 'stat',
  usage: 'stat <path>',
  desc: 'show node metadata',
  group: 'filesystem',
  run(args, ctx) {
    if (!args.length) throw new FsError('missing operand')
    const abs = ctx.fs.resolve(args[0], ctx.cwd)
    const node = ctx.fs.get(abs)
    if (!node) throw new FsError(`${args[0]}: no such file or directory`)
    const size = node.kind === 'dir' ? Object.keys(node.children ?? {}).length : (node.content ?? '').length
    return {
      lines: [
        L(`  file: ${abs}`, 'head'),
        L(`  kind: ${node.kind}`),
        L(`  size: ${size} ${node.kind === 'dir' ? 'entries' : 'bytes'}`),
        L(` mtime: ${new Date(node.mtime).toISOString()}`),
      ],
    }
  },
})

cmd({
  name: 'df',
  usage: 'df',
  desc: 'virtual disk usage of the session filesystem',
  group: 'filesystem',
  run(_args, ctx) {
    const u = ctx.fs.usage()
    const budget = 5_000_000
    const pct = Math.min(100, (u.bytes / budget) * 100).toFixed(1)
    return {
      lines: [
        L('filesystem      entries     bytes     budget   use%', 'head'),
        L(
          `quanta-vfs      ${String(u.files + u.dirs).padStart(7)}  ${String(u.bytes).padStart(9)}  ${String(budget).padStart(9)}  ${pct.padStart(5)}%`
        ),
        L(`${u.files} files, ${u.dirs - 1} directories`, 'dim'),
      ],
    }
  },
})

/* ----- session group ----- */

cmd({
  name: 'date',
  usage: 'date',
  desc: 'current date/time (ISO + local)',
  group: 'session',
  run(_args, ctx) {
    const d = new Date()
    return { lines: [L(d.toISOString()), L(d.toString(), 'dim')] }
  },
})

cmd({
  name: 'whoami',
  usage: 'whoami',
  desc: 'current session user',
  group: 'session',
  run(_args, ctx) {
    return { lines: [L(ctx.env.USER ?? 'quanta')] }
  },
})

cmd({
  name: 'uname',
  usage: 'uname [-a]',
  desc: 'kernel-ish identity of the host runtime',
  group: 'session',
  run(args, ctx) {
    const { flags } = parseFlags(args, ['a'])
    if (flags.has('a')) {
      return {
        lines: [
          L(`Quanta ${ctx.sys.platform} ${QUANTA_VERSION} (${ctx.sys.runtime}) #1 SMP ${new Date(ctx.bootAt).toDateString()} quanta`),
        ],
      }
    }
    return { lines: [L('Quanta')] }
  },
})

cmd({
  name: 'neofetch',
  usage: 'neofetch',
  desc: 'REAL host info: cores, memory, screen, tz, storage',
  group: 'session',
  run(_args, ctx) {
    const s = ctx.sys
    const u = ctx.fs.usage()
    const up = fmtElapsed(Date.now() - ctx.bootAt)
    const rows: Array<[string, string]> = [
      ['OS', `Quanta ${QUANTA_VERSION} (${s.runtime})`],
      ['Host', s.platform],
      ['Kernel', s.ua.length > 60 ? s.ua.slice(0, 60) + '…' : s.ua],
      ['Uptime', up],
      ['Cores', String(s.cores)],
      ['Memory', s.deviceMemory ? `${s.deviceMemory} GB (approx)` : 'n/a'],
      ['Display', `${s.screen} @ ${s.dpr}x`],
      ['Locale', s.lang],
      ['Timezone', s.tz],
      ['Network', s.online ? 'online' : 'offline'],
      ['Storage', s.storageQuota ? `${(s.storageUsage! / 1048576).toFixed(1)} / ${(s.storageQuota / 1048576).toFixed(0)} MB` : 'n/a'],
      ['VFS', `${u.files} files, ${u.bytes} bytes`],
      ['Shell', `quanta-sh ${QUANTA_VERSION}`],
      ['Theme', ctx.theme],
    ]
    const logo = [
      '  ██████ ',
      ' ██    ██',
      ' ██    ██',
      '  ██████ ',
      '         ',
    ]
    const lines: OutLine[] = [L('quanta@browser', 'accent'), L('──────────────', 'dim')]
    rows.forEach(([k, v], i) => {
      const tag = i < logo.length ? logo[i] : '         '
      lines.push(L(`${tag} ${k.padEnd(9)} ${v}`))
    })
    return { lines }
  },
})

cmd({
  name: 'env',
  usage: 'env',
  desc: 'print session environment',
  group: 'session',
  run(_args, ctx) {
    return { lines: Object.entries(ctx.env).map(([k, v]) => L(`${k}=${v}`)) }
  },
})

cmd({
  name: 'export',
  usage: 'export VAR=value',
  desc: 'set an environment variable',
  group: 'session',
  run(args, ctx) {
    const a = args[0]
    if (!a || !a.includes('=')) throw new FsError('usage: export VAR=value')
    const eq = a.indexOf('=')
    ctx.env[a.slice(0, eq)] = a.slice(eq + 1)
    return { lines: [] }
  },
})

cmd({
  name: 'unset',
  usage: 'unset VAR',
  desc: 'remove an environment variable',
  group: 'session',
  run(args, ctx) {
    if (!args[0]) throw new FsError('usage: unset VAR')
    delete ctx.env[args[0]]
    return { lines: [] }
  },
})

cmd({
  name: 'history',
  usage: 'history',
  desc: 'numbered command history',
  group: 'session',
  run(_args, ctx) {
    if (!ctx.history.length) return { lines: [L('history is empty', 'dim')] }
    return { lines: ctx.history.map((h, i) => L(`${String(i + 1).padStart(4)}  ${h}`)) }
  },
})

cmd({
  name: 'theme',
  usage: 'theme [green|amber|ice|mono]',
  desc: 'switch terminal color theme',
  group: 'session',
  run(args, _ctx) {
    const t = (args[0] ?? '').toLowerCase()
    const valid = ['green', 'amber', 'ice', 'mono']
    if (!t) return { lines: [L('themes: green · amber · ice · mono', 'dim')] }
    if (!valid.includes(t)) throw new FsError(`unknown theme '${t}' — try: ${valid.join(', ')}`)
    return { lines: [L(`theme → ${t}`, 'ok')], theme: t }
  },
})

cmd({
  name: 'motd',
  usage: 'motd',
  desc: 'message of the day',
  group: 'session',
  run(_args, ctx) {
    let msg = 'what is real cannot be demoed.'
    try {
      const node = ctx.fs.get((ctx.env.HOME ?? '/home/quanta') + '/.quanta/motd.txt')
      if (node && node.kind === 'file') msg = (node.content ?? '').trim().split('\n')[0] || msg
    } catch {
      /* fall through */
    }
    return { lines: [L(msg, 'accent')] }
  },
})

cmd({
  name: 'banner',
  usage: 'banner',
  desc: 'print the QUANTA logo',
  group: 'session',
  run() {
    const art = [
      ' ██████  ██    ██ ██    ██ ███    ██ ████████  ██████ ',
      '██    ██ ██    ██ ██    ██ ████   ██    ██    ██    ██',
      '██    ██ ██    ██ ██    ██ ██ ██  ██    ██    ██    ██',
      '██    ██  ██  ██   ██  ██  ██  ██ ██    ██     ██    ██',
      ' ██████    ██  ██    ██ ██  ██   ████    ██      ██████ ',
    ]
    return { lines: [...art.map((a) => L(a, 'accent')), L(`        ai-native terminal — v${QUANTA_VERSION}`, 'dim')] }
  },
})

cmd({
  name: 'clear',
  usage: 'clear',
  desc: 'clear the screen',
  group: 'session',
  run() {
    return { lines: [], clear: true }
  },
})

cmd({
  name: 'exit',
  usage: 'exit',
  desc: 'end the session summary',
  group: 'session',
  run(_args, ctx) {
    const mins = fmtElapsed(Date.now() - ctx.bootAt)
    return { lines: [L(`session closed — ${ctx.history.length} commands in ${mins}. reload to start fresh.`, 'warn')] }
  },
})

/* ----- tools group ----- */

cmd({
  name: 'regex',
  usage: 'regex <pattern> [text | file <path>]',
  desc: 'real regex matches: index, groups',
  group: 'tools',
  run(args, ctx) {
    if (args.length < 1) throw new FsError('usage: regex <pattern> [text | file <path>]')
    const pattern = args[0]
    let subject = args.slice(1).join(' ')
    if (args[1] === 'file') {
      if (!args[2]) throw new FsError('regex: file flag needs a path')
      subject = ctx.fs.readFile(fileArg(ctx, args[2]))
    }
    if (!pattern) throw new FsError('regex: empty pattern')
    const rows = regexMatches(pattern, 'g', subject)
    if (!rows.length) return { lines: [L('no matches', 'dim')] }
    const lines: OutLine[] = [
      L(`pattern /${pattern}/g — ${rows.length} match${rows.length === 1 ? '' : 'es'}`, 'head'),
    ]
    for (const r of rows.slice(0, 50)) {
      const groups = r.groups.length ? ` groups=[${r.groups.join(', ')}]` : ''
      lines.push(L(`@${r.index}  "${r.text}"${groups}`))
    }
    if (rows.length > 50) lines.push(L(`… ${rows.length - 50} more`, 'dim'))
    return { lines }
  },
})

cmd({
  name: 'case',
  usage: `case <${CASE_MODES.join('|')}> <text | file <path>>`,
  desc: '11 case transforms',
  group: 'tools',
  run(args, ctx) {
    const [modeRaw, ...rest] = args
    const mode = (modeRaw ?? '') as CaseMode
    if (!CASE_MODES.includes(mode)) throw new FsError(`case: unknown mode '${modeRaw}' — try: ${CASE_MODES.join(', ')}`)
    let text = rest.join(' ')
    if (rest[0] === 'file') {
      if (!rest[1]) throw new FsError('case: file flag needs a path')
      text = ctx.fs.readFile(fileArg(ctx, rest[1]))
    }
    if (!text) throw new FsError('case: nothing to transform')
    return { lines: [L(caseTransform(mode, text), 'ok')] }
  },
})

cmd({
  name: 'ascii',
  usage: 'ascii <text>',
  desc: 'codepoint table: dec/hex/bin + utf-8 bytes',
  group: 'tools',
  run(args) {
    const text = args.join(' ')
    if (!text) throw new FsError('ascii: empty input')
    const rows = asciiTable(text)
    const lines: OutLine[] = [
      L('char    dec  hex     bin        utf-8', 'head'),
      ...rows.map(
        (r) =>
          L(
            `${r.ch.padEnd(5)} ${String(r.dec).padStart(5)}  ${r.hex.padEnd(7)} ${r.bin.padEnd(10)} ${r.utf8.map((b) => b.toString(16).padStart(2, '0')).join(' ')}`
          )
      ),
    ]
    return { lines }
  },
})

cmd({
  name: 'url',
  usage: 'url <raw>',
  desc: 'parse URL parts + encode/decode',
  group: 'tools',
  run(args) {
    const raw = args.join(' ')
    if (!raw) throw new FsError('url: empty input')
    let info: ReturnType<typeof urlInfo> | null = null
    try {
      info = urlInfo(raw)
    } catch {
      // not a parseable URL — still show real encode/decode output
      let decoded = raw
      try {
        decoded = decodeURIComponent(raw)
      } catch {
        decoded = '(not decodable)'
      }
      return {
        lines: [
          L(`      raw: ${raw}  (not a parseable URL — showing encode/decode only)`, 'head'),
          L(`  encoded: ${encodeURIComponent(raw)}`, 'dim'),
          L(`  decoded: ${decoded}`, 'dim'),
        ],
      }
    }
    const lines: OutLine[] = [
      L(`      href: ${info.href}`, 'head'),
      L(`  protocol: ${info.protocol}`),
      L(`      host: ${info.host}${info.port ? ` (port ${info.port})` : ''}`),
      L(`    origin: ${info.origin}`),
      L(`  pathname: ${info.pathname}`),
      L(`    search: ${info.search || '(none)'}`),
      L(`      hash: ${info.hash || '(none)'}`),
    ]
    if (info.params.length) {
      lines.push(L('    params:', 'accent'))
      for (const [k, v] of info.params) lines.push(L(`      ${k} = ${v}`))
    }
    lines.push(L(`  encoded: ${info.encoded}`, 'dim'))
    lines.push(L(`  decoded: ${info.decoded}`, 'dim'))
    return { lines }
  },
})

cmd({
  name: 'diff',
  usage: 'diff <fileA> <fileB>',
  desc: 'line diff between two files (LCS)',
  group: 'tools',
  run(args, ctx) {
    if (args.length < 2) throw new FsError('usage: diff <fileA> <fileB>')
    const a = ctx.fs.readFile(fileArg(ctx, args[0]))
    const b = ctx.fs.readFile(fileArg(ctx, args[1]))
    const rows: DiffRow[] = diffText(a, b)
    const adds = rows.filter((r) => r.type === 'add').length
    const dels = rows.filter((r) => r.type === 'del').length
    if (adds + dels === 0) return { lines: [L('files are identical', 'ok')] }
    const lines: OutLine[] = [L(`--- ${args[0]}  +++ ${args[1]}  (+${adds} -${dels})`, 'head')]
    for (const r of rows) {
      if (r.type === 'same') lines.push(L(`   ${String(r.aLine).padStart(3)} ${r.text}`, 'dim'))
      else if (r.type === 'del') lines.push(L(` - ${String(r.aLine).padStart(3)} ${r.text}`, 'err'))
      else lines.push(L(` + ${String(r.bLine).padStart(3)} ${r.text}`, 'ok'))
    }
    return { lines }
  },
})

cmd({
  name: 'b64',
  usage: 'b64 <enc|dec> <text | file <path>>',
  desc: 'unicode-safe base64 encode/decode',
  group: 'tools',
  run(args, ctx) {
    const [op, ...rest] = args
    if (op !== 'enc' && op !== 'dec') throw new FsError('usage: b64 <enc|dec> <text | file <path>>')
    let payload = rest.join(' ')
    if (rest[0] === 'file') {
      if (!rest[1]) throw new FsError('b64: file flag needs a path')
      payload = ctx.fs.readFile(fileArg(ctx, rest[1]))
    }
    if (!payload) throw new FsError('b64: empty input')
    if (op === 'enc') return { lines: [L(b64encode(payload), 'ok')] }
    try {
      return { lines: [L(b64decode(payload), 'ok')] }
    } catch {
      throw new FsError('b64: not valid base64')
    }
  },
})

cmd({
  name: 'calc',
  usage: 'calc <expression>',
  desc: 'safe math: + - * / % ^ sqrt min max pi e',
  group: 'tools',
  run(args) {
    const expr = args.join(' ')
    if (!expr) throw new FsError('usage: calc <expression>')
    const val = calcExpression(expr)
    return { lines: [L(`= ${fmtNum(val)}`, 'ok')] }
  },
})

cmd({
  name: 'uuid',
  usage: 'uuid [count]',
  desc: 'crypto.randomUUID (up to 10)',
  group: 'tools',
  run(args) {
    const n = Math.min(10, Math.max(1, Number(args[0] ?? 1) || 1))
    const lines: OutLine[] = []
    for (let i = 0; i < n; i++) lines.push(L(crypto.randomUUID()))
    return { lines }
  },
})

cmd({
  name: 'hash',
  usage: 'hash <text>',
  desc: 'real SHA-256 (WebCrypto)',
  group: 'tools',
  async run(args) {
    const text = args.join(' ')
    if (!text) throw new FsError('hash: empty input')
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
    return { lines: [L(hex, 'ok')] }
  },
})

cmd({
  name: 'stopwatch',
  usage: 'stopwatch [start|stop|lap|reset]',
  desc: 'real elapsed-time timer with laps',
  group: 'tools',
  run(args, ctx) {
    const sub = (args[0] ?? 'status').toLowerCase()
    const sw = ctx.sw
    switch (sub) {
      case 'start':
        if (sw.running) return { lines: [L(`already running — ${fmtElapsed(swElapsed(ctx), { precise: true })}`, 'warn')] }
        sw.running = true
        sw.startedAt = Date.now()
        return { lines: [L('stopwatch started', 'ok')] }
      case 'stop': {
        if (!sw.running) return { lines: [L('stopwatch is not running', 'warn')] }
        sw.base = swElapsed(ctx)
        sw.running = false
        return { lines: [L(`stopped at ${fmtElapsed(sw.base, { precise: true })}`, 'ok')] }
      }
      case 'lap': {
        const t = swElapsed(ctx)
        if (t === 0) return { lines: [L('lap: stopwatch idle — start it first', 'warn')] }
        const last = sw.laps.length ? sw.laps[sw.laps.length - 1] : 0
        sw.laps.push(t)
        return {
          lines: [
            L(`lap ${sw.laps.length}: ${fmtElapsed(t, { precise: true })}  (+${fmtElapsed(t - last, { precise: true })})`, 'ok'),
          ],
        }
      }
      case 'reset':
        sw.running = false
        sw.base = 0
        sw.laps = []
        return { lines: [L('stopwatch reset', 'ok')] }
      default: {
        const t = swElapsed(ctx)
        const laps = sw.laps.length ? ` · ${sw.laps.length} lap(s)` : ''
        return { lines: [L(`${sw.running ? 'running' : 'stopped'} — ${fmtElapsed(t, { precise: true })}${laps}`, sw.running ? 'ok' : 'dim')] }
      }
    }
  },
})

/* ----- ai group ----- */

cmd({
  name: 'ai',
  usage: 'ai <natural-language intent>',
  desc: 'LLM turns intent into a real quanta command',
  group: 'ai',
  async run(args, ctx) {
    const prompt = args.join(' ').trim()
    if (!prompt) throw new FsError('usage: ai <natural-language intent>')
    const listing = ctx.fs
      .list(ctx.cwd)
      .map(([n, node]) => (node.kind === 'dir' ? `${n}/` : n))
      .join(' ')
    const res = await ctx.ai(prompt, { cwd: ctx.cwd, listing })
    return {
      lines: [
        L(`intent: "${prompt}"`, 'dim'),
        L(`suggest: ${res.command}`, 'ok'),
        L(`why: ${res.rationale}`, 'dim'),
        L('retype it (or press ↑) to execute — nothing runs without you.', 'accent'),
      ],
    }
  },
})

/* ------------------------------- execution ------------------------------ */

export function allCommands(): Command[] {
  return [...commands.values()]
}

export function commandNames(): string[] {
  return [...commands.keys()]
}

export async function execute(input: string, ctx: QuantaCtx): Promise<CmdResult> {
  const raw = input.trim()
  if (!raw) return { lines: [] }

  const tokens = tokenize(raw)
  if (!tokens.length) return { lines: [] }
  ctx.history.push(raw)
  if (ctx.history.length > 500) ctx.history.splice(0, ctx.history.length - 500)

  let argv: string[]
  let redirect: Redirect | null
  try {
    const parsed = splitRedirect(tokens)
    argv = parsed.argv
    redirect = parsed.redirect
  } catch (e) {
    return { lines: [L(`quanta: ${(e as Error).message}`, 'err')] }
  }
  if (!argv.length) return { lines: [L('quanta: invalid command', 'err')] }

  const name = argv[0].toLowerCase()
  const command = commands.get(name)
  if (!command) {
    const names = commandNames()
    let best: string | null = null
    let bestD = 3
    for (const n of names) {
      const d = levenshtein(name, n)
      if (d < bestD) {
        bestD = d
        best = n
      }
    }
    return {
      lines: [
        L(`quanta: command not found: ${name}`, 'err'),
        ...(best ? [L(`did you mean '${best}'?`, 'dim')] : [L("type 'help' for the full command list", 'dim')]),
      ],
    }
  }

  try {
    const res = await command.run(argv.slice(1), ctx)
    if (redirect) {
      const text = res.lines.map((l) => l.text).join('\n') + (res.lines.length ? '\n' : '')
      const abs = ctx.fs.resolve(redirect.path, ctx.cwd)
      if (redirect.append) ctx.fs.appendFile(abs, text, '/')
      else ctx.fs.writeFile(abs, text, '/')
      return { lines: [], clear: res.clear, theme: res.theme }
    }
    return res
  } catch (e) {
    const msg = e instanceof FsError ? e.message : e instanceof Error ? e.message : String(e)
    return { lines: [L(`${name}: ${msg}`, 'err')] }
  }
}

export { L as line }
export type { Command as QuantaCommand }
