/* QUANTA git — sandbox version control commands over the tiny VCS sim (./vcs.ts).
   `git commit` snapshots the whole VFS; `git graph` opens the visual panel.
   Honest sim: output is labeled like the rest of quanta's sandbox surfaces. */

import { CmdCtx, CmdDef, err } from "./core";
import { makeCommit, branchCommits, newVcs, relTime, Vcs } from "./vcs";

function ensureVcs(ctx: CmdCtx): Vcs | null {
  if (!ctx.vcs || ctx.vcs.commits === undefined) return null;
  return ctx.vcs;
}

function usage(): string[] {
  return [
    "usage: git <command>",
    "",
    "  init                     start tracking the sandbox (branch: main)",
    "  commit -m \"<msg>\"        snapshot the whole VFS as one commit",
    "  log                      commit history of the current branch",
    "  branch [<name>]          list branches, or create one at the current tip",
    "  checkout [-b] <name>     switch branches (or create + switch with -b)",
    "  status                   branch, tip, snapshot summary",
    "  graph                    open the visual commit graph panel",
    "  merge                    (not supported in the sandbox yet)",
  ];
}

function countFiles(ctx: CmdCtx): number {
  try {
    return ctx.fs.countAll().files;
  } catch {
    return 0;
  }
}

function needsRepo(ctx: CmdCtx): string[] | null {
  if (!ensureVcs(ctx)) {
    return err("not a git repository — run 'git init' first");
  }
  return null;
}

export const GIT_COMMANDS: CmdDef[] = [
  {
    name: "git", cat: "dev", desc: "sandbox git: snapshot commits, branches, visual graph", usage: "git init · git commit -m \"msg\" · git log · git branch · git graph",
    run: (ctx) => {
      const sub = (ctx.args[0] || "").toLowerCase();
      const now = ctx.now().getTime();

      if (!sub) return usage();

      if (sub === "init") {
        if (ctx.vcs && ctx.vcs.commits.length) {
          return [`git: reinitializing — history cleared (${ctx.vcs.commits.length} commit(s) dropped)`];
        }
        ctx.vcs = newVcs();
        if (ctx.persist) ctx.persist();
        return ["git: initialized empty repository — snapshot model, branch: main"];
      }

      if (sub === "commit") {
        const missing = needsRepo(ctx);
        if (missing) return missing;
        const v = ensureVcs(ctx) as Vcs;
        /* accept -m <msg> / -m=<msg> / bare message fallback */
        let msg = "";
        const mi = ctx.args.indexOf("-m");
        if (mi !== -1) {
          msg = ctx.args[mi + 1] ?? "";
        } else {
          const me = ctx.args.find((a) => a.startsWith("-m="));
          if (me) msg = me.slice(3);
        }
        if (!msg) msg = ctx.args.slice(1).filter((a) => a !== "-m").join(" ").replace(/^["']|["']$/g, "");
        if (!msg) return err('git commit: message required — git commit -m "what changed"');
        const files = countFiles(ctx);
        const c = makeCommit(v, msg, files, now);
        if (ctx.persist) ctx.persist();
        return [`[${v.head} ${c.id}] ${msg}`, `       ${files} file(s) snapshotted — ${v.commits.length} commit(s) on ${v.head}`];
      }

      if (sub === "log") {
        const missing = needsRepo(ctx);
        if (missing) return missing;
        const v = ensureVcs(ctx) as Vcs;
        const list = branchCommits(v, v.head);
        if (!list.length) return ["no commits yet — 'git commit -m \"first\"'"];
        const out = list.slice(0, 30).map((c) => {
          const head = c.id === v.branches[v.head] ? ` (${v.head})` : "";
          return `${c.id}${head} ${c.msg} · ${c.files}f · ${relTime(c.ts, now)}`;
        });
        if (list.length > 30) out.push(`… ${list.length - 30} older commit(s)`);
        return out;
      }

      if (sub === "branch") {
        const missing = needsRepo(ctx);
        if (missing) return missing;
        const v = ensureVcs(ctx) as Vcs;
        const name = ctx.args[1];
        if (!name) {
          const names = Object.keys(v.branches).sort();
          if (!names.length) return ["(no branches yet — commit first, then 'git branch dev')"];
          return names.map((b) => `${b === v.head ? "* " : "  "}${b} ${v.branches[b] ?? ""}`);
        }
        if (v.branches[name]) return err(`git branch: '${name}' already exists`);
        if (!v.branches[v.head]) return err("git branch: current branch has no commits yet");
        v.branches[name] = v.branches[v.head];
        if (ctx.persist) ctx.persist();
        return [`git: created branch ${name} at ${v.branches[name]}`];
      }

      if (sub === "checkout") {
        const missing = needsRepo(ctx);
        if (missing) return missing;
        const v = ensureVcs(ctx) as Vcs;
        let name = ctx.args[1];
        let create = false;
        if (name === "-b") { create = true; name = ctx.args[2]; }
        if (!name) return err("git checkout: branch name required (git checkout [-b] <name>)");
        if (create) {
          if (v.branches[name]) return err(`git checkout: branch '${name}' already exists`);
          v.branches[name] = v.branches[v.head] ?? "";
        } else if (!v.branches[name]) {
          return err(`git checkout: no branch named '${name}' ('git checkout -b ${name}' to create)`);
        }
        v.head = name;
        if (ctx.persist) ctx.persist();
        return [`git: switched to branch ${name}${v.branches[name] ? ` (tip ${v.branches[name]})` : ""}`];
      }

      if (sub === "status") {
        const missing = needsRepo(ctx);
        if (missing) return missing;
        const v = ensureVcs(ctx) as Vcs;
        const tip = v.branches[v.head];
        const c = v.commits.find((x) => x.id === tip);
        return [
          `branch : ${v.head}`,
          `tip    : ${tip ?? "(no commits yet)"}`,
          c ? `last   : ${c.msg} · ${c.files} file(s) · ${relTime(c.ts, now)}` : "snapshot model — 'git commit -m \"msg\"' captures the whole VFS",
          `total  : ${v.commits.length} commit(s) · ${Object.keys(v.branches).length} branch(es)`,
        ];
      }

      if (sub === "graph") {
        const missing = needsRepo(ctx);
        if (missing) return missing;
        const v = ensureVcs(ctx) as Vcs;
        if (!v.commits.length) return ["no commits yet — 'git commit -m \"first\"', then 'git graph'"];
        if (ctx.openPanel) {
          ctx.openPanel({ type: "gitgraph", vcs: v });
          return [`→ commit graph opened — ${v.commits.length} commit(s), ${Object.keys(v.branches).length} branch(es) (esc to close)`];
        }
        /* text fallback (no panel surface — e.g. pipe or tests) */
        const list = branchCommits(v, v.head);
        return list.map((c) => `* ${c.id} (${c.branch}) ${c.msg} · ${c.files}f`);
      }

      if (sub === "merge") {
        return ["git merge: not supported in the sandbox (yet) — branches are independent snapshot chains"];
      }

      return err(`git: unknown sub-command '${sub}'`);
    },
  },
];
