/**
 * Cross-session pinned-terminal resolution (v0.17.0+).
 *
 * A pinned terminal tab lives in its HOME session's state (the only
 * authoritative copy) — switching sessions never copies or projects it.
 * The viewer session's TabBar renders the tabs OTHER sessions have pinned
 * as VIRTUAL tabs appended to the first leaf's tab list, so the user sees
 * them inline with their own tabs. Clicking a virtual tab activates it
 * in-place: TerminalView connects to the home session's PTY via WebSocket
 * (sessionId + tab query params resolve to the home PTY on the host side),
 * so the terminal renders in the current workbench without jumping sessions.
 *
 * Visibility rule:
 *
 * | pin.scope | visible when |
 * |-----------|--------------|
 * | `global`  | any session (cwd-independent) |
 * | `workspace` | `viewer.cwd === tab.pin.homeCwd` (both undefined match; viewer.cwd unknown → conservative visible) |
 *
 * The "viewer.cwd unknown → visible" branch is intentional: during
 * hydration the session summary may carry no cwd yet, and hiding pinned
 * workspace tabs on first paint would flash them away. Once the cwd
 * resolves, the next store notify re-runs the resolver with the real cwd.
 *
 * The viewer's OWN session is excluded: its pinned tabs are already on its
 * own tab strip, so rendering them again as virtual tabs would double-show.
 * Tabs whose `pin` field is missing or whose `type` is not `'terminal'` are
 * ignored — only terminal tabs can be pinned.
 */
import type { WorkbenchState, WorkbenchTab, SplitNode } from './workbench-store.ts'

/** A pinned terminal surfaced to the viewer, paired with its home session. */
export interface PinnedTabEntry {
  tab: WorkbenchTab
  homeProject: string
}

/** A viewer's project identity for visibility resolution. */
export interface PinnedViewer {
  /** The project the viewer is showing (its own pins are already on its strip). */
  project: string
  cwd: string | undefined
}

/** The home scope stored on a pinned virtual tab's meta: the project that
 *  owns the tab's state, the conversation that owns its PTY, and the original
 *  tab id (TerminalView's `tab` param). */
export interface PinnedHomeScope {
  /** The project whose state holds the tab (the store key). */
  project: string
  /** The conversation the shell belongs to. */
  sessionId: string
  cwd: string | undefined
  /** The original tab id in the home project (TerminalView's `tab` param). */
  tabId: string
}

const PINNED_META_KEY = '__pinnedHome'
const PINNED_VID_PREFIX = 'pinned:'

/** Whether a tab id is a pinned virtual id (prefixed). */
export function isPinnedVirtualId(tabId: string): boolean {
  return tabId.startsWith(PINNED_VID_PREFIX)
}

/**
 * Stable, colon-free key for one project. The virtual id must stay a single
 * token: a project path contains `/` and (on Windows) `:`, so the id carries
 * this hash instead of the path itself.
 * @param project - the project directory.
 * @returns a base-36 hash of the path.
 */
function projectKey(project: string): string {
  let hash = 2166136261
  for (let index = 0; index < project.length; index += 1) {
    hash ^= project.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

/** Parse a pinned virtual id into its project key and original tab id.
 *  Format: `pinned:<projectKey>:<originalTabId>`. The project itself travels
 *  in the virtual tab's meta (see {@link getPinnedHomeScope}). */
export function parsePinnedVirtualId(tabId: string): { homeKey: string; tabId: string } {
  const rest = tabId.slice(PINNED_VID_PREFIX.length)
  const sep = rest.indexOf(':')
  if (sep < 0) return { homeKey: rest, tabId: '' }
  return { homeKey: rest.slice(0, sep), tabId: rest.slice(sep + 1) }
}

/** Extract the home scope from a pinned virtual tab's meta (undefined for
 *  regular tabs). */
export function getPinnedHomeScope(tab: WorkbenchTab): PinnedHomeScope | undefined {
  const meta = tab.meta as Record<string, unknown> | undefined
  return (meta?.[PINNED_META_KEY] as PinnedHomeScope | undefined) ?? undefined
}

/** Whether a tab is a pinned virtual tab (injected from another session). */
export function isPinnedVirtualTab(tab: WorkbenchTab): boolean {
  return getPinnedHomeScope(tab) !== undefined
}

/** Create a virtual WorkbenchTab for a pinned entry. The virtual id is unique
 *  (prefixed with the home project's key) to avoid collision with the viewer's
 *  own tab ids; the rest of the home scope is stored in meta. */
export function createPinnedVirtualTab(entry: PinnedTabEntry): WorkbenchTab {
  const { tab, homeProject } = entry
  const ptySession = (tab.meta as Record<string, unknown> | undefined)?.ptySession
  const home: PinnedHomeScope = {
    project: homeProject,
    // The PTY belongs to the conversation the terminal was opened in; the
    // project key only locates the tab's state.
    sessionId: typeof ptySession === 'string' ? ptySession : '',
    cwd: tab.pin?.homeCwd,
    tabId: tab.id,
  }
  return {
    ...tab,
    id: PINNED_VID_PREFIX + projectKey(homeProject) + ':' + tab.id,
    meta: { ...(tab.meta as Record<string, unknown> | undefined ?? {}), [PINNED_META_KEY]: home },
  }
}

/** Inject pinned virtual tabs into the first leaf of a split tree, and
 *  override that leaf's `active` when a pinned tab is activated. Returns
 *  the original tree when there are no pinned tabs and no active override. */
export function injectPinnedIntoTree(
  tree: SplitNode,
  pinned: readonly WorkbenchTab[],
  activePinnedId: string | null,
): SplitNode {
  if (pinned.length === 0 && activePinnedId === null) return tree
  if (tree.kind === 'leaf') {
    return {
      ...tree,
      tabs: pinned.length > 0 ? [...tree.tabs, ...pinned] : tree.tabs,
      active: activePinnedId ?? tree.active,
    }
  }
  return {
    ...tree,
    children: [
      injectPinnedIntoTree(tree.children[0]!, pinned, activePinnedId),
      ...tree.children.slice(1),
    ],
  }
}

/**
 * Whether a pinned tab is visible to the viewer session. Conservative on
 * unknown cwd: a `workspace` pin with no `homeCwd` is visible everywhere
 * (the pin was set before the home session's cwd resolved), and a viewer
 * whose cwd is unknown sees every workspace pin (avoids hydration flash).
 */
export function pinnedVisibleTo(tab: WorkbenchTab, viewer: PinnedViewer): boolean {
  const pin = tab.pin
  if (pin === undefined) return false
  if (pin.scope === 'global') return true
  // workspace scope
  const home = pin.homeCwd
  if (home === undefined) return true
  if (viewer.cwd === undefined) return true
  return viewer.cwd === home
}

/**
 * Collect every pinned terminal visible to the viewer across ALL cached
 * session states. Excludes the viewer's own session (those tabs are on its
 * own strip). Order is stable: sessions in the cache's insertion order,
 * tabs in tree order within each session — the order tabs were
 * opened/pinned, so the rail never reorders between renders.
 */
export function collectPinnedTabs(
  byProject: ReadonlyMap<string, WorkbenchState>,
  viewer: PinnedViewer,
): PinnedTabEntry[] {
  const entries: PinnedTabEntry[] = []
  for (const [homeProject, state] of byProject) {
    if (homeProject === viewer.project) continue
    collectFromTree(state.splits, homeProject, viewer, entries)
  }
  return entries
}

/** Walk one split tree depth-first, collecting visible pinned terminals. */
function collectFromTree(
  node: SplitNode,
  homeProject: string,
  viewer: PinnedViewer,
  out: PinnedTabEntry[],
): void {
  if (node.kind === 'leaf') {
    for (const tab of node.tabs) {
      if (tab.type === 'terminal' && pinnedVisibleTo(tab, viewer)) {
        out.push({ tab, homeProject })
      }
    }
    return
  }
  for (const child of node.children) collectFromTree(child, homeProject, viewer, out)
}
