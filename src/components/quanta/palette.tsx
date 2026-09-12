"use client";

/* QUANTA command palette — fuzzy finder over the command registry (Ctrl/Cmd+K).
   Zero dependencies: inline subsequence scorer, theme-aware, keyboard-first. */

import { useEffect, useMemo, useRef, useState } from "react";
import { ALL_COMMANDS } from "./commands";
import { CmdDef } from "./core";
import { Theme } from "./themes";

interface Scored {
  def: CmdDef;
  score: number;
}

/* fuzzy score: subsequence match, bonuses for word starts / prefix / adjacency.
   Returns -1 when `q` is not a subsequence of `s`. Case-insensitive.
   Exported — the history search (Ctrl+R) reuses the same scorer. */
export function fuzzyScore(q: string, s: string): number {
  if (!q) return 1;
  const ql = q.toLowerCase();
  const sl = s.toLowerCase();
  let qi = 0;
  let score = 0;
  let streak = 0;
  for (let si = 0; si < sl.length && qi < ql.length; si++) {
    if (sl[si] !== ql[qi]) { streak = 0; continue; }
    qi++;
    streak++;
    score += 2 + streak;                       /* adjacency grows the reward */
    if (si === 0 || sl[si - 1] === " " || sl[si - 1] === "-" || sl[si - 1] === "_") {
      score += 6;                              /* word-start hit */
    }
  }
  if (qi < ql.length) return -1;               /* not all query chars matched */
  if (sl.startsWith(ql)) score += 10;          /* prefix match */
  return score;
}

function scoreCommand(q: string, def: CmdDef): number {
  const byName = fuzzyScore(q, def.name);
  if (byName < 0) {
    const byDesc = fuzzyScore(q, def.desc);
    if (byDesc < 0) return -1;
    return byDesc / 3;                          /* name hits rank above desc hits */
  }
  return byName + 4;
}

export default function CommandPalette({
  onClose, onRun, theme,
}: {
  onClose: () => void;
  onRun: (def: CmdDef) => void;
  theme: Theme;
}) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  /* state starts fresh on every mount (parent conditionally renders us) */
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo<Scored[]>(() => {
    const scored: Scored[] = [];
    for (const def of ALL_COMMANDS) {
      if (def.name.startsWith("__")) continue;   /* hidden internals */
      const s = scoreCommand(q.trim(), def);
      if (s >= 0) scored.push({ def, score: s });
    }
    scored.sort((a, b) => b.score - a.score || a.def.name.localeCompare(b.def.name));
    return scored.slice(0, 30);
  }, [q]);

  /* keep the selected row in view */
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${sel}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const run = (def: CmdDef) => {
    onClose();
    onRun(def);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => (results.length ? (s + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => (results.length ? (s - 1 + results.length) % results.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = results[sel];
      if (hit) run(hit.def);
    } else if ((e.key === "k" || e.key === "p") && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={onClose}
      role="dialog"
      aria-label="command palette"
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-lg shadow-2xl"
        style={{ background: theme.panel, border: `1px solid ${theme.sel}`, color: theme.text }}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={onKey}
          placeholder="search commands…"
          aria-label="search commands"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="w-full bg-transparent px-4 py-3 text-[14px] outline-none"
          style={{ color: theme.text, borderBottom: `1px solid ${theme.sel}` }}
        />
        <div ref={listRef} className="max-h-[46vh] overflow-y-auto py-1">
          {results.length === 0 ? (
            <div className="px-4 py-3 text-[13px]" style={{ color: theme.dim }}>
              no command matches “{q}”
            </div>
          ) : (
            results.map(({ def }, idx) => (
              <button
                key={def.name}
                data-idx={idx}
                onClick={() => run(def)}
                onMouseEnter={() => setSel(idx)}
                className="flex w-full items-baseline gap-2 px-4 py-1.5 text-left text-[13px]"
                style={{
                  background: idx === sel ? theme.sel : "transparent",
                  borderLeft: idx === sel ? `2px solid ${theme.accent}` : "2px solid transparent",
                }}
              >
                <span style={{ color: idx === sel ? theme.accent : theme.text, fontWeight: 600, minWidth: 96 }}>
                  {def.name}
                </span>
                <span className="min-w-0 flex-1 truncate" style={{ color: theme.dim }}>
                  {def.desc}
                </span>
                <span className="shrink-0 text-[10px] uppercase tracking-wide" style={{ color: theme.dim, opacity: 0.7 }}>
                  {def.cat}
                </span>
              </button>
            ))
          )}
        </div>
        <div
          className="flex items-center justify-between px-4 py-1.5 text-[10px]"
          style={{ color: theme.dim, borderTop: `1px solid ${theme.sel}` }}
        >
          <span>↑↓ navigate · enter run · esc close</span>
          <span>{results.length} cmd{results.length === 1 ? "" : "s"}</span>
        </div>
      </div>
    </div>
  );
}
