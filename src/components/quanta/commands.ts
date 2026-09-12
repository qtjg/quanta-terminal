/* QUANTA command registry + dispatcher */

import { CmdCtx, CmdDef, absPath } from "./core";
import { FS, isDir } from "./fs";
import { CORE_COMMANDS, bindCmdMap, homePath } from "./cmd-core";
import { FS_COMMANDS } from "./cmd-fs";
import { TEXT_COMMANDS } from "./cmd-text";
import { SYS_COMMANDS } from "./cmd-sys";
import { FUN_COMMANDS } from "./cmd-fun";
import { SEC_COMMANDS } from "./cmd-sec";
import { DEV_COMMANDS } from "./cmd-dev";
import { GIT_COMMANDS } from "./cmd-git";

export const ALL_COMMANDS: CmdDef[] = [
  ...CORE_COMMANDS,
  ...FS_COMMANDS,
  ...TEXT_COMMANDS,
  ...SYS_COMMANDS,
  ...FUN_COMMANDS,
  ...SEC_COMMANDS,
  ...DEV_COMMANDS,
  ...GIT_COMMANDS,
];

export const CMD_MAP: Map<string, CmdDef> = new Map(ALL_COMMANDS.map((c) => [c.name, c]));
bindCmdMap(CMD_MAP);

export const COMMAND_NAMES = ALL_COMMANDS.map((c) => c.name).sort();

export const SLASH_HINTS = ALL_COMMANDS
  .map((c) => `/${c.name} — ${c.desc}`)
  .sort();

const HIDDEN = new Set(["__HELP_CARD__"]);

export function helpCard(): string[] {
  const cats: Array<[string, string]> = [
    ["core", "shell basics"],
    ["fs", "virtual filesystem"],
    ["text", "text & data"],
    ["sys", "system dashboard"],
    ["net", "network (real fetch)"],
    ["ai", "AI engine"],
    ["sec", "security toolkit (hacker mode)"],
    ["dev", "developer tools (encode, hash, convert, git)"],
    ["fun", "fun & tools"],
  ];
  const out = [
    "QUANTA COMMAND INDEX",
    "────────────────────",
  ];
  for (const [cat, label] of cats) {
    const cmds = ALL_COMMANDS.filter((c) => c.cat === cat && !HIDDEN.has(c.name));
    out.push("");
    out.push(` ${cat.toUpperCase()} — ${label}`);
    const perRow = 3;
    for (let i = 0; i < cmds.length; i += perRow) {
      const names = cmds.slice(i, i + perRow).map((c) => c.name.padEnd(12));
      out.push("   " + names.join(""));
    }
  }
  out.push("");
  out.push(" details: man <cmd>   ·  pipe: cmd | cmd   ·  redirect: cmd > file  ·  tab: autocomplete");
  out.push(` ${ALL_COMMANDS.length} commands loaded. everything here actually executes.`);
  return out;
}

/* ---------- dispatcher ---------- */

export interface RunOutcome {
  lines: string[];
  cwd: string;
  clear: boolean;
  exit: boolean;
}

export async function runCommand(input: string, ctx: CmdCtx): Promise<RunOutcome> {
  const trimmed = input.trim();
  if (!trimmed) return { lines: [], cwd: ctx.cwd, clear: false, exit: false };

  // alias expansion (single hop, no recursion loops)
  const first = trimmed.split(/\s+/)[0];
  let effective = trimmed;
  if (ctx.aliases[first]) effective = ctx.aliases[first] + trimmed.slice(first.length);

  // ---- pipes: stage1 | stage2 | ... (quote-aware split, max 6 stages) ----
  const stages = splitPipe(effective);
  if (stages === null) {
    return { lines: ["quanta: syntax error near '|'"], cwd: ctx.cwd, clear: false, exit: false };
  }
  if (stages.length > 1) {
    const prevStdin = ctx.stdin;
    let carry: string[] = [];
    for (let i = 0; i < stages.length; i++) {
      const isLast = i === stages.length - 1;
      ctx.stdin = i === 0 ? prevStdin : carry.join("\n") + (carry.length ? "\n" : "");
      const out = await execOne(stages[i], ctx, isLast);
      carry = out.lines;
      if (!isLast && !carry.length) {
        // empty upstream: next stage sees empty stdin (like real shells)
        carry = [];
      }
      if (!isLast && (out.clear || out.exit)) {
        // clear/exit only honored in the final stage
        ctx.clearRequested = false;
        ctx.exitRequested = false;
      }
      if (carry.length > 400) carry = carry.slice(0, 400); // stdin cap
    }
    ctx.stdin = prevStdin;
    return { lines: carry, cwd: ctx.cwd, clear: false, exit: false };
  }

  const out = await execOne(effective, ctx, true);
  return { lines: out.lines, cwd: ctx.cwd, clear: out.clear, exit: out.exit };
}

/** quote-aware pipe split; null on empty stage */
export function splitPipe(input: string): string[] | null {
  const stages: string[] = [];
  let cur = "";
  let q: string | null = null;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (q) {
      if (ch === q) q = null;
      cur += ch;
    } else if (ch === '"' || ch === "'") {
      q = ch;
      cur += ch;
    } else if (ch === "|") {
      if (!cur.trim()) return null;
      stages.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (!cur.trim()) return null;
  stages.push(cur.trim());
  return stages;
}

/** run ONE pipeline stage (alias+redirect+dispatch); redirect applies on final stage only */
async function execOne(effective: string, ctx: CmdCtx, allowClearExit: boolean): Promise<RunOutcome> {
  // redirect: cmd > file  /  cmd >> file
  let target: { file: string; append: boolean } | null = null;
  const first = effective.split(/\s+/)[0];
  const redir = effective.match(/\s(>>?)\s*([^\s>]+)\s*$/);
  if (redir && first !== "echo-raw") {
    target = { file: redir[2], append: redir[1] === ">>" };
    effective = effective.slice(0, redir.index).trim();
  }

  const parts = effective.split(/\s+/);
  const name = parts[0].replace(/^\//, "");
  const restRaw = effective.slice(parts[0].length).trim();
  const expandedArgs = splitForCtx(restRaw);

  const prevArgs = ctx.args;
  const prevRaw = ctx.raw;
  ctx.args = expandedArgs;
  ctx.raw = restRaw;
  ctx.clearRequested = false;
  ctx.exitRequested = false;

  let lines: string[];
  try {
    if (name === "cd") {
      lines = await doCd(ctx, expandedArgs);
    } else {
      const cmd = CMD_MAP.get(name);
      if (!cmd) {
        lines = [
          `quanta: command not found: ${name}`,
          `nearest: ${suggest(name) ?? "—"}`,
        ];
      } else {
        lines = await cmd.run(ctx);
      }
    }
  } catch (e) {
    lines = [`quanta: internal error in '${name}': ${e instanceof Error ? e.message : String(e)}`];
  }

  ctx.args = prevArgs;
  ctx.raw = prevRaw;

  if (target && !ctx.clearRequested) {
    const p = absPath(ctx, target.file);
    const written = ctx.fs.writeFile(p, lines.join("\n") + (lines.length ? "\n" : ""), target.append);
    lines = written
      ? [`→ ${target.append ? "appended" : "wrote"} ${lines.length} line(s) to ${target.file}`]
      : [`quanta: cannot write to '${target.file}'`];
  }

  return {
    lines,
    cwd: ctx.cwd,
    clear: allowClearExit && ctx.clearRequested,
    exit: allowClearExit && ctx.exitRequested,
  };
}

function splitForCtx(restRaw: string): string[] {
  // quote-aware args (imported lazily to avoid cycle at module init)
  const out: string[] = [];
  let cur = "", q: string | null = null, has = false;
  for (const c of restRaw) {
    if (q) { if (c === q) q = null; else cur += c; }
    else if (c === '"' || c === "'") { q = c; has = true; }
    else if (c === " " || c === "\t") { if (cur || has) { out.push(cur); cur = ""; has = false; } }
    else cur += c;
  }
  if (cur || has) out.push(cur);
  return out;
}

async function doCd(ctx: CmdCtx, args: string[]): Promise<string[]> {
  const target = args[0] ?? homePath();
  const p = ctx.fs.resolve(ctx.cwd, target);
  const node = ctx.fs.get(p);
  if (!node) return [`cd: ${target}: no such file or directory`];
  if (!isDir(node)) return [`cd: ${target}: not a directory`];
  ctx.cwd = p;
  return [];
}

export function suggest(input: string): string | null {
  let best: string | null = null, bestD = Infinity;
  for (const name of COMMAND_NAMES) {
    const d = levenshtein(input, name);
    if (d < bestD) { bestD = d; best = name; }
  }
  return bestD <= Math.max(2, Math.floor(input.length / 3)) ? best : null;
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return dp[m][n];
}

export function completions(partial: string, ctx: CmdCtx): string[] {
  if (partial.includes(" ")) {
    // file-name completion
    const [head, tail] = [partial.slice(0, partial.lastIndexOf(" ")), partial.slice(partial.lastIndexOf(" ") + 1)];
    const base = tail.split("/").slice(0, -1).join("/");
    const frag = tail.split("/").pop() ?? "";
    const dirPath = ctx.fs.resolve(ctx.cwd, base || ".");
    const items = ctx.fs.list(dirPath).filter((n) => n.name.startsWith(frag));
    return items.map((n) => `${head} ${base ? base + "/" : ""}${n.name}${n.type === "dir" ? "/" : ""}`);
  }
  return COMMAND_NAMES.filter((c) => c.startsWith(partial));
}

export function defaultCtx(fs: FS, apiBase = ""): CmdCtx {
  return {
    fs,
    cwd: homePath(),
    user: "mayank",
    host: "quanta",
    env: { SHELL: "/bin/quanta", USER: "mayank", TERM: "quanta-256color" },
    aliases: {},
    history: [],
    args: [],
    raw: "",
    sessionStart: Date.now(),
    now: () => new Date(),
    sw: { running: false, startedAt: 0, accumulated: 0, laps: [] },
    processes: [
      { pid: 1001, name: "quanta-kernel", cpu: 2.1, mem: 148, state: "S" },
      { pid: 1038, name: "ai-engine", cpu: 11.4, mem: 512, state: "S" },
      { pid: 1075, name: "vfs-daemon", cpu: 0.7, mem: 64, state: "S" },
      { pid: 1112, name: "event-bus", cpu: 1.2, mem: 96, state: "S" },
      { pid: 1149, name: "provider-gw", cpu: 3.8, mem: 208, state: "S" },
    ],
    apiBase,
    theme: "carbon",
    setTheme: () => {},
    model: "",
    setModel: () => {},
    aiHistory: [],
    aiStats: { calls: 0, ok: 0, fail: 0, totalMs: 0 },
    omni: { enabled: false, routed: 0, lastRoute: "", lastClass: "" },
    clearRequested: false,
    exitRequested: false,
    bootInfo: { platform: "web", ua: "unknown", cores: 4, screen: "?", lang: "en", tz: "UTC", memGB: null },
  };
}
