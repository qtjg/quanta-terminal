"use client";

/* QUANTA — AI-native Linux terminal (web edition)
   Real command engine, persistent VFS, live AI backend. */

import {
  useCallback, useEffect, useRef, useState, CSSProperties,
} from "react";
import { FS } from "./fs";
import { CmdCtx, CmdDef, fmtUptime, swElapsed } from "./core";
import { runCommand, helpCard, completions, defaultCtx } from "./commands";
import { fmtElapsed } from "./text-tools";
import { THEMES, THEME_NAMES, Theme } from "./themes";
import CommandPalette from "./palette";

/* themes live in ./themes.ts — token-based palettes shared across surfaces */

/* ---------- line model ---------- */

type Kind = "in" | "out" | "err" | "sys" | "ai";
interface Line { id: number; kind: Kind; text: string }

const LS_FS = "quanta-fs";          /* was vt-quanta-fs */
const LS_THEME = "quanta-theme";    /* was vt-quanta-theme */
const LS_HIST = "quanta-history";   /* was vt-quanta-history */
const LS_MODEL = "quanta-model";    /* selected AI provider/model ("provider/model" or "") */
/* live spinner shown while slow (AI/network) commands run — module const: stable across renders */
const SPIN_PREFIX = "· ai thinking";
/* one-time migration map: legacy Visit Tokyo-prefixed keys → standalone quanta keys */
const LS_LEGACY: Array<[string, string]> = [
  ["vt-quanta-fs", LS_FS],
  ["vt-quanta-theme", LS_THEME],
  ["vt-quanta-history", LS_HIST],
];
function lsGet(key: string): string | null {
  try {
    const v = localStorage.getItem(key);
    if (v !== null) return v;
    for (const [oldKey, newKey] of LS_LEGACY) {
      if (newKey !== key) continue;
      const legacy = localStorage.getItem(oldKey);
      if (legacy !== null) {
        /* adopt legacy data under the new standalone key, drop the vt- key */
        try {
          localStorage.setItem(newKey, legacy);
          localStorage.removeItem(oldKey);
        } catch {}
        return legacy;
      }
    }
    return null;
  } catch {
    return null;
  }
}
function lsSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
    const legacy = LS_LEGACY.find(([, k]) => k === key);
    if (legacy) try { localStorage.removeItem(legacy[0]); } catch {}
  } catch {}
}
const MAX_LINES = 600;

let lineId = 0;
const mkLine = (kind: Kind, text: string): Line => ({ id: ++lineId, kind, text });

export default function QuantaTerminal() {
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState("");
  const [cwd, setCwd] = useState("/home/mayank");
  const [themeName, setThemeName] = useState("carbon");
  const [locked, setLocked] = useState(false);
  const [clock, setClock] = useState("--:--:--");
  const [uptime, setUptime] = useState("0s");
  const [swLabel, setSwLabel] = useState("");
  const [ready, setReady] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const ctxRef = useRef<CmdCtx | null>(null);
  const histIdx = useRef(-1);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bootedRef = useRef(false);

  /* ---------- boot ---------- */
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;

    let storedTheme = "carbon";
    try {
      const raw = lsGet(LS_THEME);
      /* migrate legacy theme value "tokyo" → "carbon" (same palette, new name) */
      storedTheme = raw === "tokyo" ? "carbon" : raw || "carbon";
    } catch {}
    setThemeName(storedTheme);

    const fs = (() => {
      try {
        const raw = lsGet(LS_FS);
        if (raw) return FS.load(raw);
      } catch {}
      return new FS();
    })();

    const hist: string[] = (() => {
      try { return JSON.parse(lsGet(LS_HIST) || "[]") as string[]; } catch { return []; }
    })();

    const nav = navigator as Navigator & { hardwareConcurrency?: number; deviceMemory?: number };
    const perf = performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } };
    const ctx = defaultCtx(fs);
    ctx.theme = storedTheme;
    ctx.setTheme = (t: string) => {
      setThemeName(t);
      ctx.theme = t;
      try { lsSet(LS_THEME, t); } catch {}
    };
    /* multi-provider AI engine: persisted session model ("provider/model" or "") */
    const storedModel = lsGet(LS_MODEL) || "";
    ctx.model = storedModel;
    ctx.setModel = (m: string) => {
      ctx.model = m;
      try {
        if (m) lsSet(LS_MODEL, m);
        else localStorage.removeItem(LS_MODEL);
      } catch {}
    };
    ctx.history = hist;
    /* OmniRoute: restore the smart-routing toggle (persisted by the omniroute cmd) */
    try { ctx.omni.enabled = (typeof localStorage !== "undefined" ? localStorage.getItem("quanta-omniroute") : null) === "on"; } catch {}
    ctx.bootInfo = {
      platform: "web (browser sandbox)",
      ua: navigator.userAgent,
      cores: nav.hardwareConcurrency ?? 4,
      screen: `${screen.width}x${screen.height}`,
      lang: navigator.language,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      memGB: (nav as { deviceMemory?: number }).deviceMemory ?? null,
    };
    ctxRef.current = ctx;

    const boot: Array<[Kind, string]> = [
      ["sys", "QUANTA OS 0.5.0 — ai-native linux terminal"],
      ["sys", "kernel: quanta-vfs 1.0 · shell: quanta-sh · ai-engine: live"],
      ["out", ""],
      ["out", "real commands · persistent filesystem · live AI gateway"],
      ["out", "type 'help' for the command index · 'ai <q>' to talk to the engine"],
      ["out", ""],
    ];
    let i = 0;
    const pushBoot = () => {
      if (i < boot.length) {
        const [k, t] = boot[i++];
        setLines((prev) => [...prev.slice(-MAX_LINES), mkLine(k, t)]);
        setTimeout(pushBoot, 70);
      } else {
        setReady(true);
        setTimeout(() => inputRef.current?.focus(), 30);
      }
    };
    pushBoot();
  }, []);

  /* ---------- command palette (Ctrl/Cmd+K) — works even when the input isn't focused ---------- */
  useEffect(() => {
    const onGlobalKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "p") && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onGlobalKey);
    return () => window.removeEventListener("keydown", onGlobalKey);
  }, []);

  /* ---------- persistence + clock tick (F33) ---------- */
  useEffect(() => {
    const t = setInterval(() => {
      const ctx = ctxRef.current;
      const now = new Date();
      setClock(now.toLocaleTimeString("en-GB"));
      if (ctx) {
        setUptime(fmtUptime(ctx.sessionStart, now.getTime()));
        setSwLabel(ctx.sw.running ? fmtElapsed(swElapsed(ctx.sw, now.getTime()), { live: true }) : "");
      }
      /* live elapsed on the ai-thinking spinner */
      if (spinRef.current?.shown) {
        const s = Math.max(0, Math.round((Date.now() - spinRef.current.start) / 1000));
        setLines((prev) => prev.map((l) =>
          l.kind === "sys" && l.text.startsWith(SPIN_PREFIX) ? { ...l, text: `${SPIN_PREFIX}… ${s}s` } : l));
      }
    }, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, ready]);

  const persistFs = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    try { lsSet(LS_FS, ctx.fs.dump()); } catch {}
  }, []);

  const pushLines = useCallback((newLines: Line[]) => {
    setLines((prev) => [...prev.slice(-MAX_LINES), ...newLines]);
  }, []);

  /* ---------- execution ---------- */
  const busyRef = useRef(false);           // one command at a time — no double AI spend
  const spinRef = useRef<{ start: number; shown: boolean } | null>(null);

  const removeSpinner = useCallback(() => {
    spinRef.current = null;
    setLines((prev) => prev.filter((l) => !(l.kind === "sys" && l.text.startsWith(SPIN_PREFIX))));
  }, []);

  const execute = useCallback(async (raw: string) => {
    if (busyRef.current) {
      pushLines([mkLine("sys", "quanta: previous command still running — hold on…")]);
      return;
    }
    busyRef.current = true;
    /* slow commands (live AI, network) get a live spinner after 350ms; instant cmds never flash */
    const spinTimer = setTimeout(() => {
      spinRef.current = { start: Date.now(), shown: true };
      setLines((prev) => [...prev.slice(-MAX_LINES), mkLine("sys", `${SPIN_PREFIX}…`)]);
    }, 350);
    try {
      const ctx = ctxRef.current;
      if (!ctx) return;
      const cmdText = raw.trim();
      pushLines([mkLine("in", cmdText)]);
      setInput("");
      histIdx.current = -1;

      if (cmdText) {
        if (ctx.history[ctx.history.length - 1] !== cmdText) ctx.history.push(cmdText);
        if (ctx.history.length > 200) ctx.history.shift();
        try { lsSet(LS_HIST, JSON.stringify(ctx.history.slice(-100))); } catch {}
      }

      ctx.exec = async (cmd: string) => {
        const r = await runCommand(cmd, ctx);
        return r.lines;
      };

      const outcome = await runCommand(cmdText, ctx);
      if (outcome.clear) { setLines([]); persistFs(); return; }
      if (outcome.exit) { setLocked(true); persistFs(); return; }
      if (outcome.lines.length) {
        const expanded = outcome.lines.flatMap((l) =>
          l === "__HELP_CARD__" ? helpCard() : [l]);
        pushLines(expanded.map((l) => mkLine("out", l)));
      }
      setCwd(ctx.cwd);
      persistFs();
    } finally {
      clearTimeout(spinTimer);
      if (spinRef.current?.shown) removeSpinner();
      busyRef.current = false;
    }
  }, [persistFs, pushLines, removeSpinner]);

  /* palette → terminal: run arg-less commands instantly, prefill usage for arg-taking ones */
  const runFromPalette = useCallback((def: CmdDef) => {
    setPaletteOpen(false);
    inputRef.current?.focus();
    if (def.usage && def.usage.trim() !== def.name) {
      setInput(def.usage);
    } else {
      void execute(def.name);
    }
  }, [execute]);

  /* ---------- input handling ---------- */
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    if (e.key === "Enter") {
      void execute(input);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!ctx.history.length) return;
      if (histIdx.current === -1) histIdx.current = ctx.history.length;
      histIdx.current = Math.max(0, histIdx.current - 1);
      setInput(ctx.history[histIdx.current] ?? "");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (histIdx.current === -1) return;
      histIdx.current++;
      if (histIdx.current >= ctx.history.length) { histIdx.current = -1; setInput(""); }
      else setInput(ctx.history[histIdx.current] ?? "");
    } else if (e.key === "Tab") {
      e.preventDefault();
      const opts = completions(input, ctx);
      if (opts.length === 1) setInput(opts[0] + " ");
      else if (opts.length > 1) pushLines(opts.map((o) => mkLine("sys", o)));
    } else if (e.key === "l" && e.ctrlKey) {
      e.preventDefault();
      setLines([]);
    } else if (e.key === "c" && e.ctrlKey) {
      e.preventDefault();
      pushLines([mkLine("in", input + "^C")]);
      setInput("");
    }
  };

  const theme = THEMES[themeName] ?? THEMES.carbon;

  const rootStyle: CSSProperties = {
    background: theme.bg, color: theme.text,
    fontFamily: "'Sarasa Mono SC', 'JetBrains Mono', Consolas, monospace",
  };

  const kindColor = (k: Kind): string | undefined => {
    switch (k) {
      case "err": return theme.err;
      case "sys": return theme.dim;
      case "ai": return theme.accent;
      case "in": return theme.ok;
      default: return undefined;
    }
  };

  return (
    <div
      className="flex h-[100dvh] w-full flex-col overflow-hidden"
      style={rootStyle}
      onClick={() => inputRef.current?.focus()}
    >
      {/* statusbar */}
      <div
        className="flex items-center justify-between px-3 py-1.5 text-[11px] tracking-wide"
        style={{ background: theme.panel, color: theme.dim, borderBottom: `1px solid ${theme.sel}` }}
      >
        <div className="flex min-w-0 items-center gap-3">
          <span style={{ color: theme.accent, fontWeight: 700 }}>◆ QUANTA</span>
          <span className="truncate">{cwd}</span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {swLabel && <span style={{ color: theme.warn }}>⏱ {swLabel}</span>}
          <span>up {uptime}</span>
          <span style={{ color: theme.text }}>{clock}</span>
        </div>
      </div>

      {/* screen */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 text-[13px] leading-[1.45] sm:text-[14px]">
        {lines.map((l) => (
          <div key={l.id} className="whitespace-pre-wrap break-words" style={{ color: kindColor(l.kind) }}>
            {l.kind === "in" ? (
              <>
                <span style={{ color: theme.accent }}>mayank@quanta</span>
                <span style={{ color: theme.dim }}>:</span>
                <span style={{ color: theme.ok }}>{cwd === "/home/mayank" ? "~" : cwd}</span>
                <span style={{ color: theme.dim }}>$ </span>
                <span style={{ color: theme.text }}>{l.text}</span>
              </>
            ) : l.text || "\u00A0"}
          </div>
        ))}

        {locked ? (
          <div className="mt-4" style={{ color: theme.warn }}>
            session locked — <button className="underline" onClick={() => { setLocked(false); setLines([]); inputRef.current?.focus(); }}>reboot</button>
          </div>
        ) : (
          <div className="flex items-center gap-0 whitespace-pre">
            <span style={{ color: theme.accent }}>mayank@quanta</span>
            <span style={{ color: theme.dim }}>:</span>
            <span style={{ color: theme.ok }}>{cwd === "/home/mayank" ? "~" : cwd}</span>
            <span style={{ color: theme.dim }}>$&nbsp;</span>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={!ready || locked}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent outline-none"
              style={{ color: theme.text, fontSize: "16px" }}
              aria-label="terminal input"
            />
          </div>
        )}
      </div>

        {/* command palette — fuzzy finder over the registry (Ctrl/Cmd+K) */}
        {paletteOpen && (
          <CommandPalette
            onClose={() => setPaletteOpen(false)}
            onRun={runFromPalette}
            theme={theme}
          />
        )}

      {/* footer hints */}
      <div
        className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 text-[10px]"
        style={{ background: theme.panel, color: theme.dim, borderTop: `1px solid ${theme.sel}` }}
      >
        <span>↑↓ history · TAB autocomplete · CTRL+K palette · CTRL+L clear · {THEME_NAMES.join("/")}</span>
        <span style={{ color: theme.accent }}>theme: {themeName}</span>
      </div>
    </div>
  );
}
