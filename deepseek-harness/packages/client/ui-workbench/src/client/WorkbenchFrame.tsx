/** Workbench shell; document lifecycle stays mounted while a plugin panel is selected. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Bell } from 'lucide-react'
import type { WorkbenchProps } from './contract.ts'
import { HomePage } from './HomePage.tsx'
import { ProjectLibraryPage } from './ProjectLibraryPage.tsx'
import { Workspace } from './Workspace.tsx'
import { SessionBrowser } from './SessionBrowser.tsx'
import css from './workbench.module.css'

type Surface = 'home' | 'library' | 'workspace'
function initialSurface(): Surface {
  try {
    const value = sessionStorage.getItem('zenwit.workbench.surface')
    return value === 'workspace' || value === 'library' ? value : 'home'
  } catch { return 'home' /* Storage may be disabled in a browser. */ }
}

/** @param props - root hooks, child slots and typed commands supplied by the renderer. */
export function WorkbenchFrame(props: WorkbenchProps) {
  const { t, api, renderSlot } = props
  const sessions = props.useSessions(state => state)
  const workspaceState = props.useWorkspaces(state => state)
  const panel = props.usePanelInfo(state => state.activePanelId)
  const panels = props.usePanels(value => value)
  const fileRequest = props.useFileRequest(value => value)
  const fileRevision = props.useFileRevision(value => value)
  const navigation = props.useNavigation(value => value)
  const seenNavigation = useRef(navigation)
  const pending = props.useSessionPendingInteraction(value => value)
  const pendingActions = props.usePendingActions(value => value)
  const attentionCount = [...pending.keys()].filter(id => sessions.byId[id] !== undefined && !workspaceState.archivedSessionIds.includes(id)).length
    + pendingActions.filter(action => !workspaceState.archivedSessionIds.includes(action.sessionId)).length
  const [activity, setActivity] = useState<'history' | 'pending'>()
  const closeActivity = useCallback(() => setActivity(undefined), [])
  const [picking, setPicking] = useState(false)
  const [adopting, setAdopting] = useState(false)
  const [error, setError] = useState<string>()
  const [surface, setSurface] = useState<Surface>(initialSurface)
  const [requestWorkspaceClose, setRequestWorkspaceClose] = useState<(() => void) | null>(null)
  const registerWorkspaceClose = useCallback((request: () => void) => {
    setRequestWorkspaceClose(() => request)
    return () => setRequestWorkspaceClose(current => current === request ? null : current)
  }, [])
  const projectPath = sessions.current === undefined ? undefined : sessions.byId[sessions.current]?.cwd
  useEffect(() => {
    try { sessionStorage.setItem('zenwit.workbench.surface', surface) } catch { /* Browsing remains usable without storage. */ }
  }, [surface])
  useEffect(() => { if (fileRequest !== null) setSurface('workspace') }, [fileRequest])
  useEffect(() => {
    if (navigation === seenNavigation.current) return
    seenNavigation.current = navigation
    setSurface('workspace')
    setActivity(undefined)
  }, [navigation])
  const home = (): void => { props.goHome(); setSurface('home') }
  const openProject = props.openProject
  const listProjects = useCallback(async () => {
    const projects = await api.list()
    const paths = new Set(projects.map(project => project.path))
    return [...projects, ...workspaceState.items.filter(workspace => !paths.has(workspace.path)).map(workspace => ({
      path: workspace.path, name: workspace.title, tags: [], updatedAt: Date.parse(workspace.updatedAt), canDelete: false, available: true,
    }))]
  }, [api, workspaceState.items])
  const picked = async (path: string): Promise<void> => {
    setAdopting(true); setError(undefined)
    try { await openProject(path); setPicking(false) }
    catch (reason) { setError(String(reason instanceof Error ? reason.message : reason)) }
    finally { setAdopting(false) }
  }
  useEffect(() => {
    const previous = document.title
    document.title = projectPath && surface === 'workspace' ? `${projectPath.split(/[/\\]/u).pop()} · ${t('workbench')}` : `${t('brand')} · ${t('workbench')}`
    return () => { document.title = previous }
  }, [projectPath, surface, t])
  const busy = sessions.phase !== 'ready' || workspaceState.phase !== 'ready'
  const showWorkspace = surface === 'workspace' && !!projectPath
  return <div className={css.frame} data-workbench-frame="true">
    {showWorkspace && <nav className={css.workbenchTools} aria-label={t('panels')}>
      <button className={css.workbenchBackButton} type="button" onClick={() => requestWorkspaceClose?.()} disabled={requestWorkspaceClose === null}><ArrowLeft size={16} />{t('legacy.012')}</button>
      {panels.map(item => <button type="button" key={item.id} aria-pressed={panel === item.id} onClick={() => props.selectPanel(item.id)}>
        {renderSlot('sidebar.panellist', { size: 16, active: panel === item.id }, { only: item.id })}{item.label}
      </button>)}
      <div className={css.globalActions}>
        <button type="button" title={t('attention')} aria-label={t('attention')} onClick={() => setActivity('pending')}><Bell size={17} /><span>{attentionCount}</span></button>
      </div>
    </nav>}
    <div className={css.workbenchSurface}>
      <div className={css.workbenchBody} hidden={panel !== null && !showWorkspace}>
        {showWorkspace ? <Workspace {...props} key={projectPath} projectPath={projectPath}
          fileRequest={fileRequest} fileRevision={fileRevision} closeProject={async () => { home() }}
          registerCloseRequest={registerWorkspaceClose} />
          : surface === 'workspace' && busy ? <main className={css.restoreSurface} role="status">{t('pending')}</main>
            : surface === 'library' ? <ProjectLibraryPage t={t} list={listProjects} openProject={openProject} deleteProject={api.remove} forgetProject={api.forget} onBack={home} />
              : <HomePage t={t} list={listProjects} create={api.create} updateProjectTags={api.updateTags}
                deleteProject={api.remove} forgetProject={api.forget} openProject={openProject} openFolder={() => { setError(undefined); setPicking(true) }} openLibrary={() => setSurface('library')} ready={!busy} />}
      </div>
      {panel !== null && !showWorkspace && <section className={css.pluginPage}>{renderSlot('main', {}, { entryKey: panel })}</section>}
    </div>
    {error !== undefined && <div role="alert" className={css.workbenchError}>{error}</div>}
    {renderSlot('sidebar.workspaces.directoryFlow', { open: picking, busy: adopting, onPicked: path => { void picked(path) }, onCancel: () => setPicking(false), onError: message => { setError(message); setPicking(false) } })}
    {activity !== undefined && <SessionBrowser {...props} mode={activity} projectPath={showWorkspace ? projectPath : undefined} onClose={closeActivity} />}
    <div className={css.shellOverlay}>{renderSlot('shell.overlay', {})}</div>
  </div>
}
