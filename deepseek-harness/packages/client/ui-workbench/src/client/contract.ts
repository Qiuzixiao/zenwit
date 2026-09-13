/** Slot-derived workbench props and the chat file-link service. */
import type { PropsRuntime, PropsRenderSlots, PropsLocale, InjectFace, HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ProjectApi } from './project-api.ts'
import type { WorkbenchKey } from './locales.ts'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspacePendingAction } from '@deepseek-ai/dsh-client-ui-workspace/client'

/** A file navigation request; sequence distinguishes repeated clicks. */
export interface FileRequest { path: string; line: number | undefined; sequence: number }

/** Chat and tool cards can open local files without depending on an editor. */
export interface WorkbenchFiles {
  /**
   * Reveal a file in the active workbench; remote URLs are rejected.
   * @param url - absolute path, relative project path, or file URL.
   * @param line - optional one-based line to reveal.
   */
  openFile(url: string, line?: number): void
}

declare module '@deepseek-ai/cordis' {
  interface Context { workbenchFiles: WorkbenchFiles }
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { workbench: WorkbenchKey }
}

/** Navigation row projected from live sidebar panel registrations. */
export interface Panel { id: MainPanelId; label: string }

/** Callbacks and observable sources owned by the plugin apply scope. */
export interface WorkbenchInjected {
  api: ProjectApi
  request: typeof fetch
  addSelectionToConversation(target: 'current' | 'new', text: string, label?: string, path?: string): Promise<void>
  openProject(path: string): Promise<void>
  goHome(): void
  openSession(id: SessionId): void
  startSession(id: WorkspaceId): void
  searchSessions: ISessions['search']
  renameSession(id: SessionId, title: string): Promise<void>
  archiveSession(id: SessionId): Promise<void>
  forkSession(id: SessionId): Promise<void>
  guardNavigation(guard: (cwd: string | undefined) => boolean | Promise<boolean>): () => void
  selectPanel(id: MainPanelId | null): void
  hooks: { panels: HostObservable<readonly Panel[]>; fileRequest: HostObservable<FileRequest | null>; fileRevision: HostObservable<number>; navigation: HostObservable<number>; pendingActions: HostObservable<readonly WorkspacePendingAction[]> }
}

/** The only shell child slots; settings and plugin panels keep their own owners. */
export type WorkbenchSlots = 'main' | 'sidebar.settings' | 'sidebar.panellist' | 'sidebar.footer.action' | 'shell.overlay' | 'sidebar.workspaces.directoryFlow' | 'conversation.hero.workspace.directoryFlow'
/** Root props supplied entirely by the Slot framework. */
export type WorkbenchProps = PropsRuntime<'root'> & PropsRenderSlots<WorkbenchSlots>
  & PropsLocale<'workbench'> & InjectFace<WorkbenchInjected>
/** Locale props threaded to local presentation components. */
export type CopyProps = PropsLocale<'workbench'>
