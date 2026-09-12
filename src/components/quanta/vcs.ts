/* QUANTA vcs — a tiny, honest version-control sim for the sandbox.
   `git commit` snapshots the whole VFS state as one commit node; branches are
   named pointers to commit ids. Persisted as plain JSON (localStorage). */

export interface VcsCommit {
  id: string;            // 7-hex sim sha
  msg: string;
  ts: number;            // epoch ms
  parent: string | null; // parent commit id (first-parent chain)
  branch: string;        // branch the commit was made on
  files: number;         // files captured by the snapshot
}

export interface Vcs {
  commits: VcsCommit[];
  head: string;                       // current branch name
  branches: Record<string, string>;   // branch name -> tip commit id
  seq: number;                        // commit counter (id entropy)
}

export function newVcs(): Vcs {
  return { commits: [], head: "main", branches: {}, seq: 0 };
}

/* FNV-1a over a seed string → 7-hex id (deterministic, collision-safe for sandbox scale) */
function hashId(seed: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0").slice(0, 7);
}

export function makeCommit(
  v: Vcs,
  msg: string,
  files: number,
  ts: number,
): VcsCommit {
  v.seq += 1;
  const id = hashId(`${v.seq}|${ts}|${msg}|${files}|${v.head}`);
  const c: VcsCommit = {
    id,
    msg,
    ts,
    parent: v.branches[v.head] ?? null,
    branch: v.head,
    files,
  };
  v.commits.push(c);
  v.branches[v.head] = id;
  return c;
}

/** commits on the current branch, newest first (first-parent walk from the tip) */
export function branchCommits(v: Vcs, branch: string): VcsCommit[] {
  const out: VcsCommit[] = [];
  let cur: string | null = v.branches[branch] ?? null;
  while (cur) {
    const c = v.commits.find((x) => x.id === cur);
    if (!c) break;
    out.push(c);
    cur = c.parent;
  }
  return out;
}

export function vcsDump(v: Vcs): string {
  return JSON.stringify(v);
}

export function vcsLoad(raw: string | null): Vcs | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Vcs;
    if (!v || !Array.isArray(v.commits) || typeof v.head !== "string") return null;
    if (!v.branches || typeof v.branches !== "object") return null;
    return v;
  } catch {
    return null;
  }
}

/** "3m ago" style relative time for graph/log labels */
export function relTime(ts: number, now: number): string {
  const s = Math.max(1, Math.round((now - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
