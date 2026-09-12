/* QUANTA core — command types, context, shared helpers */

import { FS } from "./fs";
import type { Vcs } from "./vcs";

export interface ProcessInfo {
  pid: number;
  name: string;
  cpu: number;
  mem: number;
  state: "R" | "S" | "D";
}

export interface SwState {
  running: boolean;
  startedAt: number;   // epoch ms when started (valid if running)
  accumulated: number; // ms accumulated before last stop
  laps: number[];      // lap times (ms each)
}

export interface CmdCtx {
  fs: FS;
  cwd: string;
  user: string;
  host: string;
  env: Record<string, string>;
  aliases: Record<string, string>;
  history: string[];
  args: string[];
  raw: string;
  /* piped stdin: previous stage's stdout (set by the dispatcher between pipe stages) */
  stdin?: string;
  sessionStart: number;
  now: () => Date;
  sw: SwState;
  processes: ProcessInfo[];
  apiBase: string;             // "" for same-origin
  exec?: (cmd: string) => Promise<string[]>;   // used by `q` (AI intent -> command)
  theme: string;
  setTheme: (t: string) => void;
  /* multi-provider AI engine — selected via `model use <provider/model>` */
  model: string;                 // "provider/model" or "" for builtin default
  setModel: (m: string) => void;
  aiHistory: Array<{ role: "user" | "assistant"; content: string }>;  // ai -c continuation
  /* session AI telemetry — shown by `ai stats` */
  aiStats: { calls: number; ok: number; fail: number; totalMs: number };
  /* OmniRoute — smart per-task routing across free providers (`omniroute on|off`) */
  omni: { enabled: boolean; routed: number; lastRoute: string; lastClass: string };
  clearRequested: boolean;     // set by clear cmd; UI consumes
  exitRequested: boolean;
  bootInfo: { platform: string; ua: string; cores: number; screen: string; lang: string; tz: string; memGB: number | null };
  /* panel surfaces (optional — set by terminal.tsx): commands may open visual panels */
  openPanel?: (p: PanelRequest) => void;
  /* persistence hook (optional — set by terminal.tsx): sandbox stores save through it */
  persist?: () => void;
  /* sandbox version-control state (./vcs.ts) — `git` commands read/write it */
  vcs?: Vcs | null;
}

/* request to open a visual panel surface (rendered by terminal.tsx) */
export type PanelRequest =
  | { type: "diff"; aName: string; bName: string; rows: Array<{ op: "=" | "-" | "+"; line: string }>; stat: string }
  | { type: "gitgraph"; vcs: Vcs };

export interface CmdDef {
  name: string;
  cat: "core" | "fs" | "text" | "sys" | "net" | "fun" | "ai" | "sec" | "dev";
  desc: string;
  usage?: string;
  run: (ctx: CmdCtx) => string[] | Promise<string[]>;
}

/* ---------- shared helpers ---------- */

export function ok(lines: string[]): string[] { return lines; }

/** split piped stdin into clean lines (no phantom trailing empty) */
export function stdinLines(ctx: CmdCtx): string[] {
  if (ctx.stdin == null) return [];
  const lines = ctx.stdin.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function hasStdin(ctx: CmdCtx): boolean {
  return typeof ctx.stdin === "string";
}

export function err(msg: string): string[] {
  return [`quanta: ${msg}`, `try 'help' for the command index`];
}

export function helpFor(name: string, cmds: Map<string, CmdDef>): string[] {
  const c = cmds.get(name);
  if (!c) return [`quanta: no manual entry for '${name}'`];
  return [
    `${name.toUpperCase()} — ${c.desc}`,
    c.usage ? `usage    ${c.usage}` : `usage    ${name}`,
    `category ${c.cat}`,
  ];
}

/** resolve a path arg against cwd; default home for cd */
export function absPath(ctx: CmdCtx, p?: string): string {
  return ctx.fs.resolve(ctx.cwd, p);
}

export function nArgs(ctx: CmdCtx, min: number, name: string): string[] | null {
  if (ctx.args.length < min) {
    return err(`missing operand for '${name}'`);
  }
  return null;
}

/* --- simulated-but-honest system generators (labelled "(sim)" in output) --- */

export function genProcesses(ctx: CmdCtx): ProcessInfo[] {
  const base: Array<[string, number, number]> = [
    ["quanta-kernel", 2.1, 148],
    ["ai-engine", 11.4, 512],
    ["vfs-daemon", 0.7, 64],
    ["event-bus", 1.2, 96],
    ["provider-gw", 3.8, 208],
  ];
  return base.map(([name, cpu, mem], i) => ({
    pid: 1000 + i * 37 + (ctx.sessionStart % 37),
    name,
    cpu: Math.round((cpu + Math.random() * 2) * 10) / 10,
    mem,
    state: "S" as const,
  }));
}

export function fmtUptime(from: number, now: number): string {
  const s = Math.max(0, Math.floor((now - from) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m ${s % 60}s` : m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

export function swElapsed(sw: SwState, now: number): number {
  return sw.running ? now - sw.startedAt : sw.accumulated;
}

export function padCell(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length);
}

/** split file content into lines the way real unix tools do:
 *  "" -> [], "a\n" -> ["a"], "a\nb" -> ["a","b"] */
export function contentLines(content: string): string[] {
  if (content === "") return [];
  return (content.endsWith("\n") ? content.slice(0, -1) : content).split("\n");
}
