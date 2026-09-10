/* QUANTA virtual filesystem — pure TS, isomorphic (browser + bun) */

export interface FileNode {
  type: "file";
  name: string;
  content: string;
  mode: string;
  mtime: number;
}
export interface DirNode {
  type: "dir";
  name: string;
  children: Record<string, FSNode>;
  mode: string;
  mtime: number;
}
export type FSNode = FileNode | DirNode;

export function isDir(n: FSNode | null | undefined): n is DirNode {
  return !!n && n.type === "dir";
}
export function isFile(n: FSNode | null | undefined): n is FileNode {
  return !!n && n.type === "file";
}

const HOME = "/home/mayank";

export function seedFS(): DirNode {
  const now = Date.now();
  const f = (name: string, content: string): FileNode => ({
    type: "file", name, content, mode: "-rw-r--r--", mtime: now,
  });
  const root: DirNode = {
    type: "dir", name: "/", mode: "drwxr-xr-x", mtime: now, children: {},
  };
  const mk = (parent: DirNode, name: string): DirNode => {
    const d: DirNode = { type: "dir", name, mode: "drwxr-xr-x", mtime: now, children: {} };
    parent.children[name] = d;
    return d;
  };
  const home = mk(root, "home");
  const mayank = mk(home, "mayank");
  const etc = mk(root, "etc");
  const usr = mk(root, "usr");
  const bin = mk(usr, "bin");
  const varDir = mk(root, "var");
  const log = mk(varDir, "log");
  const tmp = mk(root, "tmp");
  void bin; void log; void tmp;

  mayank.children["README.md"] = f("README.md",
`# QUANTA — AI-Native Linux Terminal

Quanta is an AI-native terminal environment: classic shell power
plus an AI engine that understands the machine, the project and
the task.

Quick start:
  1. type 'help'            -> full command index
  2. type 'neofetch'        -> system card
  3. type 'ai <question>'   -> ask the AI engine anything
  4. type 'theme <name>'    -> matrix / amber / ocean / carbon / light

Every command here is implemented for real — pipes-free but
argument-rich. Try:
  grep -in "quanta" README.md
  regex "(\\w+)@(\\w+)" g  "mail mayank@quanta.dev now"
  calc 2^10 / 4 + sqrt(144)
`);

  mayank.children["notes.txt"] = f("notes.txt",
`TODO
- [x] boot quanta kernel
- [ ] ship v0.6 provider mesh
- [ ] review PR #42 (auth module)
SECRETS
db_password=hunter2 (never commit this)
`);

  const docs = mk(mayank, "docs");
  docs.children["linux-cheatsheet.md"] = f("linux-cheatsheet.md",
`# Linux Cheatsheet
processes : ps aux | top | kill <pid>
disks     : df -h | du -sh * | lsblk
network   : ping <host> | curl <url> | netstat -t
files     : find . -name "*.log" | grep -rn "error" .
services  : systemctl status nginx | journalctl -u nginx -n 20
`);
  docs.children["api-notes.txt"] = f("api-notes.txt",
`GET  /api/tours      200 41ms
POST /api/booking    201 88ms
GET  /api/reviews    200 12ms
POST /api/booking    500 91ms  <-- investigate
GET  /api/tours      200 39ms
`);

  const projects = mk(mayank, "projects");
  projects.children["hello.sh"] = f("hello.sh",
`#!/bin/bash
name="\${1:-world}"
echo "Hello, \$name!"
echo "quanta says hi"
`);
  const app = mk(projects, "app");
  app.children["main.ts"] = f("main.ts",
`import { boot } from "./kernel";

const agent = boot({ ai: true, shell: "quanta" });

agent.on("intent", (intent) => {
  console.log("plan:", intent.plan);
});

agent.run("deploy staging");
`);
  app.children["kernel.ts"] = f("kernel.ts",
`export function boot(opts: { ai: boolean; shell: string }) {
  return {
    on: (_ev: string, _cb: (x: unknown) => void) => {},
    run: (task: string) => console.log("running", task),
  };
}
`);

  etc.children["hostname"] = f("hostname", "quanta\n");
  etc.children["os-release"] = f("os-release",
`NAME="Quanta OS"
VERSION="0.5.0 (Interactive Agent)"
ID=quanta
PRETTY_NAME="Quanta OS 0.5.0"
`);
  return root;
}

export class FS {
  root: DirNode;

  constructor(root?: DirNode) {
    this.root = root ?? seedFS();
  }

  static load(json: string): FS {
    try {
      const parsed = JSON.parse(json) as DirNode;
      if (parsed && parsed.type === "dir") return new FS(parsed);
    } catch { /* corrupted -> reseed */ }
    return new FS();
  }

  dump(): string {
    return JSON.stringify(this.root);
  }

  /** normalize a path against cwd; supports ~ . .. and relative segments */
  resolve(cwd: string, p?: string): string {
    if (!p || p === ".") return cwd;
    let base = p.startsWith("~") ? HOME : p.startsWith("/") ? "/" : cwd;
    const segs = (p.startsWith("~") ? p.slice(2) : p).split("/").filter(Boolean);
    const out = base === "/" ? [] : base.split("/").filter(Boolean);
    for (const s of segs) {
      if (s === ".") continue;
      if (s === "..") { out.pop(); continue; }
      out.push(s);
    }
    return "/" + out.join("/");
  }

  get(path: string): FSNode | null {
    if (path === "/" || path === "") return this.root;
    let node: FSNode = this.root;
    for (const seg of path.split("/").filter(Boolean)) {
      if (!isDir(node)) return null;
      const next = node.children[seg];
      if (!next) return null;
      node = next;
    }
    return node;
  }

  parentOf(path: string): { dir: DirNode | null; name: string } {
    const parts = path.split("/").filter(Boolean);
    const name = parts.pop() ?? "";
    const parentPath = "/" + parts.join("/");
    const dir = this.get(parentPath);
    return { dir: isDir(dir) ? dir : null, name };
  }

  mkdirp(path: string): DirNode | null {
    const parts = path.split("/").filter(Boolean);
    let node = this.root;
    for (const seg of parts) {
      const next = node.children[seg];
      if (next) {
        if (!isDir(next)) return null;
        node = next;
      } else {
        const d: DirNode = { type: "dir", name: seg, mode: "drwxr-xr-x", mtime: Date.now(), children: {} };
        node.children[seg] = d;
        node = d;
      }
    }
    return node;
  }

  writeFile(path: string, content: string, append = false): boolean {
    const { dir, name } = this.parentOf(path);
    if (!dir || !name) return false;
    const existing = dir.children[name];
    if (isDir(existing)) return false;
    if (isFile(existing)) {
      existing.content = append ? existing.content + content : content;
      existing.mtime = Date.now();
    } else {
      dir.children[name] = { type: "file", name, content, mode: "-rw-r--r--", mtime: Date.now() };
    }
    return true;
  }

  rm(path: string, recursive: boolean): boolean {
    if (path === "/") return false;
    const node = this.get(path);
    if (!node) return false;
    if (isDir(node) && Object.keys(node.children).length > 0 && !recursive) return false;
    const { dir, name } = this.parentOf(path);
    if (!dir) return false;
    delete dir.children[name];
    return true;
  }

  list(path: string): FSNode[] {
    const node = this.get(path);
    if (!isDir(node)) return [];
    return Object.values(node.children).sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  /** walk all paths under root */
  walk(path = "/"): string[] {
    const out: string[] = [];
    const node = this.get(path);
    if (!isDir(node)) return out;
    const rec = (d: DirNode, prefix: string) => {
      for (const child of Object.values(d.children)) {
        const p = prefix + child.name;
        out.push(p);
        if (isDir(child)) rec(child, p + "/");
      }
    };
    rec(node, path === "/" ? "/" : path + "/");
    return out;
  }

  size(node: FSNode): number {
    if (isFile(node)) return node.content.length;
    return Object.values(node.children).reduce((s, c) => s + this.size(c), 0);
  }

  countAll(): { files: number; dirs: number; bytes: number } {
    let files = 0, dirs = 0, bytes = 0;
    for (const p of this.walk()) {
      const n = this.get(p);
      if (isFile(n)) { files++; bytes += n.content.length; }
      else dirs++;
    }
    return { files, dirs, bytes };
  }
}

export const HOME_PATH = HOME;
