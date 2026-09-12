"use client";

/* QUANTA git graph — visual commit graph panel for the sandbox VCS (./vcs.ts).
   Zero dependencies: SVG lanes per branch, edges parent→child, theme-aware.
   Esc or backdrop closes. */

import { useEffect, useMemo } from "react";
import { Theme } from "./themes";
import { branchCommits, relTime, Vcs } from "./vcs";

const ROW_H = 34;
const TOP = 46;
const LANE_X0 = 42;
const LANE_GAP = 44;

export default function GitGraphPanel({ vcs, onClose, theme }: {
  vcs: Vcs;
  onClose: () => void;
  theme: Theme;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /* lanes: one per branch that owns commits, ordered by first commit appearance */
  const model = useMemo(() => {
    const byId = new Map(vcs.commits.map((c) => [c.id, c]));
    const laneOf = new Map<string, number>();
    for (const c of vcs.commits) {
      if (!laneOf.has(c.branch)) laneOf.set(c.branch, laneOf.size);
    }
    const lanes = laneOf.size;
    const laneColors = [theme.accent, theme.ok, theme.warn, "#B388FF", "#80D8FF"];
    const colorOf = (branch: string) => laneColors[(laneOf.get(branch) ?? 0) % laneColors.length];

    /* newest at the top */
    const sorted = [...vcs.commits].sort((a, b) => b.ts - a.ts);
    const yOf = new Map<string, number>();
    sorted.forEach((c, i) => yOf.set(c.id, TOP + i * ROW_H + ROW_H / 2));

    const tips = new Set(Object.values(vcs.branches).filter(Boolean));
    const now = Date.now();

    const nodes = sorted.map((c) => ({
      c,
      x: LANE_X0 + (laneOf.get(c.branch) ?? 0) * LANE_GAP,
      y: yOf.get(c.id) ?? 0,
      isTip: tips.has(c.id),
    }));

    const edges: Array<{ x1: number; y1: number; x2: number; y2: number; color: string }> = [];
    for (const n of nodes) {
      if (!n.c.parent) continue;
      const p = byId.get(n.c.parent);
      if (!p) continue;
      edges.push({
        x1: n.x, y1: n.y,
        x2: LANE_X0 + (laneOf.get(p.branch) ?? 0) * LANE_GAP, y2: yOf.get(p.id) ?? 0,
        color: colorOf(n.c.branch),
      });
    }

    /* branch labels pinned next to their tip commit */
    const labels = Object.entries(vcs.branches)
      .filter(([, id]) => id && byId.has(id))
      .map(([branch, id]) => ({ branch, id, color: colorOf(branch) }));

    return { lanes, nodes, edges, labels, colorOf, now, height: TOP + sorted.length * ROW_H + 20 };
  }, [vcs, theme]);

  const width = Math.max(560, LANE_X0 + model.lanes * LANE_GAP + 320);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center px-3 py-10 sm:px-8"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={onClose}
      role="dialog"
      aria-label="git commit graph"
    >
      <div
        className="flex h-full w-full max-w-3xl flex-col overflow-hidden rounded-lg shadow-2xl"
        style={{ background: theme.bg, border: `1px solid ${theme.sel}`, color: theme.text }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2 text-[12px]" style={{ background: theme.panel, borderBottom: `1px solid ${theme.sel}` }}>
          <div className="flex items-center gap-2">
            <span style={{ color: theme.accent, fontWeight: 700 }}>git graph</span>
            <span style={{ color: theme.dim }}>{vcs.commits.length} commit{vcs.commits.length === 1 ? "" : "s"} · {Object.keys(vcs.branches).length} branch{Object.keys(vcs.branches).length === 1 ? "" : "es"} · head: {vcs.head}</span>
          </div>
          <button onClick={onClose} className="rounded px-2 py-0.5 text-[11px]" style={{ border: `1px solid ${theme.sel}`, color: theme.dim }} aria-label="close git graph">esc ✕</button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          <svg width={width} height={model.height} role="img" aria-label="commit graph">
            {/* edges first (under the dots) */}
            {model.edges.map((e, i) => (
              <line key={i} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke={e.color} strokeWidth={2} opacity={0.55} />
            ))}
            {/* commit dots + labels */}
            {model.nodes.map((n) => (
              <g key={n.c.id}>
                {n.isTip && <circle cx={n.x} cy={n.y} r={9} fill="none" stroke={theme.text} strokeWidth={1} opacity={0.7} />}
                <circle cx={n.x} cy={n.y} r={5.5} fill={model.colorOf(n.c.branch)} />
                <text x={n.x + 18} y={n.y + 4} fontSize={12.5} fill={theme.text}>
                  {n.c.msg.length > 46 ? n.c.msg.slice(0, 46) + "…" : n.c.msg}
                </text>
                <text x={n.x + 18} y={n.y + 4} fontSize={11} fill={theme.dim} dx={Math.min(n.c.msg.length, 46) * 6.6 + 12}>
                  {n.c.id} · {n.c.files}f · {relTime(n.c.ts, model.now)}
                </text>
              </g>
            ))}
            {/* branch labels at the far left rail */}
            {model.labels.map((l, i) => {
              const tipNode = model.nodes.find((n) => n.c.id === l.id);
              return (
                <text key={l.branch} x={4} y={(tipNode?.y ?? TOP) + 4} fontSize={11} fill={l.color} fontWeight={700}>
                  {l.branch === vcs.head ? `● ${l.branch}` : l.branch}
                  {i === 0 ? "" : ""}
                </text>
              );
            })}
            {model.nodes.length === 0 && (
              <text x={16} y={TOP + 8} fontSize={13} fill={theme.dim}>
                no commits yet — git init + git commit -m "first"
              </text>
            )}
          </svg>
        </div>

        <div className="flex items-center justify-between px-4 py-1.5 text-[10px]" style={{ background: theme.panel, color: theme.dim, borderTop: `1px solid ${theme.sel}` }}>
          <span>esc close · ring = branch tip · ● = head</span>
          <span>sandbox snapshot model — try: git branch dev · git checkout dev · git commit -m "work"</span>
        </div>
      </div>
    </div>
  );
}
