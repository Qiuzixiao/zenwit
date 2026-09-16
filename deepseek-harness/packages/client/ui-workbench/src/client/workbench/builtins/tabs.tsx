/**
 * The built-in tab descriptors: the plugin registers its own pages
 * (editor / git — the unified changes tab / subagent / sidechat / terminal /
 * browser / diff) through
 * the same {@link WorkbenchEngineService} external plugins use — eating its
 * own dogfood. The terminal descriptor owns its quota (`TERMINAL_LIMIT`)
 * and mints `terminal:<uuid>` ids through `createTab`; the browser mints
 * `browser:<n>` the same way (no quota). The editor tab is the file view;
 * the explorer is the workspace's own left column.
 */
import type { Context } from '../workbench-context.ts'
import {
  browserTabIcon, changesTabIcon, filesTabIcon, sidechatTabIcon, tasksTabIcon, terminalTabIcon,
} from './tab-icons.tsx'
import { allLeaves, type WorkbenchState, type WorkbenchTab } from '../workbench-store.ts'
import { t } from '../locales.ts'
import { openWorkbenchFile } from '../intercept.tsx'
import { EditorHost } from '../WorkbenchEditor.tsx'
import { OpenWithSettings } from '../open-with-settings.tsx'
import { lazyChunkComponent } from '../lazy-chunk.tsx'
import { ChangesTab, opCountOf } from '../changes/ChangesTab.tsx'
import { DiffTab } from '../DiffTab.tsx'
import { SubagentView } from '../WorkbenchTasks.tsx'
import { consumeSidechatSeed, SideChatView, sidechatThreadIdOf } from '../WorkbenchSideChat.tsx'
import { api } from '../api.ts'
import { BrowserView } from '../WorkbenchBrowser.tsx'
import { TERMINAL_FONT_SIZE_MAX, TERMINAL_FONT_SIZE_MIN } from '../prefs-shared.ts'
import type { ComponentType } from 'react'
import type { SessionScope } from '../api.ts'
import type { WorkbenchStore } from '../workbench-store.ts'
import type { TabDescriptor } from '../service.ts'

/**
 * Lazy wrapper over the terminal view: xterm (and its stylesheet) is fetched
 * only when a terminal tab is first opened (see chunk-loader.ts). The
 * wrapper keeps the descriptor contract `(props) => ReactNode` — Workbench
 * calls it as a plain function.
 *
 * TerminalView's props are { scope, tabId, store } — `tabId` is NOT part of
 * TabComponentProps (it carries `tab: WorkbenchTab` instead), so the
 * descriptor maps it explicitly; a bare pass-through would leave tabId
 * undefined and the view's id checks would crash on `undefined`
 * (regression-pinned in tests/lazy-chunk.spec.tsx).
 */
const LazyTerminal = lazyChunkComponent<TerminalViewProps>(
  'terminal',
  (mod) => mod.TerminalView as ComponentType<TerminalViewProps> | undefined,
)

/** The terminal view's props (mirror of TerminalView's own signature). */
interface TerminalViewProps {
  scope: SessionScope
  tabId: string
  store: WorkbenchStore
  ptySession?: string | undefined
}

/**
 * The conversation that owns a terminal tab's shell. Stamped when the tab is
 * minted (see the service's openTab) because the layout is keyed by project:
 * without it, opening the same tab under another conversation would attach to
 * a different PTY.
 * @param tab - the terminal tab.
 * @returns the owning session id, or undefined for tabs minted before the field.
 */
function ptySessionOf(tab: WorkbenchTab): string | undefined {
  const value = (tab.meta as Record<string, unknown> | undefined)?.ptySession
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** How many UI-owned terminals may be open at once (agent-owned ones are uncapped). */
export const TERMINAL_LIMIT = 3

/** Optional per-registration builtin behavior (currently terminal title). */
export interface BuiltinTabOptions {
  /** Returns the display title for newly opened terminal tabs. */
  terminalTitle?: () => string
}

/** A client-side uuid for terminal tab identity (not shown in the UI). */
function terminalUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
}

/** Count UI-owned terminals (agent:` tabs excluded — they are the model's). */
function uiTerminalCount(state: WorkbenchState): number {
  return allLeaves(state.splits)
    .flatMap(leaf => leaf.tabs)
    .filter(tab => tab.type === 'terminal').length
}

/** The 6 built-in tab descriptors. */
export function builtinTabs(_ctx: Context, options: BuiltinTabOptions = {}): readonly TabDescriptor[] {
  return [
    {
      id: 'editor',
      description: () => t('guideDescFiles'),
      // The file view: one tab per open file. The explorer lives in the
      // workspace's own left column, so this type is never offered in the
      // + menu — files arrive here through the explorer and chat links.
      title: () => t('files'),
      icon: filesTabIcon,
      order: 10,
      hidden: true,
      dedupeKey: (tab) => tab.path,
      // Declarative settings: the workspace fence switch (the host's
      // containment guard over every workbench filesystem route) and the
      // "open with" configuration (SSH host + custom editors) as the custom
      // panel BELOW the rows — the settings seam renders rows first.
      settings: {
        toggles: [{
          key: 'workspaceFence',
          title: () => t('settingsFenceTitle'),
          desc: () => t('settingsFenceDesc'),
        }],
        render: ({ pluginSettings, updatePluginSetting }) => (
          <OpenWithSettings pluginSettings={pluginSettings} updatePluginSetting={updatePluginSetting} />
        ),
      },
      component: ({ ctx, store, scope, tab }) => (
        <EditorHost
          ctx={ctx}
          store={store}
          scope={scope}
          tab={tab}
        />
      ),
    },
    {
      // The unified changes tab (id kept as 'git' so persisted layouts keep
      // resolving): the Git lens is the former source-control panel; the
      // session lens is the former file-trace tab (PR #471). Both preview
      // through one shared diff stack. The badge reads the op-count cache
      // the tab's event poll publishes (the client ctx exposes no event
      // log, and the git status needs a fetch — both stay out of the badge).
      id: 'git',
      title: () => t('changes'),
      description: () => t('guideDescGit'),
      icon: changesTabIcon,
      order: 20,
      single: true,
      badge: (_ctx, scope) => {
        const count = opCountOf(scope.sessionId)
        return count === undefined || count === 0 ? null : count
      },
      component: ({ ctx, store, scope, tab, visible, onOpenDiff }) => (
        <ChangesTab
          ctx={ctx}
          store={store}
          scope={scope}
          tab={tab}
          visible={visible}
          onOpenFile={(path) => { openWorkbenchFile(ctx, store, scope.sessionId, path) }}
          onOpenDiff={onOpenDiff}
        />
      ),
    },
    {
      id: 'subagent',
      title: () => t('subagent'),
      description: () => t('guideDescSubagent'),
      icon: tasksTabIcon,
      order: 30,
      single: true,
      // Declarative settings: the auto-open switches render under this row in
      // the Workbench settings page (the Tasks page's related settings).
      settings: {
        toggles: [{
          key: 'autoOpenSubagent',
          title: () => t('settingsSubagentTitle'),
          desc: () => t('settingsSubagentDesc'),
        }, {
          key: 'autoOpenJobs',
          title: () => t('settingsJobsTitle'),
          desc: () => t('settingsJobsDesc'),
        }],
      },
      component: ({ ctx, scope, visible, onSubagentJump }) => (
        <SubagentView
          sessionId={scope.sessionId}
          ctx={ctx}
          active={visible}
          onOpenChild={(address) => { onSubagentJump?.(address.childSessionId) }}
        />
      ),
    },
    {
      id: 'sidechat',
      title: () => t('sideChat'),
      description: () => t('guideDescSidechat'),
      icon: sidechatTabIcon,
      order: 35,
      // Codex-style: EVERY side conversation is its own tab. A plain open
      // mints a fresh tab flagged `autoCreate` (the view creates the EMPTY
      // thread on mount); a thread switch from the header menu parks the
      // target id for a deterministic `sidechat:<threadId>` reattach tab.
      createTab: () => {
        const threadId = consumeSidechatSeed()
        if (threadId !== undefined) {
          return {
            tab: {
              id: `sidechat:${threadId}`,
              type: 'sidechat',
              title: t('sideChat'),
              meta: { threadId },
            },
          }
        }
        return {
          tab: {
            id: `sidechat:new-${crypto.randomUUID()}`,
            type: 'sidechat',
            title: t('sideChatUntitled'),
            meta: { autoCreate: true },
          },
        }
      },
      // One tab per thread: an already-open thread focuses instead of
      // duplicating; unbound fresh tabs never dedupe (each mints its own).
      dedupeKey: (tab) => sidechatThreadIdOf(tab),
      // Closing the tab releases the thread's live agent; the session and
      // its history stay persisted (reopen from any thread's header menu).
      onClose: (tab) => {
        const threadId = sidechatThreadIdOf(tab)
        if (threadId !== undefined) {
          void api.sidechatDispose(threadId).catch(() => {})
        }
      },
      component: ({ ctx, scope, tab, visible }) => (
        <SideChatView ctx={ctx} scope={scope} tab={tab} visible={visible} />
      ),
    },
    {
      id: 'terminal',
      title: () => t('terminal'),
      description: () => t('guideDescTerminal'),
      icon: terminalTabIcon,
      order: 40,
      available: (_ctx, _scope, state) => uiTerminalCount(state) < TERMINAL_LIMIT,
      // Declarative settings: the shell path/arguments and the custom font
      // family/size rows render under this card in the workbench settings page
      // (the font rows apply live to every terminal; the shell rows apply to
      // terminals opened afterwards).
      settings: {
        toggles: [{
          key: 'terminalShell',
          type: 'text',
          title: () => t('settingsShellTitle'),
          desc: () => t('settingsShellDesc'),
          placeholder: t('settingsShellPlaceholder'),
        }, {
          key: 'terminalShellArgs',
          type: 'text',
          title: () => t('settingsShellArgsTitle'),
          desc: () => t('settingsShellArgsDesc'),
          placeholder: t('settingsShellArgsPlaceholder'),
        }, {
          key: 'terminalFontFamily',
          type: 'text',
          title: () => t('settingsFontFamilyTitle'),
          desc: () => t('settingsFontFamilyDesc'),
          placeholder: t('settingsFontFamilyPlaceholder'),
        }, {
          key: 'terminalFontSize',
          type: 'number',
          title: () => t('settingsFontSizeTitle'),
          desc: () => t('settingsFontSizeDesc'),
          min: TERMINAL_FONT_SIZE_MIN,
          max: TERMINAL_FONT_SIZE_MAX,
          unit: 'px',
        }],
      },
      createTab: (state) => {
        const count = uiTerminalCount(state)
        if (count >= TERMINAL_LIMIT) return null
        return {
          tab: {
            id: `terminal:${terminalUuid()}`,
            type: 'terminal',
            title: options.terminalTitle?.() ?? t('terminal'),
          },
          // Keep the legacy counter advancing for compatibility with older
          // persisted states; new ids no longer use it.
          patch: { nextTerminal: state.nextTerminal + 1 },
        }
      },
      component: ({ tab, scope, store }) => <LazyTerminal scope={scope} store={store} tabId={tab.id} ptySession={ptySessionOf(tab)} />,
    },
    {
      id: 'browser',
      title: () => t('browser'),
      description: () => t('guideDescBrowser'),
      icon: browserTabIcon,
      order: 50,
      // Declarative settings: the sandbox escape hatch, the link-takeover
      // MASTER switch, and the per-protocol takeover switches (http on /
      // https off by default) render under this tab's row in the Workbench
      // settings page (the sandbox one is warned on).
      settings: {
        toggles: [{
          key: 'browserNoSandbox',
          title: () => t('settingsBrowserSandboxTitle'),
          desc: () => t('settingsBrowserSandboxDesc'),
        }, {
          key: 'browserInterceptLinks',
          title: () => t('settingsBrowserLinksTitle'),
          desc: () => t('settingsBrowserLinksDesc'),
        }, {
          key: 'browserInterceptHttp',
          title: () => t('settingsBrowserHttpTitle'),
          desc: () => t('settingsBrowserHttpDesc'),
        }, {
          key: 'browserInterceptHttps',
          title: () => t('settingsBrowserHttpsTitle'),
          desc: () => t('settingsBrowserHttpsDesc'),
        }, {
          key: 'browserAllowedLoopback',
          type: 'text',
          title: () => t('settingsBrowserLoopbackTitle'),
          desc: () => t('settingsBrowserLoopbackDesc'),
          placeholder: t('settingsBrowserLoopbackPlaceholder'),
        }],
      },
      createTab: (state) => ({
        tab: {
          id: `browser:${state.nextBrowser}`,
          type: 'browser',
          title: t('browser'),
        },
        patch: { nextBrowser: state.nextBrowser + 1 },
      }),
      component: (props) => <BrowserView {...props} />,
    },
    {
      id: 'diff',
      title: () => t('changes'),
      icon: changesTabIcon,
      order: -1,
      hidden: true,
      dedupeKey: (tab) => tab.id,
      component: ({ scope, tab }) => (
        tab.diff === undefined ? null
          : <DiffTab sessionId={scope.sessionId} cwd={scope.cwd} diff={tab.diff} />
      ),
    },
  ]
}
