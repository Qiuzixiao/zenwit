/** Sole browser root: generic projects, editing and slot-composed conversation. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { FileRequest, Panel, WorkbenchInjected, WorkbenchFiles } from './contract.ts'
import { WorkbenchFrame } from './WorkbenchFrame.tsx'
import { createDocumentRenderers } from './document-renderers.ts'
import { registerBuiltinRenderers } from './builtin-renderers.ts'
import { projectApi } from './project-api.ts'
import { resolveFilePath } from './workspace-files.ts'
import { en, zh } from './locales.ts'

export type { WorkbenchFiles } from './contract.ts'

/** Required typed capabilities; visual owners arrive through declared slots. */
export const inject = ['slots', 'locale', 'layout', 'sessions', 'workspaces', 'uiWorkspace', 'conversation', 'inputTriggers']

/**
 * Window that collapses a burst of project filesystem changes into one revision
 * bump. Consumers answer a bump with a full structure reload, so the window
 * bounds scans per second instead of per changed file.
 */
const FILE_CHANGE_COALESCE_MS = 250

/**
 * Install the standalone root and its file-link service with fiber-owned teardown.
 * @param ctx - current browser plugin context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('workbench', { en, zh }), 'workbench: locale')
  const t = ctx.locale.bind('workbench')
  const fileRequest = createSnapshotStore<FileRequest | null>(null)
  const panels = createSnapshotStore<readonly Panel[]>([])
  const fileRevision = createSnapshotStore(0)
  const documentRenderers = createDocumentRenderers()
  const documentRendererRevision = createSnapshotStore(0)
  let sequence = 0
  const files: WorkbenchFiles = {
    openFile(url, line) {
      const list = ctx.sessions.list.getSnapshot()
      const cwd = list.current === undefined ? undefined : list.byId[list.current]?.cwd
      const path = resolveFilePath(url, cwd)
      fileRequest.set({ path, line, sequence: ++sequence })
      ctx.layout.selectPanel(null)
    },
  }
  ctx.effect(() => {
    const dispose = ctx.reflect.provide('workbenchFiles', files)
    return () => { void dispose() }
  }, 'workbench: file links')
  ctx.effect(() => {
    const offRevision = documentRenderers.subscribe(() => documentRendererRevision.set(documentRenderers.revision))
    const disposeBuiltins = registerBuiltinRenderers(documentRenderers)
    const dispose = ctx.reflect.provide('documentRenderers', documentRenderers)
    return () => { offRevision(); void dispose(); disposeBuiltins() }
  }, 'workbench: document renderers')
  ctx.effect(() => ctx.inputTriggers.registerSource({
    trigger: '@', name: 'workbench-selection', order: -1,
    candidates: async () => [], onPick: () => undefined,
    codec: {
      clipboardText: () => t('files'),
      async serialize(ref) {
        const value: unknown = JSON.parse(ref)
        if (value === null || typeof value !== 'object' || !('text' in value) || typeof value.text !== 'string') throw new Error('Invalid selection reference')
        const path = 'path' in value && typeof value.path === 'string' ? value.path : ''
        const escape = (text: string): string => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
        return `<file_reference path="${escape(path)}">\n${escape(value.text)}\n</file_reference>`
      },
    },
  }), 'workbench: editor references')
  ctx.effect(() => {
    let projectPath: string | undefined
    let events: EventSource | undefined
    let pending: ReturnType<typeof setTimeout> | undefined
    // One project scan costs the host a full tree walk, so a burst of change
    // events (a build writing thousands of files) must not drive one scan each.
    const bump = (): void => {
      pending = undefined
      fileRevision.set(fileRevision.getSnapshot() + 1)
    }
    const follow = (): void => {
      const list = ctx.sessions.list.getSnapshot()
      const next = list.current === undefined ? undefined : list.byId[list.current]?.cwd
      if (next === projectPath) return
      events?.close()
      events = undefined
      projectPath = next
      if (next === undefined || typeof EventSource === 'undefined') return
      events = new EventSource('/api/desktop/projects/changes?path=' + encodeURIComponent(next))
      events.onmessage = () => {
        if (pending === undefined) pending = setTimeout(bump, FILE_CHANGE_COALESCE_MS)
      }
    }
    const offSessions = ctx.sessions.list.subscribe(follow)
    follow()
    return () => {
      offSessions()
      events?.close()
      if (pending !== undefined) clearTimeout(pending)
    }
  }, 'workbench: project change feed')
  const detachWorkspace = async (path: string): Promise<void> => {
    const workspace = ctx.workspaces.list.getSnapshot().items.find(item => item.path === path)
    if (workspace === undefined) return
    const current = ctx.sessions.list.getSnapshot().current
    await ctx.workspaces.delete(workspace.workspaceId)
    if (current !== undefined && workspace.sessionIds.includes(current)) ctx.sessions.clear()
  }
  const injected: WorkbenchInjected = {
    api: {
      ...projectApi,
      async updateTags(path, tags) { await projectApi.adopt(path); return projectApi.updateTags(path, tags) },
      async remove(path) { await projectApi.remove(path); await detachWorkspace(path) },
      async forget(path) { await projectApi.forget(path); await detachWorkspace(path) },
    },
    request: (input, init) => fetch(input, init),
    documentRenderers,
    async openProject(path) {
      if (ctx.sessions.list.getSnapshot().phase !== 'ready' || ctx.workspaces.list.getSnapshot().phase !== 'ready') throw new Error(t('pending'))
      const navigation = ctx.layout.beginNavigation()
      await projectApi.adopt(path)
      if (navigation.aborted) return
      const workspace = await ctx.workspaces.create({ path })
      if (navigation.aborted) return
      const list = ctx.sessions.list.getSnapshot()
      const archived = ctx.workspaces.list.getSnapshot().archivedSessionIds
      const previous = workspace.sessionIds.map(id => list.byId[id])
        .filter((item): item is NonNullable<typeof item> => item !== undefined && !archived.includes(item.id))
        .sort((a, b) => Number(a.blank) - Number(b.blank) || b.updatedAt - a.updatedAt)[0]
      if (previous !== undefined) ctx.uiWorkspace.openSession(previous.id)
      else await ctx.uiWorkspace.openWorkspace(workspace.workspaceId)
    },
    goHome() { ctx.layout.beginNavigation(); ctx.layout.selectPanel(null) },
    openSession(id) { ctx.uiWorkspace.openSession(id) },
    startSession(id) { ctx.uiWorkspace.startSession(id) },
    searchSessions: (query, signal) => ctx.sessions.search(query, signal),
    async renameSession(id, title) {
      const session = ctx.sessions.binding(id)?.session
      if (session === undefined) throw new Error(t('failed'))
      const result = await session.rename(title)
      if (!result.ok) throw new Error(result.error.message)
    },
    async archiveSession(id) {
      if (ctx.sessions.list.getSnapshot().current === id) {
        const workspace = ctx.workspaces.list.getSnapshot().items.find(item => item.sessionIds.includes(id))
        if (workspace !== undefined) await ctx.uiWorkspace.openWorkspace(workspace.workspaceId)
      }
      await ctx.uiWorkspace.archiveSession(id)
    },
    forkSession: id => ctx.uiWorkspace.forkSession(id),
    guardNavigation: guard => ctx.uiWorkspace.guardNavigation(guard),
    selectPanel(id) { ctx.layout.selectPanel(id) },
    async addSelectionToConversation(target, text, label = t('files'), path) {
      let id = ctx.sessions.list.getSnapshot().current
      if (target === 'new') {
        const workspace = ctx.workspaces.list.getSnapshot().items.find(item => id !== undefined && item.sessionIds.includes(id))
        if (workspace === undefined) throw new Error(t('pending'))
        id = await ctx.sessions.create({ workspaceId: workspace.workspaceId })
      }
      if (id === undefined) throw new Error(t('pending'))
      const scope = ctx.sessions.scope(id)
      if (scope === undefined) throw new Error(t('pending'))
      const input = ctx.conversation.input.for(scope)
      const state = input.state.getSnapshot()
      const inserted = input.insertReference({ source: 'workbench-selection', ref: JSON.stringify({ text, path }), label, clipboardText: label, appearance: 'file' },
        { start: state.draft.length, end: state.draft.length, draftRev: state.draftRev })
      if (!inserted) throw new Error(t('failed'))
      if (target === 'new') ctx.uiWorkspace.openSession(id)
    },
    hooks: { panels, fileRequest, fileRevision, documentRendererRevision, navigation: ctx.uiWorkspace.navigation, pendingActions: ctx.uiWorkspace.pendingActions },
  }
  ctx.effect(() => ctx.slots.register({
    name: 'root', locale: 'workbench',
    children: {
      main: { kind: 'keyed', scope: 'root' },
      'sidebar.settings': { kind: 'single', scope: 'root' },
      'sidebar.panellist': { kind: 'list', scope: 'root' },
      'sidebar.footer.action': { kind: 'list', scope: 'root' },
      'sidebar.workspaces.directoryFlow': { kind: 'single', scope: 'root' },
      'conversation.hero.workspace.directoryFlow': { kind: 'single', scope: 'root' },
      'shell.overlay': { kind: 'list', scope: 'root' },
    },
    inject: () => injected,
  }, WorkbenchFrame), 'workbench: root')
  ctx.effect(() => {
    const update = (): void => {
      const next = ctx.slots.entriesOfSlot('sidebar.panellist').map(({ options }) => ({
        id: options.id as MainPanelId,
        label: resolveSlotLabel(options.label) ?? options.id ?? '',
      }))
      const previous = panels.getSnapshot()
      if (previous.length !== next.length || next.some((item, index) => item.id !== previous[index]?.id || item.label !== previous[index]?.label)) panels.set(next)
    }
    const offSlots = ctx.slots.subscribe('sidebar.panellist', update)
    const offLocale = ctx.locale.subscribe(update)
    update()
    return () => { offSlots(); offLocale() }
  }, 'workbench: panel navigation')
}
