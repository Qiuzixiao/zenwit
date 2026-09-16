/**
 * Client half of zenwit-workbench: resolves the user's workbench
 * preferences through the plugin's own fenced settings route, mounts the
 * right workbench portal (inside an error boundary so a rendering failure
 * shows an error strip instead of a blank panel), registers the turn-tail
 * interception, and contributes the workbench settings section to the DSH
 * Settings shell. Requires the runtime's slots and sessions services; the
 * bundle itself is a module-table consumer only (react + ui-primitives +
 * xterm, all provided or inlined).
 */
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Context } from './workbench-context.ts'
import { allLeaves, createWorkbenchStore, type WorkbenchStore } from './workbench-store.ts'
import { createWorkbenchEngineService, matchUrlTarget } from './service.ts'
import { revalidateChunksOnReactivate, setChunkModuleSystem } from './chunk-loader.ts'
import { registerBuiltins } from './builtins/index.ts'
import { Workbench } from './Workbench.tsx'
import { RenderBoundary } from './RenderBoundary.tsx'
import { registerTurnTailInterception } from './intercept.tsx'
import { registerLinkInterception } from './link-intercept.ts'
import { registerImeGuard } from './ime-guard.ts'
import { registerSettingsNavIcon } from './settings-nav-icon.ts'
import { loadBootDecision } from './prefs.ts'
import { WorkbenchSettingsSection } from './WorkbenchSettingsSection.tsx'
import { api } from './api.ts'
import { LOCALE_NS, attachLocale, t, zh, en } from './locales.ts'
import css from './workbench.module.css'
import './layout.css'

/** Services required before mounting (provided by the client runtime; the
 *  locale service backs the workbench's copy — see locales.ts). `modules`
 *  (rc.8+) is the client module system the chunk loader resolves its
 *  externals through; `connection` (0.1.2-alpha.2+) is the Remote transport's
 *  recovery lifecycle the side chat's disconnect banner reads — Cordis guards
 *  service access without inject. The `remote.session` namespace is NOT here:
 *  it mounts asynchronously, so the open-path interception reaches it through
 *  `ctx.inject` (see intercept.tsx). */
export const inject = ['slots', 'sessions', 'locale', 'modules', 'connection']

/**
 * Error boundary over the workbench tree (root scope): a render error in the
 * workbench SHELL itself must never blank the page silently — the shared
 * RenderBoundary shows a dismissible error strip and logs the stack. The
 * per-tab scope (Workbench.tsx) catches viewer/editor crashes first; this root
 * boundary stays as the last resort for Workbench/shell errors.
 */
/**
 * Client plugin body.
 * @param ctx - the client cordis context (slots, sessions).
 * @returns the per-session workbench store the shell hosts its explorer with.
 */
export function apply(ctx: Context): WorkbenchStore {
  // The workbench follows the DSH i18n system: attach the locale service so
  // the module-level t()/isZh() resolve the Host-backed language preference
  // (and switch live — the Workbench root subscribes to it), and register the
  // plugin's dictionaries into the shared locale registry. The disposers
  // run on fiber disposal, so re-activation (HMR) re-registers cleanly.
  attachLocale(ctx.locale)
  ctx.effect(() => {
    const offZh = ctx.locale.register(LOCALE_NS, 'zh', zh)
    const offEn = ctx.locale.register(LOCALE_NS, 'en', en)
    return () => { offZh(); offEn() }
  }, 'zenwit-workbench: dictionaries')

  // One store instance per activation: production code creates it only here,
  // then hands it to the mounted panel and closes over it in the slot
  // registrations (the official createXXXStore() factory rule — no
  // module-level singleton).
  const workbenchStore = createWorkbenchStore()
  // The region the shell hands over, plus the live mount's reaction to it.
  // Both outlive the effects below: the shell may hand its region over before
  // the engine mounts (boot order) or long after. `null` means the shell is on
  // screen without one (its home and project-library surfaces), which keeps the
  // workbench out of the page.
  const region: { current: HTMLElement | null; notify: (() => void) | undefined } = { current: null, notify: undefined }
  // The workbench registry service: external plugins register tab types and
  // file previewers through `ctx.workbenchEngine.registerTab/registerFileViewer`.
  // Published before the panel mounts so consumers injecting 'workbenchEngine'
  // are ready by the time the workbench renders.
  // The engine's public face carries the region handoff: the product owns the
  // region's lifetime (it appears with the workspace and disappears with the
  // home surface), so it tells the engine when to move in instead of the engine
  // polling the document.
  const service = createWorkbenchEngineService(workbenchStore, (element) => {
    region.current = element
    region.notify?.()
  })
  ctx.provide('workbenchEngine', service)
  // Terminal tab titles use the host's effective shell name (e.g. bash/zsh)
  // instead of "Terminal 1". Start with a safe fallback and replace it as
  // soon as the host shell info resolves. Tabs created before the response
  // arrives keep the fallback title, so also retitle any already-open UI
  // terminal tabs that still carry it.
  const fallbackTitle = t('terminal')
  let terminalTitle = fallbackTitle
  void api.shellGet().then(({ name }) => {
    terminalTitle = name
    const snapshot = service.getSnapshot()
    if (snapshot.state === undefined) return
    const tabs = allLeaves(snapshot.state.splits)
      .flatMap(leaf => leaf.tabs)
    for (const tab of tabs) {
      if (tab.type === 'terminal' && tab.title === fallbackTitle) {
        service.updateTab(tab.id, { title: name })
      }
    }
  }).catch(() => { /* keep fallback */ })
  // Register the plugin's own built-in tabs and viewers through the same
  // service (eating our own dogfood). The disposer unregisters them on
  // fiber disposal (HMR-safe).
  ctx.effect(
    () => registerBuiltins(ctx, service, { terminalTitle: () => terminalTitle }),
    'zenwit-workbench: register built-in tabs and viewers',
  )
  // A failure anywhere in the client lifecycle must never take the app down
  // silently: log with the plugin prefix and pin a visible diagnostic strip
  // to the page so a blank panel is never the only symptom. This strip is
  // the last-resort reporter (no CSS module is reachable from here), so its
  // colors go through skin token chains with the previous hexes as the
  // chain tails — worst case (no skin tokens on the page) it renders
  // byte-identical to the old hardcoded bar, and any `--dsw-alias-*` skin
  // re-themes it (guide §12: no hardcoded colors).
  const fail = (phase: string, error: unknown): void => {
    console.error(`[zenwit-workbench] ${phase} error:`, error)
    try {
      const bar = document.createElement('div')
      bar.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483000;max-width:70vw;padding:8px 12px;'
        + 'font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;'
        + 'color:var(--dsw-alias-state-error-primary,#f2a1a1);'
        + 'background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-base,#1b1b22));'
        + 'border:1px solid var(--dsw-alias-state-error-primary,#f2a1a1);border-radius:8px;white-space:pre-wrap'
      bar.textContent = `[zenwit-workbench] ${phase} error: ${error instanceof Error ? error.message : String(error)}`
      document.body.appendChild(bar)
    } catch {
      // Nothing left to report with.
    }
  }
  try {
    // rc.8+ exposes the client module system as the `ctx.modules` service;
    // the chunk loader needs it to resolve its externals, so inject it
    // before anything can load a lazy chunk.
    setChunkModuleSystem(ctx.get('modules'))
    // Fresh chunk state for this activation: drop per-test fixtures and
    // revalidate loaded chunk scripts against the bundle route's ETags —
    // unchanged chunks keep their resolved exports (no re-inject /
    // re-execute on HMR), changed ones are dropped for a clean re-fetch.
    void revalidateChunksOnReactivate()
    ctx.effect(() => {
      let disposed = false
      let root: Root | undefined
      let host: HTMLDivElement | undefined
      let mounted = false
      /** The region the workbench currently lives in (null: the shell has none). */
      let surface: HTMLElement | null = null
      const unmount = (): void => {
        if (!mounted) return
        mounted = false
        surface = null
        root?.unmount()
        root = undefined
        host?.remove()
        host = undefined
      }
      /** Render the workbench into the host. */
      const renderHost = (): void => {
        root?.render(createElement(RenderBoundary, { className: css.boundaryError ?? '' }, createElement(Workbench, {
          ctx,
          store: workbenchStore,
        })))
      }
      /**
       * Put the host inside the region the shell handed over, or take it out of
       * the document while the shell has none (its home and project-library
       * surfaces). The React tree stays mounted either way, so open tabs and
       * their terminals survive a trip to the home page.
       */
      const adoptSurface = (): void => {
        if (!mounted || host === undefined) return
        const next = region.current
        if (next === surface) return
        surface = next
        if (next === null) {
          host.remove()
          return
        }
        if (host.parentElement !== next) next.appendChild(host)
        renderHost()
      }
      const mount = (): void => {
        if (mounted || disposed) return
        try {
          host = document.createElement('div')
          host.setAttribute('data-zenwit-workbench', '')
          root = createRoot(host)
          mounted = true
          adoptSurface()
        } catch (error) {
          fail('mount', error)
        }
      }
      const sync = async (): Promise<void> => {
        if (disposed) return
        // Resolve the user's workbench prefs and the external-disable flag
        // from ONE settings fetch BEFORE the first session seeds, so a
        // brand-new conversation opens (or stays closed) at the chosen width
        // from first paint. A settings route failure falls back to the schema
        // defaults; the workbench still mounts (a stalled wire gives up after
        // the timeout and mounts on the defaults — the external-disable check
        // rides the same fetch, so one round trip covers both decisions).
        const decision = await Promise.race([
          loadBootDecision(api),
          new Promise<null>(resolve => { window.setTimeout(() => resolve(null), 2000) }),
        ])
        if (disposed) return
        if (decision !== null) workbenchStore.setPrefs(decision.prefs)
        mount()
      }
      void sync()
      // The shell drives adoption (it owns the region), so the engine only has
      // to react to the handoff.
      region.notify = adoptSurface
      // Live re-evaluation: the runtime broadcasts settings-document updates
      // (the aionui card saves through the same document). Best effort —
      // deployments without the 'remote' service fall back to boot-time
      // evaluation only.
      const remote = ctx.get('remote') as { $on?: (event: string, listener: () => void) => () => void } | undefined
      const offRemote = remote?.$on?.('settings/document-updated', () => { void sync() })
      return () => {
        disposed = true
        region.notify = undefined
        offRemote?.()
        unmount()
      }
    }, 'zenwit-workbench: workbench mount')

    ctx.effect(
      () => {
        try {
          return registerTurnTailInterception(ctx, workbenchStore)
        } catch (error) {
          fail('interception', error)
          return () => {}
        }
      },
      'zenwit-workbench: turn-tail interception',
    )

    ctx.effect(
      () => {
        try {
          // External http(s) links in the chat/GUI open the workbench instead
          // of a new window. Gated on the browserInterceptLinks MASTER pref,
          // the URL's protocol flag (browserInterceptHttp / Https — https
          // defaults OFF: most https sites refuse iframe embedding), and the
          // target tab's enable switch; Ctrl/Cmd+click always bypasses. The
          // target is the first registered tab whose `urlTarget` claims the
          // URL (enabled tabs only), else the built-in browser tab.
          const urlTargetOf = (url: URL): string | undefined => {
            const prefs = workbenchStore.getPrefs()
            const enabled = service.getTabs().filter(tab => prefs.tabsEnabled[tab.id] !== false)
            return matchUrlTarget(enabled, url)?.id
          }
          return registerLinkInterception({
            takeoverEnabled: (url) => {
              const prefs = workbenchStore.getPrefs()
              if (prefs.browserInterceptLinks === false) return false
              const protocolOn = url.protocol === 'https:'
                ? prefs.browserInterceptHttps !== false
                : prefs.browserInterceptHttp !== false
              if (!protocolOn) return false
              // A plugin claim is the target (already enabled-filtered);
              // otherwise the built-in browser must be enabled.
              return urlTargetOf(url) !== undefined || prefs.tabsEnabled['browser'] !== false
            },
            openInWorkbench: (url) => {
              let title: string | undefined
              try { title = new URL(url).hostname } catch { /* keep the default title */ }
              const type = urlTargetOf(new URL(url)) ?? 'browser'
              ctx.get('workbenchEngine')?.openTab({ type, url, title })
            },
            selfOrigin: window.location.origin,
          })
        } catch (error) {
          fail('interception', error)
          return () => {}
        }
      },
      'zenwit-workbench: link interception',
    )

    // The IME guard: composition keys (candidate arrows, confirm, cancel)
    // belong to the input method, never to page JS. Inlined third-party UI
    // (formerly Univer's office controls, #562 regression) has shipped
    // unguarded keydown handlers that hijack ArrowUp/ArrowDown and break
    // Chinese input; the document-capture guard neutralizes the whole class
    // before React or any native listener sees the event. Registered as
    // early as possible so no other capture-phase listener can win the
    // ordering race.
    ctx.effect(
      () => {
        try {
          return registerImeGuard()
        } catch (error) {
          fail('ime guard', error)
          return () => {}
        }
      },
      'zenwit-workbench: IME composition guard',
    )

    // DSH 0.1.x does not yet carry an icon through the settings.section
    // registration contract: its shell renders a generic gear for every
    // external section. Mark only this plugin's localized nav row so
    // layout.css can paint the requested workbench SVG; the disposer clears
    // the marker for HMR / plugin disable.
    ctx.effect(
      () => registerSettingsNavIcon(() => t('settingsNav')),
      'zenwit-workbench: settings navigation icon',
    )

    // The workbench settings section (nav label 工作台 / Workbench): appears in the DSH Settings shell
    // once the shell's declaration is on the ledger (slots.inject waits for
    // it); the section reads/writes the prefs through the plugin's own
    // fenced settings route, keeps the shared store in sync, and renders the
    // declarative enable/disable inventory from the tab/viewer registry.
    ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section',
      id: 'zenwit-workbench',
      order: 100,
      label: () => t('settingsNav'),
      inject: () => ({ store: workbenchStore, service }),
    }, WorkbenchSettingsSection))
  } catch (error) {
    fail('load', error)
  }
  // The store outlives this call: the product shell hosts the engine's
  // explorer beside the workspace column from the same per-session state.
  return workbenchStore
}
