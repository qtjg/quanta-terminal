"use client";

/* QUANTA history search — reverse-i-search over the session command history (Ctrl+R).
   Zero dependencies: reuses the palette's subsequence scorer, theme-aware, keyboard-first.
   Enter runs the selected command (bash-style), Tab/→ or click prefills the input. */

import { useEffect, useMemo, useRef, useState } from "react";
import { fuzzyScore } from "./palette";
import { Theme } from "./themes";

export default function HistorySearch({
  history, onClose, onRun, onPrefill, theme,
}: {
  history: string[];
  onClose: () => void;
  onRun: (cmd: string) => void;
  onPrefill: (cmd: string) => void;
  theme: Theme;
}) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  /* fresh state on every mount (parent conditionally renders us) */
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  /* newest-first history, fuzzy-scored against the query; empty query shows the tail */
  const results = useMemo<string[]>(() => {
    const uniq: string[] = [];
    for (let i = history.length - 1; i >= 0; i--) {
      if (!uniq.includes(history[i])) uniq.push(history[i]);
      if (uniq.length >= 200) break;
    }
    const query = q.trim();
    if (!query) return uniq.slice(0, 30);
    return uniq
      .map((cmd) => ({ cmd, s: fuzzyScore(query, cmd) }))
      .filter((r) => r.s >= 0)
      .sort((a, b) => b.s - a.s || b.cmd.length - a.cmd.length)
      .map((r) => r.cmd)
      .slice(0, 30);
  }, [history, q]);

  /* keep the selected row in view */
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${sel}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const pick = (cmd: string, run: boolean) => {
    onClose();
    if (run) onRun(cmd);
    else onPrefill(cmd);
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
      if (results[sel]) pick(results[sel], true);
    } else if (e.key === "Tab" || e.key === "ArrowRight") {
      e.preventDefault();
      if (results[sel]) pick(results[sel], false);
    } else if (e.key === "r" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onClose();
    }
  };

  const highlight = (cmd: string): string => {
    /* show the matched subsequence as-is; scorer is case-insensitive so keep it simple */
    return cmd;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[16vh]"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={onClose}
      role="dialog"
      aria-label="history search"
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-lg shadow-2xl"
        style={{ background: theme.panel, border: `1px solid ${theme.sel}`, color: theme.text }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: `1px solid ${theme.sel}` }}>
          <span style={{ color: theme.accent, fontWeight: 700 }}>reverse-i-search</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setSel(0); }}
            onKeyDown={onKey}
            placeholder="type to search your history…"
            aria-label="search history"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[14px] outline-none"
            style={{ color: theme.text }}
          />
        </div>
        <div ref={listRef} className="max-h-[44vh] overflow-y-auto py-1">
          {results.length === 0 ? (
            <div className="px-4 py-3 text-[13px]" style={{ color: theme.dim }}>
              {history.length ? `no history match for “${q}”` : "history is empty — run some commands first"}
            </div>
          ) : (
            results.map((cmd, idx) => (
              <button
                key={cmd + idx}
                data-idx={idx}
                onClick={() => pick(cmd, false)}
                onMouseEnter={() => setSel(idx)}
                className="flex w-full items-center gap-2 px-4 py-1.5 text-left text-[13px]"
                style={{
                  background: idx === sel ? theme.sel : "transparent",
                  borderLeft: idx === sel ? `2px solid ${theme.accent}` : "2px solid transparent",
                }}
              >
                <span className="shrink-0" style={{ color: theme.dim, opacity: 0.8 }}>{String(history.length - idx).padStart(3)}</span>
                <span className="min-w-0 flex-1 truncate" style={{ color: idx === sel ? theme.accent : theme.text }}>
                  {highlight(cmd)}
                </span>
              </button>
            ))
          )}
        </div>
        <div
          className="flex items-center justify-between px-4 py-1.5 text-[10px]"
          style={{ color: theme.dim, borderTop: `1px solid ${theme.sel}` }}
        >
          <span>enter run · tab prefill · ↑↓ navigate · esc close</span>
          <span>{results.length} match{results.length === 1 ? "" : "es"}</span>
        </div>
      </div>
    </div>
  );
}
