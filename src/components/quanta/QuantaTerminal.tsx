'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { QuantaFS, seedHome } from '@/lib/quanta/fs'
import { commandNames, execute, line, QUANTA_VERSION, type CmdResult, type OutLine, type QuantaCtx, type SysInfo } from '@/lib/quanta/engine'

type ThemeName = 'green' | 'amber' | 'ice' | 'mono'

const THEMES: Record<ThemeName, { fg: string; accent: string; glow: string }> = {
  green: { fg: '#4ade80', accent: '#bbf7d0', glow: 'rgba(74,222,128,0.25)' },
  amber: { fg: '#fbbf24', accent: '#fde68a', glow: 'rgba(251,191,36,0.25)' },
  ice: { fg: '#7dd3fc', accent: '#e0f2fe', glow: 'rgba(125,211,252,0.25)' },
  mono: { fg: '#d4d4d4', accent: '#fafafa', glow: 'rgba(212,212,212,0.2)' },
}

const STORE_KEY = 'quanta.session.v1'

interface Persisted {
  fs: string
  cwd: string
  theme: ThemeName
  history: string[]
  bootAt: number
}

function colorFor(cls: OutLine['cls'], fg: string, accent: string): React.CSSProperties {
  switch (cls) {
    case 'err':
      return { color: '#ff6b6b' }
    case 'warn':
      return { color: '#fbbf24' }
    case 'ok':
      return { color: accent, fontWeight: 600 }
    case 'accent':
      return { color: accent, fontWeight: 700 }
    case 'head':
      return { color: accent, fontWeight: 700, textDecoration: 'underline', textUnderlineOffset: 4 }
    case 'dim':
      return { color: fg, opacity: 0.45 }
    default:
      return { color: fg }
  }
}

export default function QuantaTerminal() {
  const [out, setOut] = useState<OutLine[]>([])
  const [input, setInput] = useState('')
  const [cwd, setCwd] = useState('/home/quanta')
  const [theme, setTheme] = useState<ThemeName>('green')
  const [clock, setClock] = useState('--:--:--')
  const [swRunning, setSwRunning] = useState(false)
  const [swLabel, setSwLabel] = useState('')
  const [files, setFiles] = useState(0)
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)

  const fsRef = useRef<QuantaFS | null>(null)
  const ctxRef = useRef<QuantaCtx | null>(null)
  const histIdx = useRef(-1)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const pushLines = useCallback((add: OutLine[]) => {
    setOut((prev) => {
      const next = [...prev, ...add]
      return next.length > 2200 ? next.slice(next.length - 2200) : next
    })
  }, [])

  const refreshStats = useCallback(() => {
    const fs = fsRef.current
    if (!fs) return
    const u = fs.usage()
    setFiles(u.files)
  }, [])

  const persist = useCallback(() => {
    const fs = fsRef.current
    const ctx = ctxRef.current
    if (!fs || !ctx) return
    try {
      const data: Persisted = {
        fs: fs.toJSON(),
        cwd: ctx.cwd,
        theme: ctx.theme as ThemeName,
        history: ctx.history.slice(-200),
        bootAt: ctx.bootAt,
      }
      localStorage.setItem(STORE_KEY, JSON.stringify(data))
    } catch {
      /* storage full — session continues in memory */
    }
  }, [])

  const applyResult = useCallback(
    (res: CmdResult) => {
      if (res.clear) setOut([])
      else if (res.lines.length) pushLines(res.lines)
      const ctx = ctxRef.current
      if (ctx) {
        setCwd(ctx.cwd)
        if (res.theme && res.theme !== ctx.theme) {
          ctx.theme = res.theme
          setTheme(res.theme as ThemeName)
        }
        setSwRunning(ctx.sw.running)
        refreshStats()
        persist()
      }
    },
    [persist, pushLines, refreshStats]
  )

  /* ------------------------------ boot ------------------------------ */
  useEffect(() => {
    const sys: SysInfo = {
      platform: typeof navigator !== 'undefined' ? navigator.platform || 'web' : 'web',
      cores: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 1 : 1,
      deviceMemory: typeof navigator !== 'undefined' ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory : undefined,
      ua: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
      screen: typeof window !== 'undefined' ? `${window.screen.width}x${window.screen.height}` : '0x0',
      dpr: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
      lang: typeof navigator !== 'undefined' ? navigator.language : 'en',
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      online: typeof navigator !== 'undefined' ? navigator.onLine : true,
      runtime: 'browser',
    }

    let fs: QuantaFS
    let ctx: QuantaCtx
    try {
      const raw = localStorage.getItem(STORE_KEY)
      if (raw) {
        const p = JSON.parse(raw) as Persisted
        fs = QuantaFS.fromJSON(p.fs)
        ctx = {
          fs,
          cwd: p.cwd,
          env: { USER: 'quanta', HOME: '/home/quanta', SHELL: `quanta-sh ${QUANTA_VERSION}`, TERM: 'quanta-256color', LANG: sys.lang },
          history: p.history ?? [],
          theme: p.theme ?? 'green',
          bootAt: p.bootAt ?? Date.now(),
          sw: { running: false, startedAt: 0, base: 0, laps: [] },
          sys,
          ai: async (prompt, info) => {
            const r = await fetch('/api/quanta/ai', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ prompt, cwd: info.cwd, listing: info.listing }),
            })
            const j = (await r.json()) as { command?: string; rationale?: string; error?: string }
            if (!r.ok || !j.command) throw new Error(j.error ?? 'ai unavailable')
            return { command: j.command, rationale: j.rationale ?? '' }
          },
        }
        setTheme(p.theme ?? 'green')
      } else {
        fs = new QuantaFS(seedHome())
        ctx = {
          fs,
          cwd: '/home/quanta',
          env: { USER: 'quanta', HOME: '/home/quanta', SHELL: `quanta-sh ${QUANTA_VERSION}`, TERM: 'quanta-256color', LANG: sys.lang },
          history: [],
          theme: 'green',
          bootAt: Date.now(),
          sw: { running: false, startedAt: 0, base: 0, laps: [] },
          sys,
          ai: async (prompt, info) => {
            const r = await fetch('/api/quanta/ai', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ prompt, cwd: info.cwd, listing: info.listing }),
            })
            const j = (await r.json()) as { command?: string; rationale?: string; error?: string }
            if (!r.ok || !j.command) throw new Error(j.error ?? 'ai unavailable')
            return { command: j.command, rationale: j.rationale ?? '' }
          },
        }
      }
    } catch {
      fs = new QuantaFS(seedHome())
      ctx = {
        fs,
        cwd: '/home/quanta',
        env: { USER: 'quanta', HOME: '/home/quanta', SHELL: `quanta-sh ${QUANTA_VERSION}`, TERM: 'quanta-256color' },
        history: [],
        theme: 'green',
        bootAt: Date.now(),
        sw: { running: false, startedAt: 0, base: 0, laps: [] },
        sys,
        ai: async () => ({ command: 'help', rationale: 'fallback' }),
      }
    }

    // async real storage numbers for neofetch
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      navigator.storage.estimate().then((est) => {
        if (est.quota) {
          ctx.sys.storageQuota = est.quota
          ctx.sys.storageUsage = est.usage ?? 0
        }
      }).catch(() => {})
    }

    fsRef.current = fs
    ctxRef.current = ctx
    setReady(true)
    refreshStats()

    setOut([
      line(' ██████  ██    ██ ██    ██ ███    ██ ████████  ██████ ', 'accent'),
      line('██    ██ ██    ██ ██    ██ ████   ██    ██    ██    ██', 'accent'),
      line('██    ██ ██    ██ ██    ██ ██ ██  ██    ██    ██    ██', 'accent'),
      line('██    ██  ██  ██   ██  ██  ██  ██ ██    ██     ██    ██', 'accent'),
      line(' ██████    ██  ██    ██ ██  ██   ████    ██      ██████ ', 'accent'),
      line(`        ai-native terminal — v${QUANTA_VERSION} — everything here is real`, 'dim'),
      line(''),
      line(`real in-browser filesystem · ${commandNames().length} commands · type 'help'`, 'ok'),
      line("try: neofetch · tree · grep -n 'real' readme.md · calc 2^10/4 · ai \"find my notes\"", 'dim'),
      line(''),
    ])
  }, [refreshStats])

  /* --------------------------- clock / stopwatch --------------------------- */
  useEffect(() => {
    const t = setInterval(() => {
      const d = new Date()
      setClock(d.toTimeString().slice(0, 8))
      const ctx = ctxRef.current
      if (ctx && ctx.sw.running) {
        const ms = ctx.sw.base + (Date.now() - ctx.sw.startedAt)
        const s = Math.floor(ms / 1000)
        const cs = Math.floor((ms % 1000) / 10)
        setSwLabel(`${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.${String(cs).padStart(2, '0')}`)
      }
    }, 200)
    return () => clearInterval(t)
  }, [])

  /* ------------------------------ scroll ------------------------------ */
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [out, busy])

  /* --------------------------- completion ----------------------------- */
  const complete = useCallback(() => {
    const ctx = ctxRef.current
    if (!ctx) return
    const parts = input.split(/\s+/)
    const last = parts[parts.length - 1] ?? ''
    let candidates: string[] = []
    if (parts.length <= 1) {
      candidates = commandNames().filter((c) => c.startsWith(last))
    } else {
      try {
        const entries = ctx.fs.list(ctx.cwd)
        candidates = entries
          .map(([n, node]) => (node.kind === 'dir' ? `${n}/` : n))
          .filter((n) => n.startsWith(last))
      } catch {
        return
      }
    }
    if (candidates.length === 0) return
    if (candidates.length === 1) {
      parts[parts.length - 1] = candidates[0]
      setInput(parts.join(' '))
    } else {
      pushLines([line(`${ctx.cwd} ❯ ${input}`, 'dim'), ...candidates.map((c) => line(c))])
    }
  }, [input, pushLines])

  /* ------------------------------ submit ------------------------------ */
  const submit = useCallback(async () => {
    const ctx = ctxRef.current
    const raw = input
    if (!ctx) return
    if (!raw.trim()) {
      pushLines([line(`${ctx.cwd} ❯`, 'dim')])
      return
    }
    setInput('')
    histIdx.current = -1
    pushLines([line(`${ctx.cwd} ❯ ${raw}`, 'dim')])
    setBusy(true)
    try {
      const res = await execute(raw, ctx)
      applyResult(res)
    } catch (e) {
      pushLines([line(`quanta: fatal: ${e instanceof Error ? e.message : String(e)}`, 'err')])
    } finally {
      setBusy(false)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [applyResult, input, pushLines])

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const ctx = ctxRef.current
    if (e.key === 'Enter') {
      e.preventDefault()
      void submit()
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      complete()
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (!ctx || !ctx.history.length) return
      if (histIdx.current === -1) histIdx.current = ctx.history.length - 1
      else histIdx.current = Math.max(0, histIdx.current - 1)
      setInput(ctx.history[histIdx.current] ?? '')
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!ctx || histIdx.current === -1) return
      histIdx.current++
      if (histIdx.current >= ctx.history.length) {
        histIdx.current = -1
        setInput('')
      } else setInput(ctx.history[histIdx.current] ?? '')
      return
    }
    if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault()
      setOut([])
    }
  }

  const t = THEMES[theme]

  return (
    <div
      className="flex h-dvh flex-col overflow-hidden bg-[#0a0d0a] font-mono text-[13px] leading-relaxed sm:text-sm"
      style={{ color: t.fg }}
      onClick={() => inputRef.current?.focus()}
    >
      {/* title bar */}
      <div className="flex items-center gap-2 border-b border-white/10 bg-black/60 px-3 py-2 text-xs">
        <span className="h-3 w-3 rounded-full bg-[#ff5f56]" />
        <span className="h-3 w-3 rounded-full bg-[#ffbd2e]" />
        <span className="h-3 w-3 rounded-full bg-[#27c93f]" />
        <span className="ml-2 tracking-widest opacity-80">quanta — ai-native linux terminal</span>
        <span className="ml-auto opacity-60">{clock}</span>
      </div>

      {/* output */}
      <div ref={scrollRef} className="quanta-scroll flex-1 overflow-y-auto px-3 py-2 sm:px-4" aria-live="polite" aria-label="terminal output">
        {out.map((l, i) => (
          <div key={i} className="whitespace-pre-wrap break-words" style={colorFor(l.cls, t.fg, t.accent)}>
            {l.text || '\u00A0'}
          </div>
        ))}
        {busy && <div className="animate-pulse" style={{ color: t.accent }}>▊ working…</div>}
      </div>

      {/* input line */}
      <div className="flex items-center gap-2 border-t border-white/10 bg-black/40 px-3 py-2 sm:px-4">
        <span className="shrink-0 opacity-90" style={{ color: t.accent }}>
          {ready ? `${cwd} ❯` : 'booting…'}
        </span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          disabled={!ready || busy}
          autoFocus
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-label="terminal input"
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:opacity-30"
          style={{ color: t.fg, caretColor: t.accent }}
          placeholder={ready ? "type 'help' — ↑ history — tab complete" : ''}
        />
      </div>

      {/* statusbar */}
      <div className="flex items-center gap-3 border-t border-white/10 bg-black/60 px-3 py-1 text-[11px] sm:px-4" style={{ color: t.fg }}>
        <span className="opacity-70">quanta-sh {QUANTA_VERSION}</span>
        <span className="opacity-70">{files} files</span>
        <span className="opacity-70">theme: {theme}</span>
        {swRunning && (
          <span className="font-bold" style={{ color: t.accent }}>
            ⏱ {swLabel}
          </span>
        )}
        <span className="ml-auto opacity-70">{cwd}</span>
      </div>

      <style jsx global>{`
        .quanta-scroll::-webkit-scrollbar {
          width: 8px;
        }
        .quanta-scroll::-webkit-scrollbar-thumb {
          background: ${t.glow};
          border-radius: 4px;
        }
        .quanta-scroll {
          text-shadow: 0 0 8px ${t.glow};
        }
      `}</style>
    </div>
  )
}
