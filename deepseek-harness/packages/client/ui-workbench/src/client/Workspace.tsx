/**
 * Zenwit workspace shell.
 *
 * Three columns, as the product always had them: the file explorer, the
 * workbench engine's surface, and the conversation. The engine owns everything
 * inside its surface — tabs, editors, previews, changes, terminal — and mounts
 * its own React root into `[data-zenwit-workbench-surface]`. Its explorer is
 * published as a component, so the left column renders it from the same store
 * the center column's tabs use. First-level plugin panels (the market, the
 * account page) replace the engine surface while selected, the way the file
 * manager ceded the center to them.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PropsRuntime, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client';
import type { FileRequest, CopyProps, WorkbenchProps } from './contract.ts';
import type { DocumentRenderers } from './document-renderers.ts';
import { SessionBrowser } from './SessionBrowser.tsx';
import { ExplorerPane } from './workbench/WorkbenchExplorer.tsx';
import { IconNewChatOutline16 } from '@deepseek-ai/dsh-client-ui-primitives';
import { FolderOpen, History, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react';
import css from './workbench.module.css';
import { ScrollDots } from './ScrollDots.tsx';

const LEFT_DEFAULT = 240;
const LEFT_MIN = 190;
// Drag-to-collapse thresholds, mirroring the conversation column: dragging the
// divider below the collapse edge folds the column into its rail, and it only
// comes back once the drag passes the (wider) expand edge — so a collapse
// gesture cannot flicker between states at the boundary.
const LEFT_COLLAPSE = 160;
const LEFT_EXPAND = 200;
const RIGHT_DEFAULT = 500;
const RIGHT_MIN = 280;
const RIGHT_COLLAPSE = 200;
const RIGHT_EXPAND = 240;
const COLLAPSED_WIDTH = 44;
const CENTER_MIN = 240;

/** One workspace pane props: the engine surface's host and the conversation column. */
export type WorkspaceProps = PropsRuntime<'root'> & PropsRenderSlots<'main'> & CopyProps & Pick<WorkbenchProps, 'engine' | 'searchSessions' | 'renameSession' | 'archiveSession' | 'forkSession' | 'usePendingActions' | 'useNavigation' | 'useDocumentRendererRevision' | 'guardNavigation'> & {
    projectPath: string;
    closeProject: () => Promise<void>;
    registerCloseRequest?: (request: () => void) => () => void;
    openSession: (id: SessionId) => void;
    startSession: (workspaceId: WorkspaceId) => void;
    addSelectionToConversation: (target: 'current' | 'new', context: string, label?: string, path?: string) => Promise<void>;
    request: typeof fetch;
    documentRenderers: DocumentRenderers;
    fileRequest: FileRequest | null;
    fileRevision: number;
};

interface ResizeHandleProps {
    label: string;
    value: number;
    onStart: () => void;
    onDrag: (delta: number) => void;
}
/** Window-tracked column handle; drag deltas stay based on the gesture origin. */
function ResizeHandle({ label, value, onStart, onDrag }: ResizeHandleProps) {
    const origin = useRef(0);
    const [dragging, setDragging] = useState(false);
    const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0)
            return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        origin.current = event.clientX;
        onStart();
        setDragging(true);
    }, [onStart]);
    useEffect(() => {
        if (!dragging)
            return;
        const onPointerMove = (event: PointerEvent): void => {
            event.preventDefault();
            onDrag(event.clientX - origin.current);
        };
        const onPointerUp = (event: PointerEvent): void => {
            onDrag(event.clientX - origin.current);
            setDragging(false);
        };
        const onCancel = (): void => setDragging(false);
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp, { once: true });
        window.addEventListener('pointercancel', onCancel);
        window.addEventListener('blur', onCancel);
        return () => {
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('pointercancel', onCancel);
            window.removeEventListener('blur', onCancel);
        };
    }, [dragging, onDrag]);
    return (<div className={css.resizeHandle} role="separator" aria-label={label} aria-orientation="vertical" aria-valuenow={Math.round(value)} data-dragging={dragging || undefined} tabIndex={0} onPointerDown={onPointerDown}>
      <span className={css.resizeLine}/>
    </div>);
}

/** Explorer, engine surface and conversation column (see module doc). */
export function Workspace(props: WorkspaceProps) {
    const { projectPath, renderSlot, useSessions, useWorkspaces, usePanelInfo, startSession, engine, t } = props;
    const activePanel = usePanelInfo(state => state.activePanelId);
    const sessionsState = useSessions(s => s);
    const workspaceState = useWorkspaces(s => s);
    const projectWorkspace = workspaceState.items.find(w => w.path === projectPath);
    const [historyOpen, setHistoryOpen] = useState(false);
    const history = projectWorkspace === undefined
        ? []
        : projectWorkspace.sessionIds
            .map(id => sessionsState.byId[id])
            .filter((s): s is NonNullable<typeof s> => s !== undefined && !s.blank && !workspaceState.archivedSessionIds.includes(s.id))
            .sort((a, b) => b.updatedAt - a.updatedAt);
    const [leftWidth, setLeftWidth] = useState(LEFT_DEFAULT);
    const [leftCollapsed, setLeftCollapsed] = useState(false);
    const [rightWidth, setRightWidth] = useState(RIGHT_DEFAULT);
    const [rightCollapsed, setRightCollapsed] = useState(false);
    const navigationRevision = props.useNavigation(value => value);
    useEffect(() => { if (navigationRevision > 0) setRightCollapsed(false); }, [navigationRevision]);
    // The engine fills this region (it mounts its own tree/editor there), so
    // the column hands it over on mount and takes it back on unmount.
    const engineRegionRef = useRef<HTMLDivElement>(null);
    const attachRegion = engine.attachRegion;
    useEffect(() => {
        attachRegion(engineRegionRef.current);
        return () => attachRegion(null);
    }, [attachRegion]);
    // The workbench's tabs, panes and terminals belong to the PROJECT. The
    // project is NOT cleared on unmount: the engine keeps its React tree
    // mounted, so leaving the workspace (home surface, project switch) must
    // not unmount the tabs — that would release their terminals and drop
    // unsaved editor drafts.
    const setProject = engine.setProject;
    useEffect(() => {
        setProject(projectPath);
    }, [setProject, projectPath]);
    // The frame's back control asks the workspace to close itself; without this
    // registration the control stays disabled.
    const registerCloseRequest = props.registerCloseRequest;
    const closeProject = props.closeProject;
    useEffect(() => {
        if (typeof registerCloseRequest !== 'function')
            return;
        return registerCloseRequest(() => { void closeProject(); });
    }, [registerCloseRequest, closeProject]);
    const workspaceRef = useRef<HTMLDivElement>(null);
    const [workspaceWidth, setWorkspaceWidth] = useState<number | null>(null);
    useEffect(() => {
        const element = workspaceRef.current;
        if (element === null)
            return;
        const observer = new ResizeObserver(([entry]) => {
            if (entry !== undefined)
                setWorkspaceWidth(entry.contentRect.width);
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, []);
    const visibleLeftWidth = leftCollapsed ? COLLAPSED_WIDTH : leftWidth;
    // The grid's own content width, minus the two 14px handles: every ceiling
    // below is derived from this ONE measurement. Deriving the explorer's
    // ceiling from "whatever is left after the explorer's current width" makes
    // the ceiling shrink as the pane grows, so a drag held at the maximum
    // re-clamps against a moving budget every pointer move and the column
    // visibly oscillates. The conversation column never had that feedback
    // (its ceiling never subtracts its own width), which is why only the
    // explorer flickered.
    const usableWidth = Math.max(0, (workspaceWidth ?? (LEFT_DEFAULT + 28 + CENTER_MIN + RIGHT_DEFAULT)) - 28);
    const rightMinWidth = rightCollapsed ? COLLAPSED_WIDTH : RIGHT_MIN;
    const centerMin = Math.min(CENTER_MIN, Math.max(0, usableWidth - COLLAPSED_WIDTH - rightMinWidth));
    const rightMax = Math.max(COLLAPSED_WIDTH, usableWidth - visibleLeftWidth - centerMin);
    const visibleRightWidth = rightCollapsed ? COLLAPSED_WIDTH : Math.min(rightWidth, rightMax);
    // The explorer may grow until the workspace and the conversation column sit
    // at their minimums.
    const leftMax = Math.max(LEFT_MIN, usableWidth - centerMin - visibleRightWidth);
    const leftDragBase = useRef(LEFT_DEFAULT);
    const leftDragPreferred = useRef(LEFT_DEFAULT);
    const leftDragCollapsed = useRef(false);
    const resizeLeft = useCallback((delta: number) => {
        const requested = leftDragBase.current + delta;
        const collapsed = requested < (leftDragCollapsed.current ? LEFT_EXPAND : LEFT_COLLAPSE);
        leftDragCollapsed.current = collapsed;
        setLeftCollapsed(collapsed);
        // A collapse gesture preserves the width from before the gesture.
        setLeftWidth(collapsed ? leftDragPreferred.current : Math.max(LEFT_MIN, Math.min(requested, leftMax)));
    }, [leftMax]);
    const rightDragBase = useRef(RIGHT_DEFAULT);
    const rightDragPreferred = useRef(RIGHT_DEFAULT);
    const rightDragCollapsed = useRef(false);
    const resizeRight = useCallback((delta: number) => {
        const requested = rightDragBase.current - delta;
        const collapsed = requested < (rightDragCollapsed.current ? RIGHT_EXPAND : RIGHT_COLLAPSE);
        rightDragCollapsed.current = collapsed;
        setRightCollapsed(collapsed);
        // A collapse gesture preserves the width from before the gesture.
        setRightWidth(collapsed ? rightDragPreferred.current : Math.max(RIGHT_MIN, Math.min(requested, rightMax)));
    }, [rightMax]);
    const conversationControlRef = useRef<HTMLDivElement>(null);
    return (<div className={css.workspace} ref={workspaceRef} data-testid="workspace-grid" style={{ gridTemplateColumns: `${visibleLeftWidth}px 14px minmax(${centerMin}px, 1fr) 14px ${visibleRightWidth}px` }}>
      <div className={css.leftRail} data-collapsed={leftCollapsed || undefined}>
        {leftCollapsed && <button className={css.panelToggle} type="button" title={t('legacy.100')} aria-label={t('legacy.100')} aria-expanded={false} onClick={() => setLeftCollapsed(false)}><PanelLeftOpen size={16} aria-hidden="true"/></button>}
        <aside className={css.paneStructure} aria-label={t('legacy.101')} data-testid="workspace-explorer">
          <div className={css.structureHeader}>
            <div className={css.structureNavRow}>
              <div className={css.structureIdentity} title={projectPath}>
                <span className={css.structureProjectIcon} aria-hidden="true"><FolderOpen size={17} strokeWidth={1.7}/></span>
                <span className={css.structureIdentityText}>
                  <span className={css.structureEyebrow}>{t('legacy.104')}</span>
                  <strong className={css.structureTitle}>{projectPath.split(/[/\\]/u).pop() ?? projectPath}</strong>
                </span>
              </div>
              <button className={css.panelToggle} type="button" title={t('legacy.102')} aria-label={t('legacy.102')} aria-expanded={true} onClick={() => setLeftCollapsed(true)}><PanelLeftClose size={16} aria-hidden="true"/></button>
            </div>
          </div>
          {/* The engine's explorer, from the same store the center column uses. */}
          <div className={css.engineExplorer}>
            <ExplorerPane store={engine.store} projectPath={projectPath} sessionId={sessionsState.current ?? ''} service={engine.service} onOpenFile={engine.openFile} onReferenceFile={engine.referenceFile}/>
          </div>
        </aside>
      </div>
      <ResizeHandle label={t('legacy.136')} value={visibleLeftWidth} onStart={() => {
        leftDragBase.current = visibleLeftWidth;
        leftDragPreferred.current = leftWidth;
        leftDragCollapsed.current = leftCollapsed;
    }} onDrag={resizeLeft}/>
      <section className={css.paneEngine} aria-label={t('legacy.137')}>
        {/* The engine mounts its own root into this region (see its client entry). */}
        <div className={css.engineSurface} ref={engineRegionRef} data-zenwit-workbench-surface hidden={activePanel !== null}/>
        {activePanel !== null && <div className={css.pluginPage}>{renderSlot('main', {}, { entryKey: activePanel })}</div>}
      </section>
      <ResizeHandle label={t('legacy.198')} value={visibleRightWidth} onStart={() => {
        rightDragBase.current = visibleRightWidth;
        rightDragPreferred.current = rightWidth;
        rightDragCollapsed.current = rightCollapsed;
    }} onDrag={resizeRight}/>
      <aside className={css.paneChat} aria-label={t('legacy.199')} data-testid="workspace-conversation" data-collapsed={rightCollapsed || undefined}>
        {rightCollapsed && <button className={css.panelToggle} type="button" title={t('legacy.200')} aria-label={t('legacy.200')} aria-expanded={false} onClick={() => setRightCollapsed(false)}><PanelRightOpen size={16} aria-hidden="true"/></button>}
        <div className={css.conversationBar}>
          <div ref={conversationControlRef} className={css.conversationControl}>
            <button className={`${css.conversationAction} ${css.conversationPrimary}`} type="button" title={t('legacy.201')} aria-label={t('legacy.201')} disabled={projectWorkspace === undefined} onClick={() => {
            if (projectWorkspace === undefined)
                return;
            setHistoryOpen(false);
            startSession(projectWorkspace.workspaceId);
        }}>
              <IconNewChatOutline16 size={15}/>
              <span className={css.conversationPrimaryLabel}>{t('legacy.201')}</span>
            </button>
            <button className={`${css.conversationAction} ${css.conversationHistoryAction}`} type="button" aria-label={t('legacy.202', { value0: history.length })} aria-expanded={historyOpen} title={t('legacy.202', { value0: history.length })} onClick={() => { setHistoryOpen(open => !open); }}>
              <History size={15} strokeWidth={1.9} aria-hidden="true"/>
              <span className={css.historyCount} aria-hidden="true">{history.length}</span>
            </button>
          </div>
          <button className={css.panelToggle} type="button" title={t('legacy.203')} aria-label={t('legacy.203')} aria-expanded={true} onClick={() => setRightCollapsed(true)}><PanelRightClose size={16} aria-hidden="true"/></button>
        </div>
        {historyOpen && <SessionBrowser {...props} mode="history" projectPath={projectPath} onClose={() => setHistoryOpen(false)} />}
        {/* The project shell already binds this session to projectPath; keep
            both generic hero controls available for non-Zenwit shells. */}
        <div className={css.workspaceConversation} hidden={rightCollapsed}>
        {renderSlot('main', {}, { entryKey: 'conversation' })}
        </div>
      </aside>
      <ScrollDots root={workspaceRef} label={t('scroll')}/>
    </div>);
}
