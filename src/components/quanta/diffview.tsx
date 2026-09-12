"use client";

/* QUANTA diff viewer — side-by-side aligned panes for `diff <fileA> <fileB>`.
   Zero dependencies, theme-aware. Esc or backdrop closes; a single scroll
   container keeps both panes perfectly synced. */

import { useEffect, useMemo, useRef } from "react";
import { Theme } from "./themes";

export interface DiffRow {
  op: "=" | "-" | "+";
  line: string;
}

export interface DiffViewData {
  aName: string;
  bName: string;
  rows: DiffRow[];
  stat: string;
}

interface AlignedRow {
  ln: number | null; leftText: string | null; leftOp: "=" | "-";
  rn: number | null; rightText: string | null; rightOp: "=" | "+";
}

/* align LCS rows into side-by-side pairs; null = empty cell */
function alignRows(rows: DiffRow[]): AlignedRow[] {
  const out: AlignedRow[] = [];
  let ln = 0, rn = 0;
  let i = 0;
  while (i < rows.length) {
    const r = rows[i];
    if (r.op === "=") {
      ln++; rn++;
      out.push({ ln, leftText: r.line, leftOp: "=", rn, rightText: r.line, rightOp: "=" });
      i++;
    } else if (r.op === "-") {
      /* collect the deletion block, then the following addition block, zip them */
      const dels: DiffRow[] = [];
      const adds: DiffRow[] = [];
      while (i < rows.length && rows[i].op === "-") { dels.push(rows[i]); i++; }
      while (i < rows.length && rows[i].op === "+") { adds.push(rows[i]); i++; }
      const max = Math.max(dels.length, adds.length);
      for (let k = 0; k < max; k++) {
        const d = dels[k], a = adds[k];
        out.push({
          ln: d ? ++ln : null, leftText: d ? d.line : null, leftOp: "-",
          rn: a ? ++rn : null, rightText: a ? a.line : null, rightOp: "+",
        });
      }
    } else {
      /* bare addition */
      rn++;
      out.push({ ln: null, leftText: null, leftOp: "=", rn, rightText: r.line, rightOp: "+" });
      i++;
    }
  }
  return out;
}

export default function DiffViewer({ data, onClose, theme }: {
  data: DiffViewData;
  onClose: () => void;
  theme: Theme;
}) {
  const aligned = useMemo(() => alignRows(data.rows), [data]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const delBg = `${theme.err}22`;
  const addBg = `${theme.ok}22`;

  const cell = (side: "l" | "r", row: AlignedRow) => {
    if (side === "l") {
      const del = row.leftOp === "-";
      return (
        <div className="flex min-w-0" style={{ background: del ? delBg : "transparent" }}>
          <span className="w-10 shrink-0 select-none pr-1 text-right" style={{ color: theme.dim, opacity: 0.7 }}>{row.ln ?? ""}</span>
          <span className="w-4 shrink-0 select-none text-center" style={{ color: del ? theme.err : theme.dim }}>{del ? "−" : ""}</span>
          <span className="min-w-0 flex-1 whitespace-pre-wrap break-words" style={{ color: del ? theme.err : theme.text }}>{row.leftText ?? ""}</span>
        </div>
      );
    }
    const add = row.rightOp === "+";
    return (
      <div className="flex min-w-0" style={{ background: add ? addBg : "transparent" }}>
        <span className="w-10 shrink-0 select-none pr-1 text-right" style={{ color: theme.dim, opacity: 0.7 }}>{row.rn ?? ""}</span>
        <span className="w-4 shrink-0 select-none text-center" style={{ color: add ? theme.ok : theme.dim }}>{add ? "+" : ""}</span>
        <span className="min-w-0 flex-1 whitespace-pre-wrap break-words" style={{ color: add ? theme.ok : theme.text }}>{row.rightText ?? ""}</span>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center px-3 py-10 sm:px-8"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={onClose}
      role="dialog"
      aria-label="diff viewer"
    >
      <div
        className="flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-lg shadow-2xl"
        style={{ background: theme.bg, border: `1px solid ${theme.sel}`, color: theme.text }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between gap-3 px-4 py-2 text-[12px]" style={{ background: theme.panel, borderBottom: `1px solid ${theme.sel}` }}>
          <div className="flex min-w-0 items-center gap-2">
            <span style={{ color: theme.accent, fontWeight: 700 }}>diff viewer</span>
            <span className="truncate" style={{ color: theme.err }}>{data.aName}</span>
            <span style={{ color: theme.dim }}>→</span>
            <span className="truncate" style={{ color: theme.ok }}>{data.bName}</span>
            <span style={{ color: theme.dim }}>{data.stat}</span>
          </div>
          <button onClick={onClose} className="shrink-0 rounded px-2 py-0.5 text-[11px]" style={{ border: `1px solid ${theme.sel}`, color: theme.dim }} aria-label="close diff viewer">esc ✕</button>
        </div>

        {/* column titles */}
        <div className="grid grid-cols-2 text-[11px]" style={{ background: theme.panel, color: theme.dim, borderBottom: `1px solid ${theme.sel}` }}>
          <div className="truncate border-r px-3 py-1" style={{ borderColor: theme.sel }}>{data.aName}</div>
          <div className="truncate px-3 py-1">{data.bName}</div>
        </div>

        {/* synced panes: one scroll container, two CSS columns */}
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto text-[12.5px] leading-[1.5]">
          <div className="grid grid-cols-2">
            <div className="border-r" style={{ borderColor: theme.sel }}>
              {aligned.map((row, i) => (
                <div key={i} className="flex" data-row={i}>{cell("l", row)}</div>
              ))}
            </div>
            <div>
              {aligned.map((row, i) => (
                <div key={i} className="flex">{cell("r", row)}</div>
              ))}
            </div>
          </div>
          {aligned.length === 0 && (
            <div className="px-4 py-3 text-[13px]" style={{ color: theme.dim }}>(files identical — nothing to show)</div>
          )}
        </div>

        <div className="flex items-center justify-between px-4 py-1.5 text-[10px]" style={{ background: theme.panel, color: theme.dim, borderTop: `1px solid ${theme.sel}` }}>
          <span>esc close · {aligned.length} row{aligned.length === 1 ? "" : "s"} aligned</span>
          <span style={{ color: theme.ok }}>+added</span>
          <span style={{ color: theme.err }}>−removed</span>
        </div>
      </div>
    </div>
  );
}
