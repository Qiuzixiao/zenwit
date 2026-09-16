/** Slot-derived workbench props and the chat file-link service. */
import type { PropsRuntime, PropsRenderSlots, PropsLocale, InjectFace, HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ProjectApi } from './project-api.ts'
import type { WorkbenchKey } from './locales.ts'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspacePendingAction } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { DocumentRenderers } from './document-renderers.ts'
import type { WorkbenchEngineService } from './workbench/service.ts'
import type { WorkbenchStore } from './workbench/workbench-store.ts'

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

/**
 * Engine handles the shell hosts its left column with: the explorer renders
 * from the same store the workspace column's tabs use, so both stay one
 * workbench.
 */
export interface WorkbenchEngineHandles {
  /** Per-session engine store, shared by the explorer and the workspace column. */
  store: WorkbenchStore
  /** The engine registry service (file icons, tab registry); absent before the engine activates. */
  service?: WorkbenchEngineService | undefined
  /** Open one project file in the workspace column's editor tab. */
  openFile(path: string): void
  /** Add one project file or folder to the current conversation as a reference. */
  referenceFile(path: string, isDir: boolean): void
  /**
   * Hand the workspace column's mount region to the engine, or null when the
   * shell is on screen without it (home and project-library surfaces), which
   * keeps the workbench hidden instead of floating over those pages.
   * @param element - the region the engine fills, or null for "no region".
   */
  attachRegion(element: HTMLElement | null): void
  /**
   * Name the project whose layout the workbench shows, or null when none is
   * open. Tabs, panes and terminals belong to the project, so this is what
   * switches the workbench between projects.
   * @param project - the project's directory, or null to clear it.
   */
  setProject(project: string | null): void
}

/** Callbacks and observable sources owned by the plugin apply scope. */
export interface WorkbenchInjected {
  engine: WorkbenchEngineHandles
  api: ProjectApi
  request: typeof fetch
  documentRenderers: DocumentRenderers
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
  hooks: { panels: HostObservable<readonly Panel[]>; fileRequest: HostObservable<FileRequest | null>; fileRevision: HostObservable<number>; documentRendererRevision: HostObservable<number>; navigation: HostObservable<number>; pendingActions: HostObservable<readonly WorkspacePendingAction[]> }
}

/** The only shell child slots; settings and plugin panels keep their own owners. */
export type WorkbenchSlots = 'main' | 'sidebar.settings' | 'sidebar.panellist' | 'sidebar.footer.action' | 'shell.overlay' | 'sidebar.workspaces.directoryFlow' | 'conversation.hero.workspace.directoryFlow'
/** Root props supplied entirely by the Slot framework. */
export type WorkbenchProps = PropsRuntime<'root'> & PropsRenderSlots<WorkbenchSlots>
  & PropsLocale<'workbench'> & InjectFace<WorkbenchInjected>
/** Locale props threaded to local presentation components. */
export type CopyProps = PropsLocale<'workbench'>
