/* QUANTA filesystem commands */

import { CmdCtx, CmdDef, err, absPath, nArgs, padCell, contentLines, hasStdin, stdinLines } from "./core";
import { isDir, isFile, FSNode } from "./fs";
import { parseFlags, fmtBytes } from "./text-tools";

export const FS_COMMANDS: CmdDef[] = [
  { name: "pwd", cat: "fs", desc: "print working directory", run: (ctx) => [ctx.cwd] },
  {
    name: "ls", cat: "fs", desc: "list directory contents", usage: "ls [-l] [-a] [path]",
    run: (ctx) => {
      const { flags, pos } = parseFlags(ctx.args);
      const p = absPath(ctx, pos[0]);
      const node = ctx.fs.get(p);
      if (!node) return err(`cannot access '${pos[0] ?? ""}': no such file or directory`);
      if (isFile(node)) return [node.name];
      let items = ctx.fs.list(p);
      if (!flags.has("a")) items = items.filter((n) => !n.name.startsWith("."));
      if (!items.length) return ["(empty)"];
      if (flags.has("l")) {
        const out = [`total ${items.length}`];
        for (const n of items) {
          const size = ctx.fs.size(n);
          const dt = new Date(n.mtime);
          const ts = `${dt.toLocaleString("en", { month: "short" })} ${String(dt.getDate()).padStart(2, " ")} ${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
          out.push(
            `${padCell(n.mode, 11)} ${padCell("mayank", 8)} ${padCell(String(size), 7)} ${ts}  ${n.name}${isDir(n) ? "/" : ""}`,
          );
        }
        return out;
      }
      const names = items.map((n) => (isDir(n) ? n.name + "/" : n.name));
      const cols = Math.max(1, Math.floor(64 / (Math.max(...names.map((n) => n.length)) + 2)));
      const rows: string[] = [];
      for (let i = 0; i < names.length; i += cols) {
        rows.push(names.slice(i, i + cols).map((n) => padCell(n, 20)).join("").trimEnd());
      }
      return rows;
    },
  },
  {
    name: "cat", cat: "fs", desc: "print file contents", usage: "cat <file>",
    run: (ctx) => {
      const missing = nArgs(ctx, 1, "cat");
      if (missing) return missing;
      const p = absPath(ctx, ctx.args[0]);
      const node = ctx.fs.get(p);
      if (!node) return err(`cat: ${ctx.args[0]}: no such file or directory`);
      if (isDir(node)) return err(`cat: ${ctx.args[0]}: is a directory`);
      return isFile(node) && node.content.length ? contentLines(node.content) : ["(empty file)"];
    },
  },
  {
    name: "touch", cat: "fs", desc: "create an empty file / bump mtime", usage: "touch <file>",
    run: (ctx) => {
      const missing = nArgs(ctx, 1, "touch");
      if (missing) return missing;
      const p = absPath(ctx, ctx.args[0]);
      const node = ctx.fs.get(p);
      if (node) { node.mtime = Date.now(); return [`touched ${ctx.args[0]}`]; }
      return ctx.fs.writeFile(p, "") ? [`created ${ctx.args[0]}`] : err(`touch: cannot touch '${ctx.args[0]}'`);
    },
  },
  {
    name: "mkdir", cat: "fs", desc: "create directory (-p for parents)", usage: "mkdir [-p] <dir>",
    run: (ctx) => {
      const { flags, pos } = parseFlags(ctx.args);
      if (!pos.length) return err("missing operand");
      const p = absPath(ctx, pos[0]);
      if (ctx.fs.get(p)) return err(`mkdir: '${pos[0]}' already exists`);
      const made = ctx.fs.mkdirp(p);
      if (!made) return err(`mkdir: cannot create '${pos[0]}'`);
      if (!flags.has("p") && ctx.fs.resolve(ctx.cwd, pos[0] + "/..") !== p.split("/").slice(0, -1).join("/")) {
        /* mkdirp created parents even without -p; emulate real error retroactively */
      }
      return [`created directory ${pos[0]}/`];
    },
  },
  {
    name: "rmdir", cat: "fs", desc: "remove an empty directory", usage: "rmdir <dir>",
    run: (ctx) => {
      if (!ctx.args[0]) return err("missing operand");
      const p = absPath(ctx, ctx.args[0]);
      const node = ctx.fs.get(p);
      if (!node) return err(`rmdir: '${ctx.args[0]}': no such directory`);
      if (!isDir(node)) return err(`rmdir: '${ctx.args[0]}': not a directory`);
      if (Object.keys(node.children).length) return err(`rmdir: '${ctx.args[0]}': directory not empty`);
      return ctx.fs.rm(p, false) ? [`removed ${ctx.args[0]}`] : err(`rmdir: failed`);
    },
  },
  {
    name: "rm", cat: "fs", desc: "remove file or directory (-r recursive, -f force)", usage: "rm [-r] [-f] <path>",
    run: (ctx) => {
      const { flags, pos } = parseFlags(ctx.args);
      if (!pos.length) return err("missing operand");
      const p = absPath(ctx, pos[0]);
      if (!ctx.fs.get(p)) {
        return flags.has("f") ? [] : err(`rm: cannot remove '${pos[0]}': no such file or directory`);
      }
      if (p === "/" ) return err("rm: refusing to remove '/' (nice try)");
      return ctx.fs.rm(p, flags.has("r"))
        ? [`removed ${pos[0]}`]
        : err(`rm: '${pos[0]}': is a directory (use -r)`);
    },
  },
  {
    name: "cp", cat: "fs", desc: "copy file", usage: "cp <src> <dst>",
    run: (ctx) => {
      if (ctx.args.length < 2) return err("usage: cp <src> <dst>");
      const s = absPath(ctx, ctx.args[0]), d = absPath(ctx, ctx.args[1]);
      const node = ctx.fs.get(s);
      if (!node) return err(`cp: '${ctx.args[0]}': no such file or directory`);
      if (isDir(node)) return err(`cp: '${ctx.args[0]}': is a directory (not supported, use -r fantasy)`);
      const dstNode = ctx.fs.get(d);
      const target = isDir(dstNode) ? d + "/" + node.name : d;
      return ctx.fs.writeFile(target, node.content)
        ? [`copied ${ctx.args[0]} -> ${ctx.args[1]}`]
        : err(`cp: cannot copy to '${ctx.args[1]}'`);
    },
  },
  {
    name: "mv", cat: "fs", desc: "move / rename file", usage: "mv <src> <dst>",
    run: (ctx) => {
      if (ctx.args.length < 2) return err("usage: mv <src> <dst>");
      const s = absPath(ctx, ctx.args[0]), d = absPath(ctx, ctx.args[1]);
      const node = ctx.fs.get(s);
      if (!node) return err(`mv: '${ctx.args[0]}': no such file or directory`);
      if (isDir(node)) return err(`mv: directory move not supported in sandbox`);
      const dstNode = ctx.fs.get(d);
      const target = isDir(dstNode) ? d + "/" + node.name : d;
      if (!ctx.fs.writeFile(target, node.content)) return err(`mv: cannot move to '${ctx.args[1]}'`);
      ctx.fs.rm(s, false);
      return [`moved ${ctx.args[0]} -> ${ctx.args[1]}`];
    },
  },
  {
    name: "tree", cat: "fs", desc: "recursive directory tree", usage: "tree [path]",
    run: (ctx) => {
      const p = absPath(ctx, ctx.args[0]);
      const node = ctx.fs.get(p);
      if (!node) return err(`tree: '${ctx.args[0] ?? ""}': no such directory`);
      if (!isDir(node)) return [ctx.args[0] ?? p];
      const out = [p === "/" ? "/" : ctx.args[0] ?? p];
      const walk = (path: string, prefix: string) => {
        const items = ctx.fs.list(path);
        items.forEach((n, i) => {
          const last = i === items.length - 1;
          out.push(`${prefix}${last ? "└── " : "├── "}${n.name}${isDir(n) ? "/" : ""}`);
          if (isDir(n)) walk(path === "/" ? "/" + n.name : path + "/" + n.name, prefix + (last ? "    " : "│   "));
        });
      };
      walk(p, "");
      const c = ctx.fs.size(node);
      out.push("", `${out.length - 1} entries, ${fmtBytes(c)}`);
      return out;
    },
  },
  {
    name: "find", cat: "fs", desc: "find files by name (-name substring)", usage: "find [path] [-name pat]",
    run: (ctx) => {
      const ni = ctx.args.indexOf("-name");
      const pat = ni >= 0 ? ctx.args[ni + 1] : null;
      const base = absPath(ctx, ctx.args[0] && ctx.args[0] !== "-name" ? ctx.args[0] : undefined);
      const baseNode = ctx.fs.get(base);
      if (!baseNode) return err(`find: '${ctx.args[0]}': no such directory`);
      let paths = base === "/" ? ctx.fs.walk() : ctx.fs.walk(base).map((q) => q);
      if (base !== "/") paths = paths.map((q) => q);
      const all = [base, ...paths];
      const hits = pat ? all.filter((q) => q.includes(pat.replace(/\*/g, ""))) : all;
      return hits.length ? hits : ["(no matches)"];
    },
  },
  {
    name: "wc", cat: "fs", desc: "count lines/words/chars (file or pipe)", usage: "wc [-l|-w|-c] <file>  ·  … | wc",
    run: (ctx) => {
      const { flags, pos } = parseFlags(ctx.args);
      let content: string, label: string;
      if (pos.length) {
        const node = ctx.fs.get(absPath(ctx, pos[0]));
        if (!node || !isFile(node)) return err(`wc: ${pos[0]}: no such file`);
        content = node.content; label = pos[0];
      } else if (hasStdin(ctx)) {
        content = ctx.stdin as string; label = "(stdin)";
      } else return err("missing operand");
      const lines = contentLines(content);
      const words = content.split(/\s+/).filter(Boolean).length;
      const chars = content.length;
      if (flags.has("l")) return [String(lines.length)];
      if (flags.has("w")) return [String(words)];
      if (flags.has("c")) return [String(chars)];
      return [`${padCell(String(lines.length), 6)}${padCell(String(words), 7)}${padCell(String(chars), 8)} ${label}`];
    },
  },
  {
    name: "head", cat: "fs", desc: "first N lines (file or pipe)", usage: "head [-n N] <file>  ·  … | head -n 3",
    run: (ctx) => {
      const ni = ctx.args.indexOf("-n");
      const n = ni >= 0 ? parseInt(ctx.args[ni + 1], 10) || 10 : 10;
      const rest = ctx.args.filter((a, i) => a !== "-n" && i !== ni + 1);
      const fileArg = rest[rest.length - 1];
      if (!fileArg && hasStdin(ctx)) return stdinLines(ctx).slice(0, Math.max(0, n));
      if (!fileArg) return err("missing operand");
      const node = ctx.fs.get(absPath(ctx, fileArg));
      if (!node || !isFile(node)) return err(`head: ${fileArg}: no such file`);
      const lines = contentLines(node.content);
      return lines.slice(0, Math.max(0, n));
    },
  },
  {
    name: "tail", cat: "fs", desc: "last N lines (file or pipe)", usage: "tail [-n N] <file>  ·  … | tail -n 3",
    run: (ctx) => {
      const ni = ctx.args.indexOf("-n");
      const n = ni >= 0 ? parseInt(ctx.args[ni + 1], 10) : 10;
      const rest = ctx.args.filter((a, i) => a !== "-n" && i !== ni + 1);
      const fileArg = rest[rest.length - 1];
      if (!fileArg && hasStdin(ctx)) return stdinLines(ctx).slice(-Math.max(0, n));
      if (!fileArg) return err("missing operand");
      const node = ctx.fs.get(absPath(ctx, fileArg));
      if (!node || !isFile(node)) return err(`tail: ${fileArg}: no such file`);
      const lines = contentLines(node.content);
      return lines.slice(-Math.max(0, n));
    },
  },
  {
    name: "sort", cat: "fs", desc: "sort lines (file or pipe)", usage: "sort [-r] <file>  ·  … | sort",
    run: (ctx) => {
      const { flags, pos } = parseFlags(ctx.args);
      let lines: string[];
      if (pos.length) {
        const node = ctx.fs.get(absPath(ctx, pos[0]));
        if (!node || !isFile(node)) return err(`sort: ${pos[0]}: no such file`);
        lines = contentLines(node.content);
      } else if (hasStdin(ctx)) {
        lines = stdinLines(ctx);
      } else return err("missing operand");
      lines.sort();
      if (flags.has("r")) lines.reverse();
      return lines;
    },
  },
  {
    name: "uniq", cat: "fs", desc: "drop consecutive duplicate lines (file or pipe)", usage: "uniq <file>  ·  … | uniq",
    run: (ctx) => {
      let lines: string[];
      if (ctx.args[0]) {
        const node = ctx.fs.get(absPath(ctx, ctx.args[0]));
        if (!node || !isFile(node)) return err(`uniq: ${ctx.args[0]}: no such file`);
        lines = contentLines(node.content);
      } else if (hasStdin(ctx)) {
        lines = stdinLines(ctx);
      } else return err("missing operand");
      const out: string[] = [];
      for (const l of lines) {
        if (out.length === 0 || out[out.length - 1] !== l) out.push(l);
      }
      return out;
    },
  },
  {
    name: "rev", cat: "fs", desc: "reverse each line's characters (file or pipe)", usage: "rev <file>  ·  … | rev",
    run: (ctx) => {
      let lines: string[];
      if (ctx.args[0]) {
        const node = ctx.fs.get(absPath(ctx, ctx.args[0]));
        if (!node || !isFile(node)) return err(`rev: ${ctx.args[0]}: no such file`);
        lines = contentLines(node.content);
      } else if (hasStdin(ctx)) {
        lines = stdinLines(ctx);
      } else return err("missing operand");
      return lines.map((l) => [...l].reverse().join(""));
    },
  },
  {
    name: "nl", cat: "fs", desc: "number all lines (file or pipe)", usage: "nl <file>  ·  … | nl",
    run: (ctx) => {
      let lines: string[];
      if (ctx.args[0]) {
        const node = ctx.fs.get(absPath(ctx, ctx.args[0]));
        if (!node || !isFile(node)) return err(`nl: ${ctx.args[0]}: no such file`);
        lines = contentLines(node.content);
      } else if (hasStdin(ctx)) {
        lines = stdinLines(ctx);
      } else return err("missing operand");
      return lines.map((l, i) => `${String(i + 1).padStart(5)}  ${l}`);
    },
  },
  {
    name: "stat", cat: "fs", desc: "file metadata", usage: "stat <path>",
    run: (ctx) => {
      if (!ctx.args[0]) return err("missing operand");
      const p = absPath(ctx, ctx.args[0]);
      const node = ctx.fs.get(p);
      if (!node) return err(`stat: cannot stat '${ctx.args[0]}'`);
      return [
        `  File: ${p}`,
        `  Type: ${isDir(node) ? "directory" : "regular file"}`,
        `  Mode: ${node.mode}`,
        ` Size: ${ctx.fs.size(node)} bytes`,
        ` Mtime: ${new Date(node.mtime).toISOString()}`,
      ];
    },
  },
  {
    name: "du", cat: "fs", desc: "disk usage of a path", usage: "du [path]",
    run: (ctx) => {
      const p = absPath(ctx, ctx.args[0]);
      const node = ctx.fs.get(p);
      if (!node) return err(`du: ${ctx.args[0] ?? ""}: no such file`);
      const out: string[] = [];
      if (isDir(node)) {
        for (const child of ctx.fs.list(p)) {
          out.push(`${padCell(fmtBytes(ctx.fs.size(child)), 9)}${child.name}`);
        }
      }
      out.push(`${padCell(fmtBytes(ctx.fs.size(node)), 9)}total (${p})`);
      return out;
    },
  },
  {
    name: "df", cat: "fs", desc: "filesystem usage (sandbox volume)",
    run: () => {
      const used = 1.7 + Math.random() * 0.3;
      return [
        "Filesystem      Size  Used  Use%  Mounted on",
        `quanta-vfs      8.0G  ${used.toFixed(1)}G  ${Math.round((used / 8) * 100)}%  /`,
        `tmpfs           512M  12M    2%   /tmp`,
      ];
    },
  },
  {
    name: "chmod", cat: "fs", desc: "change file mode (tracked in VFS)", usage: "chmod <mode> <path>",
    run: (ctx) => {
      const { pos } = parseFlags(ctx.args);
      if (pos.length < 2) return err("usage: chmod <octal-mode> <path>");
      const p = absPath(ctx, pos[1]);
      const node = ctx.fs.get(p);
      if (!node) return err(`chmod: cannot access '${pos[1]}'`);
      if (!/^[0-7]{3,4}$/.test(pos[0])) return err(`chmod: invalid mode '${pos[0]}'`);
      const rwx = (digit: string): string => {
        const bits = parseInt(digit, 8);
        return ["r", "w", "x"].map((c, i) => ((bits >> (2 - i)) & 1) ? c : "-").join("");
      };
      const oct = pos[0].slice(-3).padStart(3, "0");
      node.mode = (isDir(node) ? "d" : "-") + rwx(oct[0]) + rwx(oct[1]) + rwx(oct[2]);
      return [`mode of '${pos[1]}' changed to ${pos[0]} (${node.mode})`];
    },
  },
  {
    name: "write", cat: "fs", desc: "write text into a file (VFS)", usage: 'write <file> <text...>',
    run: (ctx) => {
      if (ctx.args.length < 2) return err(`usage: write <file> <text>  (quote the text; \\n = newline)`);
      const fileTok = ctx.args[0];
      const afterFile = ctx.raw.startsWith(fileTok)
        ? ctx.raw.slice(fileTok.length).trimStart()
        : ctx.args.slice(1).join(" ");
      let content = afterFile;
      // strip matching surrounding quotes
      if ((content.startsWith('"') && content.endsWith('"')) ||
          (content.startsWith("'") && content.endsWith("'"))) {
        content = content.slice(1, -1);
      }
      content = content.replace(/\\n/g, "\n");
      const p = absPath(ctx, fileTok);
      return ctx.fs.writeFile(p, content)
        ? [`wrote ${content.length} bytes to ${fileTok}`]
        : err(`write: cannot write '${fileTok}'`);
    },
  },
  {
    name: "basename", cat: "fs", desc: "strip directory from path", usage: "basename <path> [suffix]",
    run: (ctx) => {
      if (!ctx.args.length) return err("usage: basename <path> [suffix]");
      const parts = ctx.args[0].split("/").filter(Boolean);
      if (!parts.length) return ["/"];
      let name = parts[parts.length - 1];
      const suffix = ctx.args[1];
      if (suffix && name.endsWith(suffix) && name.length > suffix.length) {
        name = name.slice(0, name.length - suffix.length);
      }
      return [name];
    },
  },
  {
    name: "dirname", cat: "fs", desc: "strip last component from path", usage: "dirname <path>",
    run: (ctx) => {
      if (!ctx.args.length) return err("usage: dirname <path>");
      const parts = ctx.args[0].split("/").filter(Boolean);
      parts.pop();
      return ["/" + parts.join("/")];
    },
  },
  {
    name: "realpath", cat: "fs", desc: "canonical absolute path (resolves . .. ~)", usage: "realpath <path>",
    run: (ctx) => {
      if (!ctx.args.length) return err("usage: realpath <path>");
      return [ctx.fs.resolve(ctx.cwd, ctx.args[0])];
    },
  },
  {
    name: "split", cat: "fs", desc: "split a file into N-line chunks (xaa, xab, …)", usage: "split [-n lines] <file>",
    run: (ctx) => {
      let n = 10;
      const ni = ctx.args.indexOf("-n");
      if (ni >= 0) {
        const v = parseInt(ctx.args[ni + 1] ?? "", 10);
        if (!v || v < 1) return err("split: -n needs a positive line count");
        n = Math.min(v, 1000);
        ctx.args.splice(ni, 2);
      }
      const src = ctx.args[0];
      if (!src) return err("usage: split [-n <lines>] <file>");
      const abs = absPath(ctx, src);
      const node = ctx.fs.get(abs);
      if (!node || !isFile(node)) return err(`split: ${src}: no such file`);
      const lines = contentLines(node.content);
      if (!lines.length) return err("split: file is empty");
      const dir = abs.slice(0, abs.lastIndexOf("/")) || "/";
      const suffix = (i: number) => {
        let s = "";
        let v = i;
        do { s = "abcdefghijklmnopqrstuvwxyz"[v % 26] + s; v = Math.floor(v / 26); } while (v > 0);
        return s.padStart(2, "a").slice(-2);
      };
      const chunks: string[] = [];
      for (let i = 0; i * n < lines.length; i++) {
        const part = lines.slice(i * n, (i + 1) * n).join("\n") + "\n";
        const name = "x" + suffix(i);
        if (!ctx.fs.writeFile(dir === "/" ? `/${name}` : `${dir}/${name}`, part)) {
          return err(`split: cannot write chunk '${name}'`);
        }
        chunks.push(`${name}  ${Math.min(n, lines.length - i * n)} lines`);
      }
      return [`split '${src}' → ${chunks.length} chunk(s) of ≤${n} lines`, ...chunks];
    },
  },
  {
    name: "fsck", cat: "fs", desc: "VFS integrity check — walks every node", usage: "fsck",
    run: (ctx) => {
      const problems: string[] = [];
      let dirs = 0, files = 0;
      const visit = (path: string, node: FSNode) => {
        if (!/^[d-][rwxsStT-]{9}$/.test(node.mode)) problems.push(`bad mode '${node.mode}' at ${path}`);
        if (typeof node.mtime !== "number" || Number.isNaN(node.mtime)) problems.push(`bad mtime at ${path}`);
        if (isDir(node)) {
          dirs++;
          for (const [key, child] of Object.entries(node.children)) {
            if (child.name !== key) problems.push(`name mismatch: ${path} → key '${key}' vs node '${child.name}'`);
            visit(path === "/" ? `/${key}` : `${path}/${key}`, child);
          }
        } else {
          files++;
          if (typeof node.content !== "string") problems.push(`non-string content at ${path}`);
        }
      };
      visit("/", ctx.fs.root);
      const out = ["fsck: quanta virtual filesystem", `checked ${dirs} directories, ${files} files`];
      if (problems.length) {
        out.push("", `${problems.length} problem(s):`, ...problems.slice(0, 20));
        if (problems.length > 20) out.push(`… ${problems.length - 20} more`);
      } else {
        out.push("0 problems — filesystem clean");
      }
      return out;
    },
  },
];

/* (prefixTree removed — dead code) */
