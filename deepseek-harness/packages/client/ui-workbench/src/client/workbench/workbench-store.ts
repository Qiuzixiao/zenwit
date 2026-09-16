/**
 * Per-session workbench state: the bottom workbench's split-pane tree, open
 * tabs, and the explorer expansion set. One state instance per conversation
 * id, persisted to localStorage under `dsh-workbench:v1:<id>` so a reload
 * restores the exact layout of the session it belongs to — switching
 * conversations swaps the whole state (memory + isolation).
 *
 * The split tree is a recursive structure: a leaf holds a tab group, a split
 * divides the space row- or column-wise with fractional sizes. All tree
 * operations are pure functions over the node, unit-tested in tests/state.spec.ts.
 */
import { SIDEBAR_PREFS_DEFAULTS, type WorkbenchPrefs } from './prefs-shared.ts'

/**
 * Tab type identifier. Builtins register their ids (editor / git / terminal
 * / subagent / browser / diff) through the workbench service; external
 * plugins register their own (e.g. `'my-plugin:db'`). Kept as `string` so
 * the registry stays open.
 */
export type TabType = string

/** What a diff tab shows: a worktree/index change of one path, or one commit's full patch. */
export type WorkbenchDiffRef =
  | { kind: 'worktree'; path: string; staged: boolean; untracked?: boolean | undefined; worktree?: string | undefined; repoRoot?: string | undefined }
  | { kind: 'commit'; hash: string; hashFull: string; subject: string; worktree?: string | undefined; repoRoot?: string | undefined }

/** One open tab. `path` carries the file (editor) or is absent (git/terminal);
 *  `diff` carries the change a diff tab shows; `meta` (v0.12.0+) carries
 *  plugin-owned JSON-serializable state, preserved across reloads. */
export interface WorkbenchTab {
  id: string
  type: TabType
  title: string
  path?: string
  diff?: WorkbenchDiffRef
  /** Plugin-owned state (v0.12.0+): MUST be JSON-serializable — it is
   *  persisted with the layout and restored verbatim on reload. */
  meta?: unknown
  /** Pinned-terminal marker (v0.17.0+): a pinned terminal tab survives a
   *  session switch in its home session's state and surfaces in the
   *  PinnedRail of every session the scope allows. `homeCwd` is the cwd
   *  snapshot at pin time — a `workspace`-scoped pin is only visible to
   *  sessions whose cwd matches it. Absent = unpinned (legacy states). */
  pin?: { scope: 'workspace' | 'global'; homeCwd?: string | undefined }
}

/** A tab group. */
export interface WorkbenchLeaf {
  kind: 'leaf'
  id: string
  tabs: WorkbenchTab[]
  active: string | null
}

/** A recursive split between child panes (fractional sizes summing to 1). */
export interface WorkbenchSplit {
  kind: 'split'
  id: string
  dir: 'row' | 'col'
  sizes: number[]
  children: SplitNode[]
}

export type SplitNode = WorkbenchLeaf | WorkbenchSplit

/** The full per-session state. */
export interface WorkbenchState {
  /** The pane receiving newly opened tabs (the last pane the user touched). */
  activePane: string | null
  /** Monotonic terminal tab counter (ids survive reloads). */
  nextTerminal: number
  /** Monotonic browser tab counter (ids survive reloads; mirrors nextTerminal). */
  nextBrowser: number
  /** Explorer expansion set (absolute directory paths). */
  expanded: string[]
  /**
   * Explorer rows highlighted by a "Show in folder" reveal (absolute paths).
   * Transient by design: sanitizeState never restores it, so a reload starts
   * unhighlighted.
   */
  revealed: string[]
  /** The workbench's split tree: the middle column's tabs and panes. */
  splits: SplitNode
}

export const TAB_MAX_WIDTH = 160

let nextIdCounter = 0
/** Unique pane/tab id within one state instance. */
function uid(prefix: string): string {
  nextIdCounter += 1
  return `${prefix}:${nextIdCounter}`
}

/** Mint a fresh uid-based tab id. The `'editor:' + path` convention only
 *  covers openWorkbenchFile opens (per-path dedupe); opens that must not
 *  dedupe (the tree's "open to the side") mint through here. */
export function mintTabId(): string {
  return uid('tab')
}

/**
 * The largest numeric suffix across a raw persisted state's counter ids
 * (`pane:N` / `tab:N` / `split:N`). The uid counter is module-global and
 * resets on every reload, so a split minted AFTER a reload would collide
 * with the persisted ids (a fresh "pane:1" beside the persisted "pane:1");
 * mapLeaf would then visit BOTH leaves and every open would land in both
 * panes of the split. Seeding the counter past the persisted ids keeps
 * fresh ids disjoint.
 */
function maxCounterId(parsed: unknown): number {
  let max = 0
  const consider = (id: unknown): void => {
    if (typeof id !== 'string') return
    const match = /^(?:pane|tab|split):(\d+)$/.exec(id)
    if (match !== null) max = Math.max(max, Number(match[1]))
  }
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return
    const record = node as Record<string, unknown>
    consider(record.id)
    if (Array.isArray(record.tabs)) {
      for (const tab of record.tabs) {
        if (tab !== null && typeof tab === 'object') consider((tab as Record<string, unknown>).id)
      }
    }
    if (Array.isArray(record.children)) {
      for (const child of record.children) walk(child)
    }
  }
  walk((parsed as Record<string, unknown> | null)?.splits)
  return max
}

/**
 * A fresh default state: one empty pane in the workbench. Nothing is seeded —
 * the empty pane's own cards offer the openable types, and files open into it
 * from the workspace's explorer column.
 */
export function makeDefaultState(): WorkbenchState {
  const leaf: WorkbenchLeaf = { kind: 'leaf', id: uid('pane'), tabs: [], active: null }
  return {
    activePane: leaf.id,
    nextTerminal: 1,
    nextBrowser: 1,
    expanded: [],
    revealed: [],
    splits: leaf,
  }
}

/** Walk the tree and apply `visit` to the leaf with the given id. */
export function mapLeaf(node: SplitNode, paneId: string, visit: (leaf: WorkbenchLeaf) => void): SplitNode {
  if (node.kind === 'leaf') {
    if (node.id === paneId) {
      const copy: WorkbenchLeaf = { ...node, tabs: [...node.tabs] }
      visit(copy)
      return copy
    }
    return node
  }
  const split = node
  return {
    ...split,
    sizes: [...split.sizes],
    children: split.children.map(child => mapLeaf(child, paneId, visit)),
  }
}

/** The first leaf of the tree (fallback pane when activePane is gone). */
export function firstLeaf(node: SplitNode): WorkbenchLeaf {
  if (node.kind === 'leaf') return node
  return firstLeaf(node.children[0]!)
}

/** Find the leaf containing a tab id, if any. */
export function leafWithTab(node: SplitNode, tabId: string): WorkbenchLeaf | undefined {
  if (node.kind === 'leaf') {
    return node.tabs.some(tab => tab.id === tabId) ? node : undefined
  }
  for (const child of node.children) {
    const found = leafWithTab(child, tabId)
    if (found !== undefined) return found
  }
  return undefined
}

/** All leaves of the tree, depth-first. */
export function allLeaves(node: SplitNode): WorkbenchLeaf[] {
  if (node.kind === 'leaf') return [node]
  return node.children.flatMap(allLeaves)
}

/** Whether a tab is open anywhere in the session's workbench. */
export function tabOpenIn(state: WorkbenchState, tabId: string): boolean {
  return allLeaves(state.splits).some(leaf => leaf.tabs.some(tab => tab.id === tabId))
}

/** Replace a leaf with a split of it plus a fresh empty leaf. */
export function splitLeafAt(node: SplitNode, paneId: string, dir: 'row' | 'col'): SplitNode {
  const fresh: WorkbenchLeaf = { kind: 'leaf', id: uid('pane'), tabs: [], active: null }
  return mapLeaf(node, paneId, (leaf) => {
    const target: WorkbenchLeaf = { ...leaf }
    const split: WorkbenchSplit = {
      kind: 'split',
      id: uid('split'),
      dir,
      sizes: [0.5, 0.5],
      children: [target, fresh],
    }
    Object.assign(leaf, split)
  })
}

/**
 * Split a leaf by inserting a fresh leaf holding `tab` beside it — the
 * VSCode drag-to-edge gesture. `dir` is the split direction ('row' for
 * left/right, 'col' for up/down); `front` places the new leaf first (left/
 * up) or second (right/down).
 * @returns the new tree plus the fresh leaf's id (the drop's active pane).
 */
export function insertLeafAt(
  node: SplitNode,
  paneId: string,
  dir: 'row' | 'col',
  tab: WorkbenchTab,
  front: boolean,
): { node: SplitNode; leafId: string } {
  const fresh: WorkbenchLeaf = { kind: 'leaf', id: uid('pane'), tabs: [tab], active: tab.id }
  const leafId = fresh.id
  const next = mapLeaf(node, paneId, (leaf) => {
    const target: WorkbenchLeaf = { ...leaf }
    const split: WorkbenchSplit = {
      kind: 'split',
      id: uid('split'),
      dir,
      sizes: [0.5, 0.5],
      children: front ? [fresh, target] : [target, fresh],
    }
    Object.assign(leaf, split)
  })
  return { node: next, leafId }
}

/** Where a tab drop lands on a pane: an edge creates a split, center merges. */
export type DropZone = 'left' | 'right' | 'up' | 'down' | 'center'

/**
 * The VSCode drag gesture: move a tab out of its pane and either merge it
 * into the target pane (center) or split the target pane with the tab in a
 * fresh leaf (edge). The source pane collapses when it empties.
 */
export function moveTabToEdge(
  state: WorkbenchState,
  fromPane: string,
  tabId: string,
  toPane: string,
  zone: DropZone,
): WorkbenchState {
  if (fromPane === toPane && zone === 'center') {
    // Dropped back onto its own pane's center: reorder to the end.
    return moveTab(state, fromPane, tabId, toPane, -1)
  }
  const node = state.splits
  const source = leafWithTab(node, tabId)
  if (source === undefined) return state
  const tab = source.tabs.find(candidate => candidate.id === tabId)!
  let emptied = false
  let splits = mapLeaf(node, source.id, (leaf) => {
    leaf.tabs = leaf.tabs.filter(candidate => candidate.id !== tabId)
    if (leaf.active === tabId) leaf.active = leaf.tabs[leaf.tabs.length - 1]?.id ?? null
    if (leaf.tabs.length === 0) emptied = true
  })
  if (emptied) splits = removeLeafAt(splits, source.id)
  if (zone === 'center') {
    splits = mapLeaf(splits, toPane, (leaf) => {
      leaf.tabs = [...leaf.tabs, tab]
      leaf.active = tab.id
    })
    return { ...state, splits: splits, activePane: toPane }
  }
  const dir = zone === 'left' || zone === 'right' ? 'row' : 'col'
  const result = insertLeafAt(splits, toPane, dir, tab, zone === 'left' || zone === 'up')
  return { ...state, splits: result.node, activePane: result.leafId }
}

/**
 * Remove a leaf from the tree. A split left with one child promotes that
 * child; removing the last leaf yields an empty leaf.
 */
export function removeLeafAt(node: SplitNode, paneId: string): SplitNode {
  if (node.kind === 'leaf') return node.id === paneId ? { ...node, tabs: [], active: null } : node
  const children = node.children.filter(child => !(child.kind === 'leaf' && child.id === paneId))
  if (children.length === node.children.length) {
    return {
      ...node,
      sizes: [...node.sizes],
      children: node.children.map(child => removeLeafAt(child, paneId)),
    }
  }
  if (children.length === 1) return children[0]!
  return { ...node, sizes: [...node.sizes], children }
}

/** Close a tab; an emptied leaf is removed (unless it is the only pane). */
export function closeTab(state: WorkbenchState, paneId: string, tabId: string): WorkbenchState {
  const key = 'splits'
  let emptied = false
  const splits = mapLeaf(state[key], paneId, (leaf) => {
    leaf.tabs = leaf.tabs.filter(tab => tab.id !== tabId)
    if (leaf.active === tabId) leaf.active = leaf.tabs[leaf.tabs.length - 1]?.id ?? null
    if (leaf.tabs.length === 0) emptied = true
  })
  return { ...state, [key]: emptied ? removeLeafAt(splits, paneId) : splits }
}

/** Activate a tab in its pane (the pane's own tree). */
export function activateTab(state: WorkbenchState, paneId: string, tabId: string): WorkbenchState {
  const key = 'splits'
  return {
    ...state,
    activePane: paneId,
    [key]: mapLeaf(state[key], paneId, (leaf) => {
      if (leaf.tabs.some(tab => tab.id === tabId)) leaf.active = tabId
    }),
  }
}

/** Update the display fields of one open tab (title / path / meta) without
 *  re-opening it. The browser tab persists its current URL and hostname
 *  title through this reducer so a reload restores the visited page. A
 *  missing tab id is a no-op. The tab may live in either tree or a free
 *  window. */
export function patchTab(
  state: WorkbenchState,
  tabId: string,
  patch: { title?: string; path?: string; meta?: unknown },
): WorkbenchState {
  let changed = false
  const apply = (tab: WorkbenchTab): WorkbenchTab => {
    changed = true
    return {
      ...tab,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.path !== undefined ? { path: patch.path } : {}),
      ...(patch.meta !== undefined ? { meta: patch.meta } : {}),
    }
  }
  const walk = (node: SplitNode): SplitNode => {
    if (node.kind === 'leaf') {
      const tabs = node.tabs.map(tab => (tab.id === tabId ? apply(tab) : tab))
      return tabs === node.tabs ? node : { ...node, tabs }
    }
    const children = node.children.map(walk)
    return children === node.children ? node : { ...node, children }
  }
  const splits = walk(state.splits)
  return changed ? { ...state, splits } : state
}

/**
 * Set or clear the pin marker on one open tab (v0.17.0+). A pin marker is
 * structural metadata (NOT display fields like title/path), so it walks
 * the workbench's split tree exactly like {@link patchTab}. Passing `null` clears the pin
 * (the tab stays open in its home session); passing a `{ scope, homeCwd }`
 * object sets it. An unknown tab id is a strict no-op (same reference
 * returned) so a stale pin request never churns the state or rewrites
 * localStorage.
 * @param state - the current per-session workbench state.
 * @param tabId - the tab to pin/unpin.
 * @param pin - the pin marker to set, or null to clear.
 * @returns the next state (or the same reference when the tab is missing
 *          or the pin marker is already the requested value).
 */
export function setTabPin(
  state: WorkbenchState,
  tabId: string,
  pin: { scope: 'workspace' | 'global'; homeCwd?: string | undefined } | null,
): WorkbenchState {
  let changed = false
  const apply = (tab: WorkbenchTab): WorkbenchTab => {
    // Pin is terminal-only (design YAGNI): a defensive guard keeps the
    // invariant even if a caller accidentally targets a non-terminal tab.
    if (tab.type !== 'terminal') return tab
    // Idempotent: setting the same pin (deep-equal on scope + homeCwd) is a
    // no-op so re-clicking the menu item never churns the state.
    if (pin === null) {
      if (tab.pin === undefined) return tab
    } else if (
      tab.pin !== undefined
      && tab.pin.scope === pin.scope
      && tab.pin.homeCwd === pin.homeCwd
    ) {
      return tab
    }
    changed = true
    const { pin: _omit, ...rest } = tab
    return pin === null ? rest : { ...rest, pin }
  }
  const walk = (node: SplitNode): SplitNode => {
    if (node.kind === 'leaf') {
      // Find the target tab without rebuilding the whole array: only clone
      // when the tab is actually here and apply changed it (idempotent
      // no-ops return the same tab reference, so === holds).
      const idx = node.tabs.findIndex(tab => tab.id === tabId)
      if (idx < 0) return node
      const oldTab = node.tabs[idx]!
      const newTab = apply(oldTab)
      if (newTab === oldTab) return node
      const tabs = node.tabs.slice()
      tabs[idx] = newTab
      return { ...node, tabs }
    }
    const children = node.children.map(walk)
    // Only rebuild if at least one child actually changed reference.
    if (children.every((child, i) => child === node.children[i])) return node
    return { ...node, children }
  }
  const splits = walk(state.splits)
  return changed ? { ...state, splits } : state
}

/**
 * Land a tab in the workbench's first pane — the plugin's own opens (its
 * bottom-panel + menu, the auto-terminal, and every open when no native
 * surface is installed): the plugin owns no right column any more (DSH's
 * native workbench is the right one), so the bottom workbench is the only tree.
 * @param state - the session state.
 * @param tab - the tab to land.
 * @returns the next state, with the bottom panel open.
 */
export function openTabInPane(state: WorkbenchState, tab: WorkbenchTab): WorkbenchState {
  const targetId = firstLeaf(state.splits).id
  // Id-based safety net: if a tab with the same id exists, focus it.
  for (const leaf of allLeaves(state.splits)) {
    const existing = leaf.tabs.find(candidate => candidate.id === tab.id)
    if (existing !== undefined) return activateTab(state, leaf.id, existing.id)
  }
  return {
    ...state,
    activePane: targetId,
    splits: mapLeaf(state.splits, targetId, (leaf) => {
      leaf.tabs = [...leaf.tabs, tab]
      leaf.active = tab.id
    }),
  }
}

/** Move a tab from one pane to another (insert at index; -1 appends).
 *  The panes may live in DIFFERENT trees — dragging a tab between the two
 *  panels removes it from its own tree and lands it in the other one. */
export function moveTab(state: WorkbenchState, fromPane: string, tabId: string, toPane: string, index = -1): WorkbenchState {
  const fromKey = 'splits'
  const toKey = 'splits'
  if (fromKey !== toKey) {
    let moved: WorkbenchTab | undefined
    let emptied = false
    const source = mapLeaf(state[fromKey], fromPane, (leaf) => {
      const found = leaf.tabs.find(tab => tab.id === tabId)
      if (found === undefined) return
      moved = found
      leaf.tabs = leaf.tabs.filter(tab => tab.id !== tabId)
      if (leaf.active === tabId) leaf.active = leaf.tabs[leaf.tabs.length - 1]?.id ?? null
      if (leaf.tabs.length === 0) emptied = true
    })
    if (moved === undefined) return state
    const target = mapLeaf(state[toKey], toPane, (leaf) => {
      const insertAt = index >= 0 && index <= leaf.tabs.length ? index : leaf.tabs.length
      leaf.tabs = [...leaf.tabs.slice(0, insertAt), moved!, ...leaf.tabs.slice(insertAt)]
      leaf.active = moved!.id
    })
    return {
      ...state,
      [fromKey]: emptied ? removeLeafAt(source, fromPane) : source,
      [toKey]: target,
      activePane: toPane,
    }
  }
  let moved: WorkbenchTab | undefined
  let emptied = false
  let splits = mapLeaf(state[fromKey], fromPane, (leaf) => {
    const found = leaf.tabs.find(tab => tab.id === tabId)
    if (found === undefined) return
    moved = found
    leaf.tabs = leaf.tabs.filter(tab => tab.id !== tabId)
    if (leaf.active === tabId) leaf.active = leaf.tabs[leaf.tabs.length - 1]?.id ?? null
    if (leaf.tabs.length === 0) emptied = true
  })
  if (moved === undefined) return state
  if (emptied) splits = removeLeafAt(splits, fromPane)
  splits = mapLeaf(splits, toPane, (leaf) => {
    const insertAt = index >= 0 && index <= leaf.tabs.length ? index : leaf.tabs.length
    leaf.tabs = [...leaf.tabs.slice(0, insertAt), moved!, ...leaf.tabs.slice(insertAt)]
    leaf.active = moved!.id
  })
  return { ...state, [fromKey]: splits, activePane: toPane }
}

/** Split the active pane (or the pane containing the active tab). */
export function splitPane(state: WorkbenchState, dir: 'row' | 'col'): WorkbenchState {
  const paneId = state.activePane ?? firstLeaf(state.splits).id
  const key = 'splits'
  return { ...state, [key]: splitLeafAt(state[key], paneId, dir) }
}

/**
 * Open a diff tab the VSCode way: an existing instance of the same change is
 * focused wherever it lives; otherwise the tab joins the first pane that
 * already holds diff tabs (diff panes are sticky — repeated clicks stack
 * there); on the FIRST diff of a layout the source pane splits vertically so
 * the diff lands in a fresh pane below it ("默认在下半栏新增一个").
 *
 * This is split-tree placement surgery, not registry dispatch: the diff tab
 * descriptor's `dedupeKey` is `(tab) => tab.id`, and the existing-instance
 * check below is exactly that rule — the two agree by construction (asserted
 * in tests). Diff tabs minted by the Git view carry change-derived ids, so
 * the id check is the per-change dedupe.
 * @returns the new state, with the diff pane active.
 */
export function openDiffTab(state: WorkbenchState, sourcePaneId: string, tab: WorkbenchTab): WorkbenchState {
  const existingLeaf = leafWithTab(state.splits, tab.id)
  if (existingLeaf !== undefined) return activateTab(state, existingLeaf.id, tab.id)
  const diffLeaf = allLeaves(state.splits).find(leaf => leaf.tabs.some(candidate => candidate.type === 'diff'))
  if (diffLeaf !== undefined) {
    return {
      ...state,
      activePane: diffLeaf.id,
      splits: mapLeaf(state.splits, diffLeaf.id, (leaf) => {
        leaf.tabs = [...leaf.tabs, tab]
        leaf.active = tab.id
      }),
    }
  }
  // First diff: split the source pane, the diff tab in the new LOWER leaf.
  // (A stale sourcePaneId — its pane closed meanwhile — degrades to the
  // regular open path instead of dropping the tab into an orphaned leaf.)
  if (!allLeaves(state.splits).some(leaf => leaf.id === sourcePaneId)) {
    return openTabInPane(state, tab)
  }
  const result = insertLeafAt(state.splits, sourcePaneId, 'col', tab, false)
  return { ...state, splits: result.node, activePane: result.leafId }
}

/** Toggle a directory in the explorer expansion set. */
export function toggleExpanded(state: WorkbenchState, path: string): WorkbenchState {
  const expanded = state.expanded.includes(path)
    ? state.expanded.filter(item => item !== path)
    : [...state.expanded, path]
  return { ...state, expanded }
}

/**
 * Reveal files in the explorer: expand every ancestor directory between the
 * explorer root and each file (so the lazy tree actually shows the row) and
 * record the paths for highlighting. The reveal set is transient —
 * sanitizeState never restores it, so a reload starts unhighlighted.
 * @param state - current workbench state.
 * @param cwd - the explorer's root (session working directory).
 * @param files - absolute paths to highlight (parent dirs are expanded).
 * @returns the next state, or the same reference when nothing is revealed.
 */
export function revealPaths(state: WorkbenchState, cwd: string | undefined, files: readonly string[]): WorkbenchState {
  const expanded = new Set(state.expanded)
  const revealed: string[] = []
  const rootParts = (cwd ?? '').split(/[\\/]+/).filter(part => part !== '')
  for (const file of files) {
    if (typeof file !== 'string' || file === '') continue
    revealed.push(file)
    const parts = file.split(/[\\/]+/).filter(part => part !== '' && part !== '.')
    const separator = file.includes('\\') ? '\\' : '/'
    // Keep the original leading separator(s) when rebuilding ancestor dirs:
    // FileTree matches expansion against ABSOLUTE paths, so dropping the
    // root (POSIX `/w/src` �W `w/src`) or a UNC prefix (`\\server\share`)
    // would leave every ancestor collapsed and the row unreachable.
    const prefix = file.startsWith('/') ? '/' : file.startsWith('\\\\') ? '\\\\' : file.startsWith('\\') ? '\\' : ''
    for (let i = rootParts.length; i < parts.length - 1; i++) {
      expanded.add(prefix + parts.slice(0, i + 1).join(separator))
    }
  }
  if (revealed.length === 0) return state
  return { ...state, expanded: [...expanded], revealed }
}

/** Adjust one split divider: `i` is the left/top child index, delta in fractions. */
export function resizeSplit(node: SplitNode, splitId: string, index: number, delta: number): SplitNode {
  if (node.kind === 'leaf') return node
  if (node.id === splitId) {
    const sizes = [...node.sizes]
    const left = Math.min(0.92, Math.max(0.08, sizes[index]! + delta))
    const right = Math.min(0.92, Math.max(0.08, sizes[index + 1]! - delta))
    sizes[index] = left
    sizes[index + 1] = right
    return { ...node, sizes }
  }
  return {
    ...node,
    sizes: [...node.sizes],
    children: node.children.map(child => resizeSplit(child, splitId, index, delta)),
  }
}

/** State-level {@link resizeSplit} route: the divider may live in either
 *  tree (split ids are globally unique). */
export function resizeSplitIn(state: WorkbenchState, splitId: string, index: number, delta: number): WorkbenchState {
  const key = 'splits'
  return { ...state, [key]: resizeSplit(state[key], splitId, index, delta) }
}


// ── The per-session store ──────────────────────────────────────────────────

const STORAGE_PREFIX = 'zenwit-workbench:v2'

/**
 * Cross-session panel width: the last dragged width, shared by EVERY
 * conversation (the panel width is a layout preference, not per-session
 * content). Written on every persist, read at session load and on
 * cache-hit session switches, so a drag in one conversation carries to all
 * the others (last drag wins).
 */
/** Immutable snapshot handed to React (replaced only on real changes). */
export interface WorkbenchSnapshot {
  project: string | undefined
  state: WorkbenchState | undefined
  /**
   * The current workbench prefs. Carried IN the snapshot (not a separate
   * subscription) so prefs changes re-render the consumers that gate on
   * them — the + menu hides a tab type the moment its switch flips.
   */
  prefs: WorkbenchPrefs
}

/**
 * URL escape hatch (#369): loading the app with `?dsh-workbench-reset` drops
 * the persisted layout for the session instead of restoring it. When a
 * restored tab hangs the page on mount (the #369 freeze loop), reloading
 * into the same state replays the hang forever; this param starts from the
 * default layout and clears the stored copy, breaking the loop. Persisting
 * resumes as soon as the param is gone from the URL.
 */
const RESET_PARAM = 'dsh-workbench-reset'

/** Whether the current page load asked for a persisted-state reset. */
function resetRequested(): boolean {
  try {
    return new URLSearchParams(window.location.search).has(RESET_PARAM)
  } catch {
    return false
  }
}

function loadState(project: string): WorkbenchState {
  const reset = resetRequested()
  if (reset) {
    try {
      localStorage.removeItem(`${STORAGE_PREFIX}:${project}`)
    } catch {
      // Storage unavailable: the default layout below is still the escape.
    }
  }
  if (!reset) {
    try {
      const raw = localStorage.getItem(`${STORAGE_PREFIX}:${project}`)
      if (raw !== null) {
        const parsed = JSON.parse(raw) as unknown
        // Seed the uid counter past the persisted ids (it resets on reload);
        // sanitize re-ids any duplicates the pre-seeding counter left behind.
        nextIdCounter = maxCounterId(parsed)
        const sanitized = sanitizeState(parsed)
        if (sanitized !== undefined) return sanitized
      }
    } catch {
      // Corrupt or unavailable storage: fall through to the default.
    }
  }
  return makeDefaultState()
}

/**
 * Structural validation of one persisted state. A malformed or stale shape
 * (older layouts, hand-edited storage) must fall back to the default instead
 * of crashing the panel on every reload; the restored width is also clamped
 * to the current viewport so a stale fullscreen width can never crush the
 * app shell (margin-right larger than the window) or cover the whole screen.
 * @returns a clean state, or undefined to fall back to the default.
 */
export function sanitizeState(parsed: unknown): WorkbenchState | undefined {
  if (parsed === null || typeof parsed !== 'object') return undefined
  const record = parsed as Record<string, unknown>
  if (typeof record.nextTerminal !== 'number' || !Number.isInteger(record.nextTerminal) || record.nextTerminal < 1) {
    return undefined
  }
  // nextBrowser arrived in a later build; a missing or malformed value on an
  // OLDER persisted state defaults to 1 so existing layouts keep loading
  // (unlike nextTerminal, which is strict — it predates the v1 shape).
  const nextBrowser = typeof record.nextBrowser === 'number' && Number.isInteger(record.nextBrowser) && record.nextBrowser >= 1
    ? record.nextBrowser
    : 1
  if (typeof record.activePane !== 'string' && record.activePane !== null) return undefined
  if (!Array.isArray(record.expanded) || record.expanded.some(item => typeof item !== 'string')) return undefined
  // Pane/split ids must be globally unique (the runtime uid counter is
  // shared), so a duplicate id gets a fresh one.
  const seen = new Set<string>()
  const reid = new Map<string, string>()
  // A persisted state from an older build has no split tree: an empty pane
  // keeps those layouts loading instead of failing the whole restore.
  const splits = pruneEmptyPanes(sanitizeNode(record.splits, seen, reid)
    ?? { kind: 'leaf' as const, id: uid('pane'), tabs: [], active: null })
  const requestedActivePane = typeof record.activePane === 'string'
    ? (reid.get(record.activePane) ?? record.activePane)
    : null
  const activePane = requestedActivePane === null
    ? null
    : allLeaves(splits).some(leaf => leaf.id === requestedActivePane)
      ? requestedActivePane
      : firstLeaf(splits).id
  return {
    // A stale duplicate pane id may have been re-ided; follow the rename so
    // new tabs still land in the pane the user was using.
    activePane,
    nextTerminal: record.nextTerminal,
    nextBrowser,
    expanded: record.expanded as string[],
    revealed: [],
    splits,
  }
}

/** Collapse persisted split panes left empty after ephemeral diff tabs are dropped. */
function pruneEmptyPanes(node: SplitNode): SplitNode {
  const leaves = allLeaves(node)
  if (!leaves.some(leaf => leaf.tabs.length > 0)) return node
  return leaves.reduce(
    (tree, leaf) => leaf.tabs.length === 0 ? removeLeafAt(tree, leaf.id) : tree,
    node,
  )
}

/**
 * One tree node id, deduplicated against the ids already seen in this
 * state. Duplicates are exactly the pre-seeding counter-reset corruption
 * (a "pane:1"/"split:1" minted after a reload beside the persisted ones):
 * keeping both would make mapLeaf visit two leaves at once and every open
 * would land in both panes, so the repeat gets a fresh id.
 * @returns the id to use (the original, or a fresh uid for repeats).
 */
function uniqueNodeId(id: string, seen: Set<string>, reid: Map<string, string>): string {
  if (!seen.has(id)) {
    seen.add(id)
    return id
  }
  const prefix = /^split:\d+$/.test(id) ? 'split' : 'pane'
  const fresh = uid(prefix)
  seen.add(fresh)
  reid.set(id, fresh)
  return fresh
}

/**
 * Validate one persisted tab record. @returns the clean tab, `'diff'` for an
 * ephemeral diff tab (dropped everywhere — diff tabs never survive a reload),
 * or undefined when the record is malformed (structural corruption when it
 * comes from a split-tree leaf; a malformed FLOAT tab only drops the window).
 */
function sanitizePersistedTab(tab: unknown): WorkbenchTab | 'diff' | undefined {
  if (tab === null || typeof tab !== 'object') return undefined
  const candidate = tab as Record<string, unknown>
  if (typeof candidate.id !== 'string' || typeof candidate.title !== 'string') return undefined
  if (candidate.type === 'diff') return 'diff'
  // Tab types are an open set (external plugins register their own); accept
  // any string type here — an unregistered type renders an <OrphanedTab/> at
  // view time and recovers if its plugin loads later.
  if (typeof candidate.type !== 'string') return undefined
  // The standalone explorer tab type merged INTO the editor (the single
  // files window): a persisted explorer tab reopens as an editor home tab —
  // no path, tree panel open (an existing meta object survives).
  if (candidate.type === 'explorer') {
    const meta = candidate.meta !== null && typeof candidate.meta === 'object' && !Array.isArray(candidate.meta)
      ? candidate.meta as Record<string, unknown>
      : undefined
    return { id: candidate.id, type: 'editor', title: 'Files', meta: { treeOpen: true, ...meta } }
  }
  // `meta` is plugin-owned JSON-serializable state (v0.12.0+): the persisted
  // value already went through JSON.parse, so it is inherently serializable —
  // carry it through verbatim (absent on older states).
  const result: WorkbenchTab = {
    id: candidate.id,
    type: candidate.type,
    title: candidate.title,
    ...(typeof candidate.path === 'string' ? { path: candidate.path } : {}),
    ...(candidate.meta !== undefined ? { meta: candidate.meta } : {}),
  }
  // `pin` (v0.17.0+): a pinned-terminal marker. Whitelist-validate the
  // shape so a hand-edited / corrupted pin never crashes the rail's
  // resolver: an unknown scope or a non-string homeCwd drops the pin
  // silently (the tab survives, just unpinned — the legacy behavior).
  // Pin is terminal-only: a non-terminal tab carrying a persisted pin
  // (e.g. from a hand-edited state) has it stripped here.
  const pin = (candidate as Record<string, unknown>).pin
  if (pin !== null && typeof pin === 'object' && !Array.isArray(pin) && result.type === 'terminal') {
    const pinRecord = pin as Record<string, unknown>
    if (pinRecord.scope === 'workspace' || pinRecord.scope === 'global') {
      const homeCwd = pinRecord.homeCwd
      result.pin = homeCwd === undefined || typeof homeCwd === 'string'
        ? { scope: pinRecord.scope, ...(typeof homeCwd === 'string' ? { homeCwd } : {}) }
        : { scope: pinRecord.scope }
    }
  }
  return result
}

/** Validate one split-tree node (leaf or split) and rebuild it cleanly. */
function sanitizeNode(node: unknown, seen: Set<string>, reid: Map<string, string>): SplitNode | undefined {
  if (node === null || typeof node !== 'object') return undefined
  const record = node as Record<string, unknown>
  if (record.kind === 'leaf') {
    if (typeof record.id !== 'string' || !Array.isArray(record.tabs)) return undefined
    const tabs: WorkbenchTab[] = []
    let droppedDiff = false
    for (const tab of record.tabs) {
      const clean = sanitizePersistedTab(tab)
      if (clean === undefined) return undefined
      if (clean === 'diff') {
        droppedDiff = true
        continue
      }
      tabs.push(clean)
    }
    const active = typeof record.active === 'string' ? record.active : null
    // An active pointer into a dropped diff tab is expected after the drop;
    // any other missing active is structural corruption → reset the state.
    if (active !== null && !tabs.some(tab => tab.id === active) && !droppedDiff) return undefined
    return { kind: 'leaf', id: uniqueNodeId(record.id, seen, reid), tabs, active: active !== null && tabs.some(tab => tab.id === active) ? active : null }
  }
  if (record.kind === 'split') {
    if (typeof record.id !== 'string' || (record.dir !== 'row' && record.dir !== 'col')) return undefined
    if (!Array.isArray(record.children) || !Array.isArray(record.sizes)) return undefined
    const children: SplitNode[] = []
    for (const child of record.children) {
      const clean = sanitizeNode(child, seen, reid)
      if (clean === undefined) return undefined
      children.push(clean)
    }
    if (children.length < 2) return undefined
    if (
      record.sizes.length !== children.length
      || record.sizes.some(size => typeof size !== 'number' || !Number.isFinite(size) || size <= 0)
    ) {
      return undefined
    }
    return { kind: 'split', id: uniqueNodeId(record.id, seen, reid), dir: record.dir, sizes: record.sizes as number[], children }
  }
  return undefined
}

/** The session-scoped store: one state per conversation, localStorage-backed. */
export class WorkbenchStore {
  private readonly byProject = new Map<string, WorkbenchState>()
  private snapshot: WorkbenchSnapshot = {
    project: undefined,
    state: undefined,
    prefs: { ...SIDEBAR_PREFS_DEFAULTS },
  }
  private readonly listeners = new Set<() => void>()
  /** Per-session persist debounce timers (v0.12.0+: one per session, so a
   *  targeted open never cancels another session's pending write). */
  private readonly persistTimers = new Map<string, number>()
  /** User-facing workbench prefs seeding brand-new session states (defaults until the settings RPC resolves). */
  private prefs: WorkbenchPrefs = { ...SIDEBAR_PREFS_DEFAULTS }
  /** The displayed conversation (not a key; see {@link setActiveSession}). */
  private activeSession: string | undefined

  /**
   * Replace the workbench prefs (the settings RPC result / settings page
   * write). Notifies like any store change: the snapshot carries the prefs,
   * so consumers that gate on enable switches (the + menu, derived flows)
   * re-render with the new values immediately.
   */
  setPrefs(prefs: WorkbenchPrefs): void {
    this.prefs = { ...prefs }
    this.snapshot = { ...this.snapshot, prefs: this.prefs }
    this.notify()
  }

  /** The current workbench prefs (seeds new sessions; persisted states win). */
  getPrefs(): WorkbenchPrefs {
    return { ...this.prefs }
  }

  /**
   * The conversation the workbench is currently displayed for. Not a key: the
   * layout belongs to the PROJECT. Views and the service read it to tell "the
   * user switched conversation" (park a terminal) from "the tab was closed"
   * (release it), and to scope host callbacks.
   */
  setActiveSession(sessionId: string | undefined): void {
    this.activeSession = sessionId
  }

  /** The conversation the workbench is displayed for (see {@link setActiveSession}). */
  getActiveSession(): string | undefined {
    return this.activeSession
  }

  /** Select a session (or none); loads its persisted state. */
  setProject(project: string | undefined): void {
    if (this.snapshot.project === project) return
    if (project === undefined) {
      this.snapshot = { project: undefined, state: undefined, prefs: this.prefs }
    } else {
      let state = this.byProject.get(project)
      if (state === undefined) {
        state = loadState(project)
        this.byProject.set(project, state)
      } else {
        // Cache hit: another session's load/ops may have left the uid
        // counter below THIS session's persisted ids — re-seed so fresh
        // pane/split ids can never collide with its tree.
        nextIdCounter = maxCounterId(state)
      }
      this.snapshot = { project, state, prefs: this.prefs }
    }
    this.notify()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getSnapshot(): WorkbenchSnapshot {
    return this.snapshot
  }

  /** Mutate the current session's state (no-op without a session). */
  update(mutator: (draft: WorkbenchState) => void): void {
    const project = this.snapshot.project
    const state = this.snapshot.state
    if (project === undefined || state === undefined) return
    const draft = structuredClone(state)
    mutator(draft)
    this.byProject.set(project, draft)
    this.snapshot = { project, state: draft, prefs: this.prefs }
    this.schedulePersist(project, draft)
    this.notify()
  }

  /**
   * Whether a tab still exists in its session's state. Views use this on
   * unmount to tell "the tab was closed" (release the terminal now) from
   * "the tree re-rendered / the conversation switched" (the tab is still
   * open — keep the terminal alive through the host's reconnect grace).
   * Checks the session's own map entry (the current snapshot may already
   * point at another session when a conversation switch unmounts the old
   * one's tabs).
   */
  tabOpen(project: string, tabId: string): boolean {
    const state = this.byProject.get(project)
      ?? (this.snapshot.project === project ? this.snapshot.state : undefined)
    return state !== undefined && tabOpenIn(state, tabId)
  }

  /**
   * Read-only view of EVERY cached session's state (v0.17.0+). The
   * PinnedRail uses this to collect pinned terminals across sessions
   * without each render reading private fields. The map is the live
   * `byProject` reference — callers MUST treat it as read-only (mutations
   * go through {@link reduce} / {@link reduceFor}). A session that has
   * never been visited in this run is absent (its pinned tabs are not
   * visible until first load — accepted as YAGNI by the design).
   */
  getProjectStates(): ReadonlyMap<string, WorkbenchState> {
    return new Map(this.byProject)
  }

  /** Apply a pure reducer (returns the next state). */
  reduce(reducer: (state: WorkbenchState) => WorkbenchState): void {
    const project = this.snapshot.project
    const state = this.snapshot.state
    if (project === undefined || state === undefined) return
    const next = reducer(state)
    // A reducer returning the SAME reference means "no change": skip the
    // persist + notify entirely — strict no-op paths (unknown tab ids,
    // patchTab on a missing tab) must not churn the state or rewrite
    // localStorage.
    if (next === state) return
    this.byProject.set(project, next)
    this.snapshot = { project, state: next, prefs: this.prefs }
    this.schedulePersist(project, next)
    this.notify()
  }

  /**
   * Apply a pure reducer to a TARGET session's state (not the active one),
   * loading it on demand and persisting the result — WITHOUT switching the
   * active snapshot or notifying (the UI must not follow along). Used by the
   * service's targeted `openTab(seed, scope)`: the open lands in the target
   * session's layout and is visible whenever the user switches to it.
   */
  reduceFor(project: string, reducer: (state: WorkbenchState) => WorkbenchState): void {
    // The uid counter is SHARED across sessions, and the ACTIVE session's
    // safety requires it to never drop below the ids IT minted. Seeding it
    // from the target's max may LOWER it (a cached target older than the
    // active session): restoring the pre-call level afterwards keeps the
    // active session's next mint collision-free — ids minted for the target
    // only need to exceed the target's own max, which the seed guaranteed.
    const counterBefore = nextIdCounter
    let state = this.byProject.get(project)
    if (state === undefined) {
      state = loadState(project)
      this.byProject.set(project, state)
    } else {
      // Re-seed the uid counter past THIS session's persisted ids, exactly
      // like setProject's cache-hit path.
      nextIdCounter = maxCounterId(state)
    }
    const next = reducer(state)
    // Same-reference result = no change: keep the counter restore (it may
    // have been seeded down) but skip the write.
    nextIdCounter = Math.max(nextIdCounter, counterBefore)
    if (next === state) return
    this.byProject.set(project, next)
    this.schedulePersist(project, next)
  }

  private schedulePersist(project: string, state: WorkbenchState): void {
    // Per-session debounce timers: one session's pending write must never
    // cancel another's (targeted opens schedule writes for INACTIVE
    // sessions while the active session may already have one pending —
    // a shared timer would drop the earlier write and the reload would
    // lose that session's layout).
    const existing = this.persistTimers.get(project)
    if (existing !== undefined) window.clearTimeout(existing)
    const timer = window.setTimeout(() => {
      this.persistTimers.delete(project)
      try {
        localStorage.setItem(`${STORAGE_PREFIX}:${project}`, JSON.stringify(state))
      } catch {
        // Storage full or unavailable: layout memory is best-effort.
      }
    }, 200)
    this.persistTimers.set(project, timer)
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener()
  }
}

/**
 * Create one workbench store instance. Production code calls this only from
 * the client plugin's `apply` (the instance is handed to components as a
 * prop); tests call it directly. No module-level singleton: the store's
 * lifetime belongs to the plugin activation, exactly like the official
 * `createXXXStore()` factory rule.
 */
export function createWorkbenchStore(): WorkbenchStore {
  return new WorkbenchStore()
}
