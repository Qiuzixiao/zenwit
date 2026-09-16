/**
 * Shared workbench preference vocabulary (types + constants), consumed by
 * BOTH halves: the host registers the schemastery schema over these values
 * (config.ts) and the client reads/writes them through the settings RPC
 * (client/prefs.ts, client/WorkbenchSettingsSection.tsx). Kept free of
 * schemastery so the browser bundle never pulls the schema runtime in.
 */

/** The user-settings namespace holding the workbench preferences. */
export const SIDEBAR_PREFS_NS = 'zenwit-workbench'

/** User-facing workbench preferences. */
export interface WorkbenchPrefs {
  /**
   * Whether the workbench auto-activates the Tasks page when the current
   * conversation spawns a new subagent.
   */
  autoOpenSubagent: boolean
  /**
   * Whether the workbench auto-activates the Tasks page containing the
   * background-jobs section when a NEW job appears for the current
   * conversation (any new job id, not just the first one).
   */
  autoOpenJobs: boolean
  /**
   * Whether the model-facing `workbench_open` tool is injected into the
   * model's toolset — one tool that lets the model actively open a local
   * file, a local folder (as a tree rooted there), or an HTTP(S) page in
   * the calling session's workbench. Off by default: the feature stays
   * dormant until the user explicitly enables it in the workbench settings.
   */
  agentOpenTools: boolean
  /**
   * Custom terminal font-family stack (a CSS font-family value, e.g.
   * `'JetBrains Mono', monospace`). Empty string follows the app's theme
   * monospace font (`--ds-font-family-code`). Applied live to every
   * terminal tab; configured under the terminal card's secondary settings.
   */
  terminalFontFamily: string
  /**
   * Custom terminal font size in px (9–32). Applied live to every terminal
   * tab; configured under the terminal card's secondary settings.
   */
  terminalFontSize: number
  /**
   * Whether the workbench's filesystem routes enforce the workspace fence:
   * every client-supplied path must resolve (through symlinks) inside the
   * session workspace, else the route answers 403 "outside workspace". On
   * by default; turning it OFF lets the file tree / editor read+write /
   * media / HTML preview / upload routes reach ANY host path (e.g. the
   * global ~/.dsh/AGENTS.md or a linked worktree outside the session cwd)
   * — the trade-off being that any same-origin script (including
   * third-party consumer plugins) can read/write outside the workspace
   * through those routes while it is off. The switch lives under the files
   * tab's settings strip in the workbench settings page; the fence error surfaces offer a
   * one-click global off + retry.
   */
  workspaceFence: boolean
  /**
   * The shell the UI and agent terminals spawn (absolute path or bare
   * executable name). Empty (default) keeps the legacy resolution order:
   * `cordis.patch.yml` `config.shell`, then `$SHELL` / login shell /
   * `powershell.exe` on Windows. Set it from the terminal card's gear in
   * the workbench settings (or the yaml) to pin a specific shell — takes
   * effect for terminals opened afterwards.
   */
  terminalShell: string
  /**
   * Explicit arguments for `terminalShell`, space-separated (empty keeps
   * the platform defaults; when set, they fully replace them — same
   * contract as the yaml `shellArgs`).
   */
  terminalShellArgs: string
  /**
   * Whether the HTML previewer drops its sandboxed iframe. Sandbox ON (the
   * default) renders previewed HTML in an opaque-origin iframe that cannot
   * touch the GUI; turning it OFF runs the previewed page with the GUI's
   * own origin — full read/write access to session files and internal
   * APIs. Only for trusted local content; the setting copy warns.
   */
  htmlViewerNoSandbox: boolean
  /**
   * Whether a newly opened HTML preview starts UNSANDBOXED (the per-surface
   * temporary unlock pre-applied). Off by default: previews open sandboxed
   * and the status row offers the one-tap unlock; when on, previews open
   * in the red unsandboxed state and the status row offers a one-tap
   * restore for the current file.
   */
  htmlViewerDefaultUnsafe: boolean
  /**
   * Whether the browser tab drops its sandboxed iframe. Sandbox ON (the
   * default) keeps browsed sites in an opaque origin with no GUI access;
   * turning it OFF runs any visited site with the GUI's own origin — it
   * can read session data and act as the logged-in GUI. Only for trusted
   * sites; the setting copy warns.
   */
  browserNoSandbox: boolean
  /**
   * MASTER switch: whether clicking an EXTERNAL link in the GUI (chat
   * messages, tool rows, prose mentions) is taken over into the workbench at
   * all. On by default; the per-protocol granularity lives in
   * `browserInterceptHttp` / `browserInterceptHttps` (the protocol flag
   * must also be on), and the target tab's own enable switch gates it too.
   * Ctrl/Cmd+click always bypasses the takeover. Kept as the master so old
   * documents keep their meaning with no migration (an explicit `false`
   * stays "never take over").
   */
  browserInterceptLinks: boolean
  /**
   * Whether clicking an http EXTERNAL link in the GUI opens the workbench
   * (the built-in browser tab, or a plugin tab that declares `urlTarget`)
   * instead of a new browser tab. On by default; gated on the
   * `browserInterceptLinks` master and the target tab's own enable switch.
   */
  browserInterceptHttp: boolean
  /**
   * Whether clicking an https EXTERNAL link in the GUI opens the workbench
   * instead of a new browser tab. OFF by default — most https sites (e.g.
   * GitHub) refuse iframe embedding, so the system browser is the smoother
   * default; gated on the `browserInterceptLinks` master and the target
   * tab's own enable switch.
   */
  browserInterceptHttps: boolean
  /**
   * Comma-separated allowlist of local (loopback) authorities the browser
   * tab may navigate to — `localhost`, `127.0.0.1`, `127.0.0.1:5174`, or
   * host:port pairs. Empty by default: loopback addresses stay blocked so a
   * browsed page cannot probe local services. Each entry is either a bare
   * hostname (all ports) or host:port; the GUI's own origin is always
   * allowed regardless. The iframe sandbox still renders allowed local
   * pages in an opaque origin, exactly like any other site.
   */
  browserAllowedLoopback: string
  /**
   * Per-tab enable switches, keyed by tab descriptor id (`'explorer'`,
   * `'my-plugin:db'`). An ABSENT key means enabled — only an explicit
   * `false` disables a tab type (hidden from the + menu, `openTab` refuses,
   * and derived flows like subagent auto-open / agent-terminal tabs stop).
   * Already-open tabs of a disabled type keep rendering (closing one
   * prevents reopening), matching the "existing conversations keep their
   * own layouts" rule.
   */
  tabsEnabled: Record<string, boolean>
  /**
   * Per-viewer enable switches, keyed by file viewer descriptor id
   * (`'image'`, `'my-plugin:csv'`). An ABSENT key means enabled; a disabled
   * viewer is skipped by `matchFileViewer` so files fall through to the
   * next matching viewer (or the download button when none match).
   */
  viewersEnabled: Record<string, boolean>
  /**
   * Plugin-owned settings blobs (v0.12.0+), keyed by descriptor id: each
   * registered tab/viewer that declares `settings.pluginToggles` (or writes
   * through `settings.render`'s `updatePluginSetting`) persists its values
   * here — an open map, so third-party keys need no host PrefsSchema field.
   * Values are JSON-serializable (the row controls produce strings /
   * numbers / booleans; custom panels are responsible for their own).
   */
  pluginSettings: Record<string, Record<string, unknown>>
}

/** Range contract of {@link WorkbenchPrefs.terminalFontSize}. */
export const TERMINAL_FONT_SIZE_MIN = 9
export const TERMINAL_FONT_SIZE_MAX = 32
export const TERMINAL_FONT_SIZE_DEFAULT = 13

/** Fallback prefs used whenever the settings document is unreachable or malformed. */
export const SIDEBAR_PREFS_DEFAULTS: WorkbenchPrefs = {
  autoOpenSubagent: true,
  autoOpenJobs: true,
  // Product decision: the model may put a file, folder or page on the user's
  // screen by default; the side-card settings keep the switch for users who
  // do not want the workbench to follow the model.
  agentOpenTools: true,
  terminalFontFamily: '',
  terminalFontSize: TERMINAL_FONT_SIZE_DEFAULT,
  workspaceFence: true,
  terminalShell: '',
  terminalShellArgs: '',
  htmlViewerNoSandbox: false,
  htmlViewerDefaultUnsafe: false,
  browserNoSandbox: false,
  browserInterceptLinks: true,
  browserInterceptHttp: true,
  browserInterceptHttps: false,
  browserAllowedLoopback: '',
  tabsEnabled: {},
  viewersEnabled: {},
  pluginSettings: {},
}

/** Clamp one terminal font size into the contract range (shared by schema and client reads). */
export function clampTerminalFontSize(value: number): number {
  return Math.min(TERMINAL_FONT_SIZE_MAX, Math.max(TERMINAL_FONT_SIZE_MIN, Math.round(value)))
}
