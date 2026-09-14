/** Bounded project scans for the structure tree and the @ resource picker. */

import { readFileSync, readdirSync, statSync, type Dirent } from 'node:fs'
import { extname, join, relative, sep } from 'node:path'

/** One real tree node: a directory or file under the project root. */
export interface TreeNode {
  name: string
  path: string
  kind: 'file' | 'dir'
  /** Word count for .md files, byte size for others, '' for directories. */
  detail: string
  children?: TreeNode[]
}

/** One user-editable text file offered to the @ reference picker. */
export interface ProjectResource {
  name: string
  path: string
  kind: 'file'
  detail: string
}

/** One bounded scan result; `truncated` reports that the entry budget stopped the walk. */
export interface ProjectScan<T> {
  entries: T
  truncated: boolean
}

/**
 * Directory names never scanned. Package caches hold the bulk of a project's
 * files (this repository: 191,713 of 212,365) and are not project content: one
 * unbounded walk of them cost 2.4 s and produced a 23.5 MiB structure response,
 * repeated per filesystem change, which exhausted the renderer holding it.
 */
const SKIPPED_DIRECTORIES = new Set(['node_modules'])

/** Deepest level scanned, counted from the project root. */
const MAX_DEPTH = 8

/** Extensions offered to the @ reference picker. */
const RESOURCE_EXTENSIONS = /\.(?:md|markdown|txt|json|yaml|yml)$/iu

/** Remaining entries one response may carry, plus whether the budget cut the walk short. */
interface ScanBudget {
  remaining: number
  truncated: boolean
}

/** Charge one entry to the budget; false means the budget is spent and the caller must stop. */
function spend(budget: ScanBudget): boolean {
  if (budget.remaining > 0) {
    budget.remaining -= 1
    return true
  }
  budget.truncated = true
  return false
}

/** Read one directory's scannable entries: real files and directories, never private or skipped names. */
function readEntries(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(e => !e.isSymbolicLink() && (e.isFile() || e.isDirectory()) && e.name !== '.DS_Store'
        && !e.name.startsWith('.') && !SKIPPED_DIRECTORIES.has(e.name))
  } catch {
    return []
  }
}

/** Rough word count (CJK chars + Latin words) for a markdown file. */
function wordCount(file: string): number {
  try {
    const text = readFileSync(file, 'utf8')
    const cjk = text.match(/[一-鿿]/g)?.length ?? 0
    const latin = text.split(/\s+/).filter(w => /[A-Za-z0-9]/.test(w)).length
    return cjk + latin
  } catch {
    return 0
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function fileDetail(file: string): string {
  try {
    return extname(file) === '.md' ? wordCount(file) + ' 字' : formatBytes(statSync(file).size)
  } catch {
    return ''
  }
}

/**
 * Recursively scan project content into structure tree nodes.
 * @param dir - directory to scan, the project root on the first call.
 * @param limit - maximum nodes one response may carry.
 * @returns the tree and whether the budget stopped the walk.
 */
export function scanProjectTree(dir: string, limit: number): ProjectScan<TreeNode[]> {
  const budget: ScanBudget = { remaining: limit, truncated: false }
  return { entries: scanDir(dir, budget, 0), truncated: budget.truncated }
}

function scanDir(dir: string, budget: ScanBudget, depth: number): TreeNode[] {
  if (depth > MAX_DEPTH) return []
  const entries = readEntries(dir)
  const dirs = entries.filter(e => e.isDirectory())
  const files = entries.filter(e => !e.isDirectory())
  const ordered = [...dirs, ...files].sort((a, b) => a.name.localeCompare(b.name))
  const nodes: TreeNode[] = []
  for (const entry of ordered) {
    if (!spend(budget)) break
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      nodes.push({ name: entry.name, path: full, kind: 'dir', detail: '', children: scanDir(full, budget, depth + 1) })
      continue
    }
    nodes.push({
      name: extname(entry.name) === '.md' ? entry.name.replace(/\.md$/, '') : entry.name,
      path: full,
      kind: 'file',
      detail: fileDetail(full),
    })
  }
  return nodes
}

/**
 * Recursively collect the text files the @ reference picker offers.
 * @param dir - directory to scan, the project root on the first call.
 * @param root - project root the reported names are relative to.
 * @param limit - maximum entries one response may carry.
 * @returns the resources and whether the budget stopped the walk.
 */
export function scanProjectResources(dir: string, root: string, limit: number): ProjectScan<ProjectResource[]> {
  const budget: ScanBudget = { remaining: limit, truncated: false }
  return { entries: scanResources(dir, root, budget, 0), truncated: budget.truncated }
}

function scanResources(dir: string, root: string, budget: ScanBudget, depth: number): ProjectResource[] {
  if (depth > MAX_DEPTH) return []
  const result: ProjectResource[] = []
  for (const entry of readEntries(dir).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (budget.truncated) break
      result.push(...scanResources(full, root, budget, depth + 1))
      continue
    }
    if (!RESOURCE_EXTENSIONS.test(entry.name)) continue
    if (!spend(budget)) break
    result.push({ name: relative(root, full).split(sep).join('/'), path: full, kind: 'file', detail: fileDetail(full) })
  }
  return result
}
