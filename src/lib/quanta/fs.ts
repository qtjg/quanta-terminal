/**
 * QUANTA — virtual filesystem.
 * Pure TypeScript, no React, no DOM: runs in browser AND under `bun` for tests.
 * JSON-serializable so the session can be persisted to localStorage.
 */

export type NodeKind = 'file' | 'dir'

export interface FsNode {
  kind: NodeKind
  /** file content (kind === 'file') */
  content?: string
  /** directory children (kind === 'dir') */
  children?: Record<string, FsNode>
  mtime: number
}

export class FsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FsError'
  }
}

const nowMs = () => Date.now()

export function normalizePath(p: string, cwd = '/'): string {
  const abs = p.startsWith('/') ? p : `${cwd}/${p}`
  const parts = abs.split('/')
  const out: string[] = []
  for (const seg of parts) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      out.pop()
      continue
    }
    out.push(seg)
  }
  return '/' + out.join('/')
}

export function baseName(p: string): string {
  const n = normalizePath(p)
  if (n === '/') return '/'
  return n.slice(n.lastIndexOf('/') + 1)
}

export function dirName(p: string): string {
  const n = normalizePath(p)
  if (n === '/') return '/'
  const cut = n.slice(0, n.lastIndexOf('/'))
  return cut === '' ? '/' : cut
}

export class QuantaFS {
  root: FsNode

  constructor(seed?: Record<string, FsNode>) {
    this.root = { kind: 'dir', children: seed ?? {}, mtime: nowMs() }
  }

  /** Resolve a path without requiring existence. Throws on empty arg. */
  resolve(p: string, cwd = '/'): string {
    if (!p || p.trim() === '') throw new FsError('empty path')
    return normalizePath(p.trim(), cwd)
  }

  get(p: string, cwd = '/'): FsNode | null {
    const abs = normalizePath(p, cwd)
    if (abs === '/') return this.root
    const segs = abs.split('/').filter(Boolean)
    let node: FsNode = this.root
    for (const s of segs) {
      if (node.kind !== 'dir' || !node.children![s]) return null
      node = node.children![s]
    }
    return node
  }

  exists(p: string, cwd = '/'): boolean {
    return this.get(p, cwd) !== null
  }

  isDir(p: string, cwd = '/'): boolean {
    return this.get(p, cwd)?.kind === 'dir'
  }

  isFile(p: string, cwd = '/'): boolean {
    return this.get(p, cwd)?.kind === 'file'
  }

  /** Ensure the parent dir chain of `abs` exists (mkdir -p semantics). */
  private ensureDirChain(abs: string): FsNode {
    const segs = abs.split('/').filter(Boolean)
    let node = this.root
    for (const s of segs) {
      if (node.children![s] === undefined) {
        node.children![s] = { kind: 'dir', children: {}, mtime: nowMs() }
      }
      const next = node.children![s]
      if (next.kind !== 'dir') {
        const idx = segs.indexOf(s)
        throw new FsError(`not a directory: /${segs.slice(0, idx + 1).join('/')}`)
      }
      node = next
    }
    return node
  }

  mkdirp(p: string, cwd = '/'): string {
    const abs = normalizePath(p, cwd)
    const existing = this.get(abs)
    if (existing && existing.kind === 'file') throw new FsError(`file exists at ${abs}`)
    this.ensureDirChain(abs)
    return abs
  }

  writeFile(p: string, content: string, cwd = '/'): string {
    const abs = normalizePath(p, cwd)
    const parentAbs = dirName(abs)
    const name = baseName(abs)
    if (name === '/' || name === '') throw new FsError('invalid file name')
    const parent = this.get(parentAbs)
    if (!parent || parent.kind !== 'dir') throw new FsError(`${parentAbs}: no such directory`)
    const prev = parent.children![name]
    if (prev && prev.kind === 'dir') throw new FsError(`${abs}: is a directory`)
    parent.children![name] = { kind: 'file', content, mtime: nowMs() }
    return abs
  }

  appendFile(p: string, content: string, cwd = '/'): string {
    const abs = normalizePath(p, cwd)
    const prev = this.get(abs)
    if (prev && prev.kind === 'dir') throw new FsError(`${abs}: is a directory`)
    const cur = prev && prev.kind === 'file' ? prev.content ?? '' : ''
    return this.writeFile(abs, cur + content, '/')
  }

  readFile(p: string, cwd = '/'): string {
    const node = this.get(p, cwd)
    if (!node) throw new FsError(`${normalizePath(p, cwd)}: no such file or directory`)
    if (node.kind === 'dir') throw new FsError(`${normalizePath(p, cwd)}: is a directory`)
    return node.content ?? ''
  }

  /** List children as [name, node] sorted (dirs first, then alphabetical). */
  list(p: string, cwd = '/'): Array<[string, FsNode]> {
    const node = this.get(p, cwd)
    if (!node) throw new FsError(`${normalizePath(p, cwd)}: no such file or directory`)
    if (node.kind !== 'dir') throw new FsError(`${normalizePath(p, cwd)}: not a directory`)
    return Object.entries(node.children ?? {}).sort(([an, a], [bn, b]) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
      return an.localeCompare(bn)
    })
  }

  rm(p: string, opts: { recursive?: boolean; force?: boolean } = {}, cwd = '/'): string {
    const abs = normalizePath(p, cwd)
    if (abs === '/') {
      if (opts.force) return abs
      throw new FsError('refusing to remove root (/)')
    }
    const parent = this.get(dirName(abs))
    const name = baseName(abs)
    const node = parent?.kind === 'dir' ? parent.children![name] : undefined
    if (!node) {
      if (opts.force) return abs
      throw new FsError(`${abs}: no such file or directory`)
    }
    if (node.kind === 'dir' && Object.keys(node.children ?? {}).length > 0 && !opts.recursive) {
      throw new FsError(`${abs}: is a non-empty directory (use -r)`)
    }
    delete parent!.children![name]
    return abs
  }

  private clone(node: FsNode): FsNode {
    return JSON.parse(JSON.stringify(node)) as FsNode
  }

  cp(src: string, dest: string, opts: { recursive?: boolean } = {}, cwd = '/'): string {
    const srcAbs = normalizePath(src, cwd)
    const node = this.get(srcAbs)
    if (!node) throw new FsError(`${srcAbs}: no such file or directory`)
    if (node.kind === 'dir' && !opts.recursive) throw new FsError(`${srcAbs}: is a directory (use -r)`)
    let destAbs = normalizePath(dest, cwd)
    const destNode = this.get(destAbs)
    if (destNode && destNode.kind === 'dir') {
      destAbs = normalizePath(`${destAbs}/${baseName(srcAbs)}`)
    }
    if (destAbs.startsWith(srcAbs + '/')) throw new FsError('cannot copy a directory into itself')
    const parent = this.get(dirName(destAbs))
    if (!parent || parent.kind !== 'dir') throw new FsError(`${dirName(destAbs)}: no such directory`)
    const name = baseName(destAbs)
    if (name === '/' || name === '') throw new FsError('invalid destination')
    parent.children![name] = this.clone(node)
    return destAbs
  }

  mv(src: string, dest: string, cwd = '/'): string {
    const srcAbs = normalizePath(src, cwd)
    const node = this.get(srcAbs)
    if (!node) throw new FsError(`${srcAbs}: no such file or directory`)
    let destAbs = normalizePath(dest, cwd)
    const destNode = this.get(destAbs)
    if (destNode && destNode.kind === 'dir') destAbs = normalizePath(`${destAbs}/${baseName(srcAbs)}`)
    if (destAbs === srcAbs) return destAbs
    if (destAbs.startsWith(srcAbs + '/')) throw new FsError('cannot move a directory into itself')
    const srcParent = this.get(dirName(srcAbs))
    const destParent = this.get(dirName(destAbs))
    if (!destParent || destParent.kind !== 'dir') throw new FsError(`${dirName(destAbs)}: no such directory`)
    const name = baseName(destAbs)
    if (name === '/' || name === '') throw new FsError('invalid destination')
    delete srcParent!.children![baseName(srcAbs)]
    destParent.children![name] = node
    return destAbs
  }

  /** Recursive size in "bytes" (content length) and node count. */
  usage(node: FsNode = this.root): { bytes: number; files: number; dirs: number } {
    if (node.kind === 'file') return { bytes: (node.content ?? '').length, files: 1, dirs: 0 }
    let bytes = 0
    let files = 0
    let dirs = 1
    for (const [, child] of Object.entries(node.children ?? {})) {
      const u = this.usage(child)
      bytes += u.bytes
      files += u.files
      dirs += u.dirs
    }
    return { bytes, files, dirs }
  }

  /** Walk all paths under `p` (files and dirs), depth-first, sorted. */
  walk(p: string, cwd = '/'): string[] {
    const abs = normalizePath(p, cwd)
    const start = this.get(abs)
    if (!start) throw new FsError(`${abs}: no such file or directory`)
    const out: string[] = [abs]
    if (start.kind === 'dir') {
      for (const [name, child] of this.list(abs)) {
        const childPath = abs === '/' ? `/${name}` : `${abs}/${name}`
        if (child.kind === 'dir') out.push(...this.walk(childPath, '/'))
        else out.push(childPath)
      }
    }
    return out
  }

  toJSON(): string {
    return JSON.stringify(this.root)
  }

  static fromJSON(json: string): QuantaFS {
    const root = JSON.parse(json) as FsNode
    if (!root || root.kind !== 'dir') throw new FsError('corrupt filesystem snapshot')
    return new QuantaFS(root.children)
  }
}

/** Default home directory contents — real files used by the smoke workflows. */
export function seedHome(): Record<string, FsNode> {
  const t = nowMs()
  const f = (content: string): FsNode => ({ kind: 'file', content, mtime: t })
  const d = (children: Record<string, FsNode>): FsNode => ({ kind: 'dir', children, mtime: t })
  return {
    home: d({
      quanta: d({
        'readme.md': f(
          '# QUANTA\n\nAI-native terminal in your browser.\nType `help` to list every command.\nReal filesystem, real tools, no demos.\n'
        ),
        'todo.txt': f('ship quanta core\nwrite unit tests\ntest everything for real\nfix all kinda errors\n'),
        notes: d({
          'japan.txt': f(
            'tokyo: sensoji at dawn\nkyoto: bamboo grove, arashiyama\nfuji: kawaguchiko north shore\nosaka: dotonbori after dark\n'
          ),
          'snippets.txt': f('const answer = 42;\nexport function greet(name) {\n  return `hello ${name}`;\n}\n'),
        }),
        projects: d({
          quanta: d({
            'engine.ts': f('// quanta command engine\nexport const VERSION = "1.0.0";\n'),
            'CHANGELOG.md': f('## 1.0.0\n- first real release\n- 40+ working commands\n'),
          }),
        }),
        '.quanta': d({
          'motd.txt': f('QUANTA v1.0.0 — what is real cannot be demoed.\n'),
        }),
      }),
    }),
    tmp: d({}),
    etc: d({
      hostname: f('quanta\n'),
    }),
  }
}
