/* QUANTA core commands: help clear echo date whoami hostname uname uptime
   history alias unalias env export which man sudo exit theme */

import { CmdCtx, CmdDef, err, helpFor, fmtUptime, contentLines } from "./core";
import { HOME_PATH, isDir } from "./fs";
import { wrapText } from "./text-tools";

const THEMES = ["carbon", "matrix", "amber", "ocean", "light"] as const; /* "carbon" (was "tokyo") */

export const CORE_COMMANDS: CmdDef[] = [
  {
    name: "help", cat: "core", desc: "show the full command index",
    run: (ctx) => {
      void ctx;
      return ["__HELP_CARD__"];
    },
  },
  {
    name: "clear", cat: "core", desc: "clear the terminal screen",
    run: (ctx) => { ctx.clearRequested = true; return []; },
  },
  {
    name: "echo", cat: "core", desc: "print text (expands $VAR)", usage: "echo <text...>",
    run: (ctx) => {
      const expand = (s: string) => s.replace(/\$(\w+)/g, (_, k) => ctx.env[k] ?? "");
      return [ctx.args.map(expand).join(" ")];
    },
  },
  {
    name: "date", cat: "core", desc: "current date & time", usage: "date [-u]",
    run: (ctx) => {
      const u = ctx.args.includes("-u");
      const d = ctx.now();
      const s = u ? d.toUTCString() : d.toString();
      return [u ? `${s} (UTC)` : s];
    },
  },
  { name: "whoami", cat: "core", desc: "print current user", run: (ctx) => [ctx.user] },
  { name: "hostname", cat: "core", desc: "print machine hostname", run: (ctx) => [ctx.host] },
  {
    name: "uname", cat: "core", desc: "system information", usage: "uname [-a]",
    run: (ctx) => {
      if (ctx.args.includes("-a")) {
        return [`Quanta ${ctx.host} 0.5.0-interactive #1 SMP ${new Date(ctx.sessionStart).toDateString()} quanta-web`];
      }
      return ["Quanta"];
    },
  },
  {
    name: "uptime", cat: "core", desc: "session uptime + load",
    run: (ctx) => {
      const now = ctx.now().getTime();
      const up = fmtUptime(ctx.sessionStart, now);
      const cmds = ctx.history.length;
      return [`up ${up}, ${cmds} commands run, load: ${(0.2 + Math.random() * 0.5).toFixed(2)} (web session)`];
    },
  },
  {
    name: "history", cat: "core", desc: "show command history",
    run: (ctx) => {
      if (!ctx.history.length) return ["(no history yet)"];
      return ctx.history.slice(-50).map((h, i) => `${String(i + 1).padStart(4)}  ${h}`);
    },
  },
  {
    name: "alias", cat: "core", desc: "list or create aliases", usage: "alias [name='cmd']",
    run: (ctx) => {
      if (!ctx.args.length) {
        const entries = Object.entries(ctx.aliases);
        if (!entries.length) return ["(no aliases set)"];
        return entries.map(([k, v]) => `alias ${k}='${v}'`);
      }
      const m = ctx.raw.match(/^(\w+)=(.*)$/);
      if (!m) return err("usage: alias name='command'");
      ctx.aliases[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
      return [`alias ${m[1]} -> ${ctx.aliases[m[1]]}`];
    },
  },
  {
    name: "unalias", cat: "core", desc: "remove an alias", usage: "unalias <name>",
    run: (ctx) => {
      const name = ctx.args[0];
      if (!name || !ctx.aliases[name]) return err(`alias '${name ?? ""}' not found`);
      delete ctx.aliases[name];
      return [`removed alias ${name}`];
    },
  },
  {
    name: "env", cat: "core", desc: "print environment variables",
    run: (ctx) => {
      const entries = Object.entries(ctx.env);
      if (!entries.length) return ["(environment empty — try: export FOO=bar)"];
      return entries.map(([k, v]) => `${k}=${v}`);
    },
  },
  {
    name: "export", cat: "core", desc: "set an environment variable", usage: "export KEY=value",
    run: (ctx) => {
      const m = ctx.raw.match(/^(\w+)=(.*)$/);
      if (!m) return err("usage: export KEY=value");
      ctx.env[m[1]] = m[2];
      return [`${m[1]}=${m[2]}`];
    },
  },
  {
    name: "which", cat: "core", desc: "locate a command", usage: "which <cmd>",
    run: (ctx) => {
      const name = ctx.args[0];
      if (!name) return err("missing operand");
      if (ctx.aliases[name]) return [`${name}: aliased to '${ctx.aliases[name]}'`];
      return [`/usr/bin/${name}`];
    },
  },
  {
    name: "man", cat: "core", desc: "manual page for a command", usage: "man <cmd>",
    run: (ctx) => {
      const name = ctx.args[0];
      if (!name) return err("what manual page do you want?");
      return helpFor(name, CMD_MAP_REF);
    },
  },
  {
    name: "sudo", cat: "core", desc: "elevated run (honestly: same sandbox)",
    run: (ctx) => [
      "[sudo] password for mayank: ********",
      "quanta: this is a browser sandbox — no kernel to own, privileges unchanged",
      "(run the command without sudo: it does exactly the same here)",
    ],
  },
  {
    name: "exit", cat: "core", desc: "lock the terminal (reload to boot again)",
    run: (ctx) => { ctx.exitRequested = true; return ["logout"]; },
  },
  {
    name: "theme", cat: "core", desc: "list or switch terminal theme", usage: "theme [name]",
    run: (ctx) => {
      if (!ctx.args.length) {
        return [
          `themes: ${THEMES.join(", ")}`,
          `current: ${ctx.theme}`,
          `usage: theme <name>`,
        ];
      }
      const raw = ctx.args[0].toLowerCase();
      /* legacy alias: "tokyo" theme was renamed "carbon" (same palette) */
      const t = raw === "tokyo" ? "carbon" : raw;
      if (!THEMES.includes(t as (typeof THEMES)[number])) {
        return err(`unknown theme '${t}' — available: ${THEMES.join(", ")}`);
      }
      ctx.setTheme(t);
      return [`theme set to ${t}`];
    },
  },
  {
    name: "motd", cat: "core", desc: "message of the day",
    run: () => wrapText(
      "QUANTA 0.5.0 — AI-native terminal. Real commands, real outputs, real " +
      "filesystem (browser-persisted). Type 'help' for the index, 'ai <q>' for the engine.",
      64,
    ),
  },
  {
    name: "cd", cat: "fs", desc: "change directory", usage: "cd [path|~|..|/]",
    run: (ctx) => {
      void ctx;
      return []; // cd is handled specially by the dispatcher (needs cwd mutation)
    },
  },
  {
    name: "script", cat: "core", desc: ".qsh scripting — run real command files from the VFS", usage: "script run [-k] <file> · script list · script demo",
    run: async (ctx) => {
      const sub = ctx.args[0] ?? "";
      if (sub === "run") {
        let keepGoing = false;
        let file = ctx.args[1] ?? "";
        if (file === "-k") { keepGoing = true; file = ctx.args[2] ?? ""; }
        if (!file) return err("usage: script run [-k] <file.qsh>");
        return runScriptFile(ctx, file, keepGoing);
      }
      if (sub === "list") {
        const spots = [ctx.cwd, `${HOME_PATH}/scripts`, HOME_PATH].filter((v, i, a) => a.indexOf(v) === i);
        const found = new Map<string, string>();
        for (const dir of spots) {
          for (const n of ctx.fs.list(dir)) {
            if (n.type === "file" && n.name.endsWith(".qsh") && !found.has(n.name)) found.set(n.name, `${dir}/${n.name}`);
          }
        }
        if (!found.size) return ["(no .qsh scripts found — try 'script demo' to generate one)"];
        return [`found ${found.size} script${found.size > 1 ? "s" : ""}:`, ...[...found.entries()].map(([n, p]) => `  ${n}  →  ${p}`)];
      }
      if (sub === "demo") {
        const dir = ctx.fs.mkdirp(`${HOME_PATH}/scripts`);
        if (!dir) return err("script: cannot create ~/scripts");
        const demo = [
          "# QUANTA demo script — every line is a real command",
          "export GREETING=hello-quanta",
          "echo $GREETING from the script engine",
          "date",
          "calc 2^10/4 + sqrt(144)",
          "seq 1 5",
          "factor 987654",
        ].join("\n") + "\n";
        ctx.fs.writeFile(`${HOME_PATH}/scripts/demo.qsh`, demo);
        const out = ["wrote ~/scripts/demo.qsh (edit it: echo 'cmd' >> ~/scripts/demo.qsh)", ""];
        return [...out, ...(await runScriptFile(ctx, `${HOME_PATH}/scripts/demo.qsh`, false))];
      }
      return err("usage: script run [-k] <file> · script list · script demo");
    },
  },
];

/* ---------- script engine (v0.7) ---------- */

const SCRIPT_DEPTH = { n: 0 };
const SCRIPT_MAX_LINES = 200;

/** execute a .qsh file: one command per line, '#' comments, $VARS expand via env.
 *  stops at the first failing command (output line starting 'quanta: ') unless keepGoing. */
async function runScriptFile(ctx: CmdCtx, path: string, keepGoing: boolean): Promise<string[]> {
  const abs = ctx.fs.resolve(ctx.cwd, path);
  const node = ctx.fs.get(abs);
  if (!node) return err(`script: ${path}: no such file or directory`);
  if (isDir(node)) return err(`script: ${path}: is a directory`);
  if (SCRIPT_DEPTH.n >= 2) return err("script: nesting too deep (max 2) — recursive script?");
  const lines = contentLines(node.content).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  if (!lines.length) return err(`script: ${path}: no commands (empty or comments only)`);
  if (lines.length > SCRIPT_MAX_LINES) return err(`script: ${path}: too many commands (${lines.length}, max ${SCRIPT_MAX_LINES})`);
  if (!ctx.exec) return err("script: executor unavailable in this context");
  SCRIPT_DEPTH.n++;
  const out: string[] = [`┌─ script ${node.name} — ${lines.length} command${lines.length > 1 ? "s" : ""}`];
  const t0 = Date.now();
  let okN = 0, failN = 0;
  try {
    for (let i = 0; i < lines.length; i++) {
      const cmdline = lines[i];
      out.push(`│ [${i + 1}/${lines.length}] $ ${cmdline}`);
      let res: string[];
      try { res = await ctx.exec(cmdline); }
      catch (e) { res = [`quanta: ${e instanceof Error ? e.message : String(e)}`]; }
      out.push(...res.map((l) => `│ ${l}`));
      if (res.some((l) => l.startsWith("quanta: "))) {
        failN++;
        if (!keepGoing) {
          out.push(`└─ stopped at command ${i + 1} — ${okN} ok, ${failN} failed (script run -k <file> keeps going)`);
          return out;
        }
      } else okN++;
    }
  } finally { SCRIPT_DEPTH.n--; }
  out.push(`└─ done in ${Date.now() - t0}ms — ${okN} ok, ${failN} failed`);
  return out;
}

/* filled by commands.ts after registry merge — avoids circular import */
export let CMD_MAP_REF: Map<string, CmdDef> = new Map();
export function bindCmdMap(m: Map<string, CmdDef>) { CMD_MAP_REF = m; }

export function homePath() { return HOME_PATH; }
