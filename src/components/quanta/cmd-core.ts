/* QUANTA core commands: help clear echo date whoami hostname uname uptime
   history alias unalias env export which man sudo exit theme */

import { CmdCtx, CmdDef, err, helpFor, fmtUptime } from "./core";
import { HOME_PATH } from "./fs";
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
];

/* filled by commands.ts after registry merge — avoids circular import */
export let CMD_MAP_REF: Map<string, CmdDef> = new Map();
export function bindCmdMap(m: Map<string, CmdDef>) { CMD_MAP_REF = m; }

export function homePath() { return HOME_PATH; }
