/**
 * Zenwit workspace: three-pane project surface.
 * Left: project navigation, real file tree, and native settings. Center:
 * visual Markdown editing with an opt-in CodeMirror source mode. Right: session
 * controls plus the reused DSH conversation. Both column boundaries resize.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import type { PropsRuntime, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client';
import type { FileRequest, CopyProps, WorkbenchProps } from './contract.ts';
import { SessionBrowser } from './SessionBrowser.tsx';
import { IconNewChatOutline16 } from '@deepseek-ai/dsh-client-ui-primitives';
import { ChevronDown, ChevronRight, File, FileJson, FileText, Folder, FolderOpen, History, X, FilePlus, FolderPlus, RefreshCw, ChevronsDownUp, Copy, Pencil, Trash2, MessageSquare, Code2, Eye, Save, FolderSearch, MoreHorizontal, Terminal, Undo2, Redo2, Search, ChevronUp, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, } from 'lucide-react';
import { Editor, VisualEditor, type DocumentSelection, type EditorHistory, type EditorNavigation } from './Editor.tsx';
import css from './workbench.module.css';
import { documentKind, hasDocumentPreview, isBinaryDocument } from './document-types.ts';
import { DocumentPreview } from './preview/DocumentPreview.tsx';
import { ScrollDots } from './ScrollDots.tsx';
import { nodePath, nodeBasename, descendantSuffix, isProjectFilePath, readPersistedTabs, flattenFiles, filterTree, DOCUMENT_TABS_STORAGE_PREFIX } from './workspace-files.ts';
import type { TreeNode, StructureResponse, OpenDocument, PersistedDocumentTabs } from './workspace-files.ts';
interface NodeDialogState {
    mode: 'file' | 'directory' | 'rename';
    targetPath: string;
    initialName: string;
}
interface ContextMenuState {
    node: TreeNode | null;
    x: number;
    y: number;
}
/** One workspace pane props. */
export type WorkspaceProps = PropsRuntime<'root'> & PropsRenderSlots<'main' | 'sidebar.settings' | 'sidebar.footer.action'> & CopyProps & Pick<WorkbenchProps, 'searchSessions' | 'renameSession' | 'archiveSession' | 'forkSession' | 'usePendingActions' | 'useNavigation' | 'guardNavigation'> & {
    projectPath: string;
    closeProject: () => Promise<void>;
    registerCloseRequest?: (request: () => void) => () => void;
    openSession: (id: SessionId) => void;
    startSession: (workspaceId: WorkspaceId) => void;
    addSelectionToConversation: (target: 'current' | 'new', context: string, label?: string, path?: string) => Promise<void>;
    request: typeof fetch;
    fileRequest: FileRequest | null;
    fileRevision: number;
};
const LEFT_DEFAULT = 240;
const LEFT_MIN = 190;
const LEFT_MAX = 360;
const RIGHT_DEFAULT = 500;
const RIGHT_MIN = 280;
const RIGHT_COLLAPSE = 200;
const RIGHT_EXPAND = 240;
const COLLAPSED_WIDTH = 48;
const CENTER_MIN = 240;
function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}
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
/** Three-pane workspace (see module doc). */
export function Workspace(props: WorkspaceProps) {
    const { projectPath, closeProject, renderSlot, useSessions, useWorkspaces, usePanelInfo, startSession, addSelectionToConversation, request, fileRequest, fileRevision, t } = props;
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
    const [structure, setStructure] = useState<StructureResponse | null>(null);
    const structureRequest = useRef(0);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [documents, setDocuments] = useState<OpenDocument[]>([]);
    const [activePath, setActivePath] = useState<string | null>(null);
    const [pendingClosePath, setPendingClosePath] = useState<string | null>(null);
    const [leaving, setLeaving] = useState(false);
    const [leaveError, setLeaveError] = useState<string | null>(null);
    const [autoSave, setAutoSave] = useState(true);
    const [editorHistories, setEditorHistories] = useState<Record<string, EditorHistory | null>>({});
    const [editorNavigation, setEditorNavigation] = useState<Record<string, EditorNavigation | null>>({});
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [leftWidth, setLeftWidth] = useState(LEFT_DEFAULT);
    const [rightWidth, setRightWidth] = useState(RIGHT_DEFAULT);
    const [leftCollapsed, setLeftCollapsed] = useState(false);
    const [rightCollapsed, setRightCollapsed] = useState(false);
    const navigationRevision = props.useNavigation(value => value);
    useEffect(() => { if (navigationRevision > 0) setRightCollapsed(false); }, [navigationRevision]);
    const leaveDecision = useRef<((allow: boolean) => void) | null>(null);
    useEffect(() => props.guardNavigation(cwd => {
        if (cwd === projectPath || !documentsRef.current.some(document => document.dirty || document.saving)) return true;
        leaveDecision.current?.(false);
        return new Promise<boolean>(resolve => { leaveDecision.current = resolve; setLeaving(true); });
    }), [projectPath, props.guardNavigation]);
    useEffect(() => () => { leaveDecision.current?.(false); }, []);
    const finishLeave = async () => {
        const decision = leaveDecision.current;
        leaveDecision.current = null;
        setLeaving(false);
        if (decision !== null) decision(true);
        else await closeProject();
    };
    const [layoutProject, setLayoutProject] = useState<string | null>(null);
    const findInput = useRef<HTMLInputElement>(null);
    const fileInput = useRef<HTMLInputElement>(null);
    const quickReturnFocus = useRef<HTMLElement | null>(null);
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
    const availableWidth = Math.max(0, (workspaceWidth ?? (visibleLeftWidth + 28 + CENTER_MIN + RIGHT_DEFAULT)) - visibleLeftWidth - 28);
    const centerMin = Math.min(CENTER_MIN, Math.max(0, availableWidth - (rightCollapsed ? COLLAPSED_WIDTH : RIGHT_MIN)));
    const rightMax = Math.max(COLLAPSED_WIDTH, availableWidth - centerMin);
    const visibleRightWidth = rightCollapsed ? COLLAPSED_WIDTH : Math.min(rightWidth, rightMax);
    const [outlineOpen, setOutlineOpen] = useState(true);
    const [quickOpen, setQuickOpen] = useState(false);
    const [quickQuery, setQuickQuery] = useState('');
    const [fileQuery, setFileQuery] = useState('');
    const [findQuery, setFindQuery] = useState('');
    const [contentSearchOpen, setContentSearchOpen] = useState(false);
    const [findResult, setFindResult] = useState({ index: 0, total: 0 });
    const [quickIndex, setQuickIndex] = useState(0);
    const leftDragBase = useRef(LEFT_DEFAULT);
    const rightDragBase = useRef(RIGHT_DEFAULT);
    const rightDragPreferred = useRef(RIGHT_DEFAULT);
    const rightDragCollapsed = useRef(false);
    const documentsRef = useRef(documents);
    const tabsRestoredRef = useRef(false);
    documentsRef.current = documents;
    const requestClose = useCallback(() => {
        if (documentsRef.current.some(document => document.dirty || document.saving)) setLeaving(true);
        else void closeProject();
    }, [closeProject]);
    useEffect(() => props.registerCloseRequest?.(requestClose), [props.registerCloseRequest, requestClose]);
    const savingPaths = useRef(new Set<string>());
    const composing = useRef(false);
    const [conflictOpen, setConflictOpen] = useState(false);
    const syncNow = useRef<() => void>(() => { });
    const activeDocument = documents.find(document => document.path === activePath) ?? null;
    const activeIsMarkdown = activeDocument !== null && documentKind(activeDocument.path) === 'markdown';
    const activeIsBinary = activeDocument !== null && isBinaryDocument(activeDocument.path);
    const navigation = activePath === null ? null : editorNavigation[activePath];
    const countText = (text: string) => [...text.replace(/\s/gu, '')].length;
    const wordCount = countText(navigation?.text() ?? activeDocument?.draft ?? '');
    const headings = navigation?.headings() ?? [];
    const quickFiles = flattenFiles(structure?.tree ?? []).filter(node => node.path.slice(projectPath.length + 1).toLocaleLowerCase().includes(quickQuery.toLocaleLowerCase()));
    const runFind = (direction: 'first' | 'next' | 'previous', query = findQuery) => {
        if (activePath === null)
            return;
        setFindResult(editorNavigation[activePath]?.find(query, direction) ?? { index: 0, total: 0 });
    };
    const [selection, setSelection] = useState<(DocumentSelection & {
        path: string;
    }) | null>(null);
    const [selectionBusy, setSelectionBusy] = useState(false);
    const [selectionError, setSelectionError] = useState<string | null>(null);
    const [nodeDialog, setNodeDialog] = useState<NodeDialogState | null>(null);
    const [nodeName, setNodeName] = useState('');
    const [nodeBusy, setNodeBusy] = useState(false);
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const importPickerRef = useRef<HTMLInputElement | null>(null);
    const importTargetRef = useRef(projectPath);
    const selectionPopoverRef = useRef<HTMLDivElement>(null);
    useEffect(() => { setSelectionError(null); }, [selection]);
    const conversationControlRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const close = () => setContextMenu(null);
        window.addEventListener('pointerdown', close);
        window.addEventListener('scroll', close, true);
        return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('scroll', close, true); };
    }, []);
    const reloadStructure = async (): Promise<StructureResponse | null> => {
        const generation = ++structureRequest.current;
        try {
            const res = await request('/api/desktop/projects/structure?path=' + encodeURIComponent(projectPath));
            if (!res.ok)
                throw new Error('structure ' + res.status);
            const data = await res.json() as StructureResponse;
            if (generation !== structureRequest.current)
                return null;
            setStructure(data);
            setLoadError(null);
            return data;
        }
        catch (e) {
            if (generation !== structureRequest.current)
                return null;
            setLoadError(String(e instanceof Error ? e.message : e));
            return null;
        }
    };
    useEffect(() => { void reloadStructure(); }, [projectPath]);
    useEffect(() => {
        if (selection?.path !== activePath)
            setSelection(null);
    }, [activePath, selection?.path]);
    useEffect(() => {
        if (selection === null)
            return;
        const closeOnOutsidePointer = (event: PointerEvent): void => {
            if (selectionPopoverRef.current?.contains(event.target as Node))
                return;
            setSelection(null);
        };
        window.addEventListener('pointerdown', closeOnOutsidePointer);
        return () => window.removeEventListener('pointerdown', closeOnOutsidePointer);
    }, [selection]);
    const selectionContext = selection === null || activeDocument === null ? '' : [
        t("legacy.058", { value0: selection.path }),
        t("legacy.059", { value0: selection.startLine, value1: selection.endLine }),
        t("legacy.060"),
        '---',
        selection.text,
        '---',
    ].join('\n');
    const submitSelection = async (target: 'current' | 'new'): Promise<void> => {
        if (selection === null || selectionBusy)
            return;
        setSelectionBusy(true);
        setSelectionError(null);
        try {
            await addSelectionToConversation(target, selectionContext, t("legacy.061"), selection.path);
            setSelection(null);
        }
        catch (error) {
            setSelectionError(error instanceof Error ? error.message : t("legacy.062"));
        }
        finally {
            setSelectionBusy(false);
        }
    };
    useEffect(() => {
        let cancelled = false;
        const persisted = readPersistedTabs(projectPath);
        if (persisted === null || persisted.documents.length === 0) {
            tabsRestoredRef.current = true;
            return;
        }
        void Promise.all(persisted.documents.map(async (item): Promise<OpenDocument | null> => {
            if (isBinaryDocument(item.path)) return { ...item, visualMode: true, content: '', draft: '', dirty: false, saving: false, saveStatus: null };
            try {
                const response = await request('/api/desktop/projects/file?path=' + encodeURIComponent(item.path));
                if (!response.ok && response.status !== 404)
                    return null;
                const body = await response.json() as {
                    content?: unknown;
                    recovery?: {
                        content: string;
                        baseline: string;
                    };
                };
                if (body.content === null && body.recovery)
                    return { ...item, content: '', draft: body.recovery.content, dirty: true, saving: false, saveStatus: t("legacy.063"), conflict: { content: null } };
                if (typeof body.content !== 'string')
                    return null;
                const recovery = body.recovery?.content !== body.content ? body.recovery : undefined;
                return { ...item, content: body.content, draft: recovery?.content ?? body.content, dirty: !!recovery, saving: false, saveStatus: recovery ? t("legacy.064") : null, ...(recovery ? { conflict: { content: body.content } } : {}) };
            }
            catch {
                return null;
            }
        })).then(restored => {
            if (cancelled)
                return;
            const valid = restored.filter((document): document is OpenDocument => document !== null);
            setDocuments(current => {
                const currentPaths = new Set(current.map(document => document.path));
                return [...valid.filter(document => !currentPaths.has(document.path)), ...current];
            });
            setActivePath(current => current ?? (valid.some(document => document.path === persisted.activePath) ? persisted.activePath : valid[0]?.path ?? null));
            tabsRestoredRef.current = true;
            if (valid.length === 0)
                window.localStorage.removeItem(DOCUMENT_TABS_STORAGE_PREFIX + projectPath);
        });
        return () => { cancelled = true; };
    }, [projectPath]);
    useEffect(() => {
        let saved: {
            left?: number;
            right?: number;
            leftCollapsed?: boolean;
            rightCollapsed?: boolean;
        } | null = null;
        try {
            saved = JSON.parse(window.localStorage.getItem(`zenwit.layout.${projectPath}`) ?? 'null');
        }
        catch { /* Ignore corrupt preferences. */ }
        setLeftWidth(typeof saved?.left === 'number' && Number.isFinite(saved.left) ? clamp(saved.left, LEFT_MIN, LEFT_MAX) : LEFT_DEFAULT);
        setRightWidth(typeof saved?.right === 'number' && Number.isFinite(saved.right) ? Math.max(saved.right, RIGHT_MIN) : RIGHT_DEFAULT);
        setLeftCollapsed(saved?.leftCollapsed === true);
        setRightCollapsed(saved?.rightCollapsed === true);
        setLayoutProject(projectPath);
    }, [projectPath]);
    useEffect(() => {
        if (layoutProject !== projectPath)
            return;
        try {
            window.localStorage.setItem(`zenwit.layout.${projectPath}`, JSON.stringify({ left: leftWidth, right: rightWidth, leftCollapsed, rightCollapsed }));
        }
        catch { /* Layout remains usable without storage. */ }
    }, [leftWidth, rightWidth, leftCollapsed, rightCollapsed, projectPath, layoutProject]);
    useEffect(() => {
        setFindResult(navigation?.find(contentSearchOpen ? findQuery : '', 'first') ?? { index: 0, total: 0 });
    }, [activePath, navigation, findQuery, contentSearchOpen]);
    useEffect(() => {
        setFindResult(navigation?.find(contentSearchOpen ? findQuery : '', 'count') ?? { index: 0, total: 0 });
    }, [activeDocument?.draft]);
    useEffect(() => {
        if (quickOpen)
            return;
        quickReturnFocus.current?.focus();
        quickReturnFocus.current = null;
    }, [quickOpen]);
    useEffect(() => {
        document.querySelector('[data-quick-result="true"]')?.scrollIntoView?.({ block: 'nearest' });
    }, [quickIndex, quickQuery]);
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            const mod = event.metaKey || event.ctrlKey;
            if (mod && event.key.toLowerCase() === 'p') {
                event.preventDefault();
                if (!quickOpen)
                    quickReturnFocus.current = document.activeElement as HTMLElement;
                setQuickOpen(true);
                setQuickQuery('');
                setQuickIndex(0);
            }
            const target = event.target instanceof HTMLElement ? event.target : null;
            const isEditorTarget = (target !== null && target.closest('[contenteditable="true"]') !== null) || event.target === window || event.target === document.body;
            if (mod && event.key.toLowerCase() === 'f' && activeIsMarkdown && activeDocument?.visualMode && !quickOpen && isEditorTarget) {
                event.preventDefault();
                setContentSearchOpen(true);
                window.requestAnimationFrame(() => { findInput.current?.focus(); findInput.current?.select(); });
            }
            if (event.key === 'Escape') {
                if (quickOpen) {
                    event.preventDefault();
                    setQuickOpen(false);
                }
                else if (contentSearchOpen) {
                    setFindQuery('');
                    setContentSearchOpen(false);
                    navigation?.focus();
                }
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [activeDocument?.visualMode, navigation, quickOpen, contentSearchOpen]);
    useEffect(() => {
        if (!tabsRestoredRef.current)
            return;
        const key = DOCUMENT_TABS_STORAGE_PREFIX + projectPath;
        if (documents.length === 0) {
            window.localStorage.removeItem(key);
            return;
        }
        const persisted: PersistedDocumentTabs = {
            activePath,
            documents: documents.map(({ path, name, visualMode }) => ({ path, name, visualMode })),
        };
        window.localStorage.setItem(key, JSON.stringify(persisted));
    }, [activePath, documents, projectPath]);
    // OS file notifications drive synchronization. The slow timer only repairs
    // missed events; serialized reads reject obsolete local-buffer snapshots.
    useEffect(() => {
        let disposed = false;
        let running = false;
        let pending = false;
        let frame: number | undefined;
        const sync = async () => {
            if (disposed || composing.current)
                return;
            if (running) {
                pending = true;
                return;
            }
            pending = false;
            running = true;
            try {
                await Promise.all(documentsRef.current.map(async (snapshot) => {
                    if (isBinaryDocument(snapshot.path) || savingPaths.current.has(snapshot.path))
                        return;
                    try {
                        const response = await request('/api/desktop/projects/file?sync=1&path=' + encodeURIComponent(snapshot.path), { cache: 'no-store' });
                        if (!response.ok && response.status !== 404)
                            throw new Error(t("legacy.065") + response.status);
                        const body = await response.json() as {
                            content: string | null;
                        };
                        if (body.content !== null && typeof body.content !== 'string')
                            throw new Error(t("legacy.066"));
                        if (disposed || composing.current || savingPaths.current.has(snapshot.path))
                            return;
                        if (documentsRef.current.find(item => item.path === snapshot.path) !== snapshot) {
                            pending = true;
                            return;
                        }
                        setDocuments(current => current.map(item => {
                            if (item !== snapshot)
                                return item;
                            const disk = body.content;
                            if (disk === item.content && !item.conflict)
                                return item.syncError ? { ...item, syncError: undefined } : item;
                            if (disk !== null && ((!item.dirty && !item.conflict) || disk === item.draft)) {
                                return { ...item, content: disk, draft: disk, dirty: false, conflict: undefined, syncError: undefined, externalUpdate: { content: disk }, saveStatus: t("legacy.067") };
                            }
                            return { ...item, conflict: { content: disk }, syncError: undefined };
                        }));
                    }
                    catch (error) {
                        if (!disposed)
                            setDocuments(current => current.map(item => item === snapshot ? { ...item, syncError: String(error instanceof Error ? error.message : error) } : item));
                    }
                }));
            }
            finally {
                running = false;
                if (pending && !disposed)
                    frame = window.requestAnimationFrame(() => { void sync(); });
            }
        };
        syncNow.current = () => { void sync(); };
        const onVisible = () => { if (document.visibilityState !== 'hidden')
            void sync(); };
        const changed = () => { void reloadStructure(); void sync(); };
        const timer = setInterval(changed, 30000);
        window.addEventListener('focus', onVisible);
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            disposed = true;
            clearInterval(timer);
            if (frame !== undefined)
                window.cancelAnimationFrame(frame);
            window.removeEventListener('focus', onVisible);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [projectPath]);
    useEffect(() => { setConflictOpen(false); syncNow.current(); }, [activePath]);
    useEffect(() => { void reloadStructure(); syncNow.current(); }, [fileRevision]);
    const openFilePath = useCallback(async (path: string, name: string): Promise<boolean> => {
        const existing = documentsRef.current.find(document => document.path === path);
        if (existing !== undefined) {
            setActivePath(path);
            syncNow.current();
            return true;
        }
        if (isBinaryDocument(path)) {
            setDocuments(previous => previous.some(item => item.path === path) ? previous : [...previous, { path, name, content: '', draft: '', dirty: false, saving: false, saveStatus: null, visualMode: true }]);
            setActivePath(path);
            return true;
        }
        try {
            const res = await request('/api/desktop/projects/file?path=' + encodeURIComponent(path));
            if (res.status === 404) {
                const body = await res.json() as {
                    recovery?: {
                        content: string;
                    };
                };
                setDocuments(previous => previous.some(item => item.path === path) ? previous : [...previous, { path, name, content: '', draft: body.recovery?.content ?? '', dirty: !!body.recovery, saving: false, saveStatus: null, visualMode: hasDocumentPreview(path), conflict: { content: null } }]);
                setActivePath(path);
                return true;
            }
            if (!res.ok)
                throw new Error('read ' + res.status);
            const body = await res.json() as {
                content: string;
                recovery?: {
                    content: string;
                    baseline: string;
                };
            };
            const recovery = body.recovery?.content !== body.content ? body.recovery : undefined;
            setDocuments(previous => previous.some(item => item.path === path) ? previous : [...previous, { path, name, content: body.content, draft: recovery?.content ?? body.content, dirty: !!recovery, saving: false, saveStatus: recovery ? t("legacy.064") : null, visualMode: hasDocumentPreview(path), ...(recovery ? { conflict: { content: body.content } } : {}) }]);
            setActivePath(path);
            return true;
        }
        catch (e) {
            setLoadError(t("legacy.068") + String(e instanceof Error ? e.message : e));
            return false;
        }
    }, []);
    const openFileInWorkspace = useCallback(async (path: string): Promise<boolean> => {
        if (!isProjectFilePath(path, projectPath))
            return false;
        return openFilePath(path, nodeBasename(path));
    }, [openFilePath, projectPath]);
    useEffect(() => {
        if (fileRequest === null)
            return;
        let active = true;
        void openFileInWorkspace(fileRequest.path).then(opened => {
            if (!active || !opened || fileRequest.line === undefined)
                return;
            setDocuments(previous => previous.map(item => item.path === fileRequest.path ? { ...item, visualMode: false } : item));
        });
        return () => { active = false; };
    }, [fileRequest, openFileInWorkspace]);
    const onOpenNode = async (node: TreeNode) => {
        if (node.kind === 'dir') {
            setExpanded(prev => {
                const next = new Set(prev);
                if (next.has(node.path))
                    next.delete(node.path);
                else
                    next.add(node.path);
                return next;
            });
            return;
        }
        await openFilePath(node.path, node.name);
    };
    const saveDocument = async (path: string, override?: {
        expectedContent: string | null;
    }): Promise<boolean> => {
        const file = documentsRef.current.find(document => document.path === path);
        if (isBinaryDocument(path) || file === undefined || savingPaths.current.has(path) || composing.current || (file.conflict && !override))
            return false;
        savingPaths.current.add(path);
        const content = file.draft;
        setDocuments(previous => previous.map(document => document.path === path ? { ...document, saving: true, saveStatus: null } : document));
        try {
            const res = await request('/api/desktop/projects/file', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ path: file.path, content, expectedContent: override ? override.expectedContent : file.content }),
            });
            if (res.status === 409) {
                const body = await res.json() as {
                    content: string | null;
                };
                setDocuments(previous => previous.map(item => item.path === path ? { ...item, saving: false, conflict: { content: body.content }, saveStatus: t("legacy.069") } : item));
                return false;
            }
            if (!res.ok)
                throw new Error('save ' + res.status);
            const saved = documentsRef.current.map(document => document.path === path
                ? { ...document, content, dirty: document.draft !== content, saving: false, conflict: undefined, syncError: undefined, saveStatus: t("legacy.070") }
                : document);
            documentsRef.current = saved;
            setDocuments(saved);
            void reloadStructure();
            return true;
        }
        catch (e) {
            setDocuments(previous => previous.map(document => document.path === path
                ? { ...document, saving: false, saveStatus: t("legacy.071") + String(e instanceof Error ? e.message : e) }
                : document));
            return false;
        }
        finally {
            savingPaths.current.delete(path);
            window.requestAnimationFrame(() => syncNow.current());
        }
    };
    useEffect(() => {
        if (!autoSave)
            return;
        const timers = documents.filter(document => document.dirty && !document.conflict && !document.syncError && !document.saving && !document.saveStatus?.startsWith(t("legacy.072"))).map(document => window.setTimeout(() => { void saveDocument(document.path); }, 800));
        return () => timers.forEach(timer => window.clearTimeout(timer));
    }, [autoSave, documents]);
    // Persist dirty buffers independently of autosave, including conflicts. One
    // writer per path prevents an older draft request from finishing last.
    const draftWrites = useRef(new Map<string, Promise<void>>());
    const persistedDrafts = useRef(new Map<string, string>());
    useEffect(() => {
        for (const item of documents)
            if (!item.dirty)
                persistedDrafts.current.delete(item.path);
    }, [documents]);
    useEffect(() => {
        let disposed = false;
        const persist = async () => {
            await Promise.all(documentsRef.current.filter(item => item.dirty).map(async (item) => {
                if (savingPaths.current.has(item.path) || draftWrites.current.has(item.path) || persistedDrafts.current.get(item.path) === item.draft)
                    return;
                const pending = (async () => {
                    try {
                        const result = await request('/api/desktop/projects/file', {
                            method: 'POST', headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({ path: item.path, action: 'draft', content: item.draft, baseline: item.content }),
                        });
                        if (!result.ok)
                            throw new Error(t("legacy.073") + result.status);
                        persistedDrafts.current.set(item.path, item.draft);
                    }
                    catch (error) {
                        if (!disposed)
                            setDocuments(current => current.map(doc => doc.path === item.path ? { ...doc, saveStatus: t("legacy.071") + String(error) } : doc));
                    }
                    finally {
                        draftWrites.current.delete(item.path);
                    }
                })();
                draftWrites.current.set(item.path, pending);
                await pending;
            }));
        };
        const timer = setInterval(() => { void persist(); }, 500);
        return () => { disposed = true; clearInterval(timer); };
    }, [projectPath]);
    const resolveConflict = async (snapshot: OpenDocument) => {
        if (!snapshot.conflict || savingPaths.current.has(snapshot.path))
            return;
        savingPaths.current.add(snapshot.path);
        setDocuments(current => current.map(item => item.path === snapshot.path ? { ...item, saving: true } : item));
        try {
            const copyPath = snapshot.path.replace(/(\.[^./\\]+)?$/, t("legacy.074") + crypto.randomUUID() + '$1');
            const result = await request('/api/desktop/projects/file', {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ path: copyPath, content: snapshot.draft, expectedContent: null }),
            });
            if (!result.ok)
                throw new Error(t("legacy.075") + result.status);
            await draftWrites.current.get(snapshot.path);
            const discarded = await request('/api/desktop/projects/file', {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ path: snapshot.path, action: 'discard-draft', expectedDraft: snapshot.draft }),
            });
            if (!discarded.ok)
                throw new Error(t("legacy.076") + discarded.status);
            persistedDrafts.current.delete(snapshot.path);
            const response = await request('/api/desktop/projects/file?sync=1&path=' + encodeURIComponent(snapshot.path), { cache: 'no-store' });
            if (!response.ok && response.status !== 404)
                throw new Error(t("legacy.077") + response.status);
            const latest = await response.json() as {
                content: string | null;
            };
            // Never discard edits made while the backup was being written.
            setDocuments(current => current.map(item => {
                if (item.path !== snapshot.path)
                    return item;
                if (item.draft !== snapshot.draft)
                    return { ...item, saving: false };
                const disk = latest.content;
                return disk === null
                    ? { ...item, path: copyPath, name: copyPath.split(/[\\/]/).at(-1)!, content: item.draft, dirty: false, saving: false, conflict: undefined }
                    : { ...item, content: disk, draft: disk, dirty: false, saving: false, conflict: undefined, externalUpdate: { content: disk }, saveStatus: t("legacy.078") };
            }));
            if (latest.content === null && documentsRef.current.find(item => item.path === snapshot.path)?.draft === snapshot.draft)
                setActivePath(current => current === snapshot.path ? copyPath : current);
            setConflictOpen(false);
            void reloadStructure();
        }
        catch (error) {
            setDocuments(current => current.map(item => item.path === snapshot.path ? { ...item, saving: false, saveStatus: t("legacy.071") + String(error) } : item));
        }
        finally {
            savingPaths.current.delete(snapshot.path);
            window.requestAnimationFrame(() => syncNow.current());
        }
    };
    const closeDocument = async (path: string, discard = false) => {
        const document = documentsRef.current.find(item => item.path === path);
        if (document === undefined)
            return;
        if (savingPaths.current.has(path))
            return;
        if (document.dirty && !discard) {
            setPendingClosePath(path);
            return;
        }
        if (discard) {
            try {
                savingPaths.current.add(path);
                await draftWrites.current.get(path);
                const response = await request('/api/desktop/projects/file', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path, action: 'discard-draft', expectedDraft: document.draft }) });
                if (!response.ok)
                    throw new Error(t("legacy.079"));
                persistedDrafts.current.delete(path);
            }
            catch (error) {
                setDocuments(current => current.map(item => item.path === path ? { ...item, saveStatus: t("legacy.071") + String(error) } : item));
                return;
            }
            finally {
                savingPaths.current.delete(path);
            }
        }
        if (discard && documentsRef.current.find(item => item.path === path)?.draft !== document.draft)
            return;
        const index = documentsRef.current.findIndex(item => item.path === path);
        const remaining = documentsRef.current.filter(item => item.path !== path);
        setDocuments(remaining);
        if (activePath === path)
            setActivePath(remaining[Math.min(index, remaining.length - 1)]?.path ?? null);
    };
    const confirmSaveAndClose = async () => {
        if (pendingClosePath === null)
            return;
        const path = pendingClosePath;
        if (await saveDocument(path)) {
            if (documentsRef.current.find(document => document.path === path)?.dirty)
                return;
            setPendingClosePath(null);
            await closeDocument(path);
        }
    };
    const saveAndLeave = async () => {
        setLeaveError(null);
        for (const document of documentsRef.current) {
            if (document.dirty && !await saveDocument(document.path)) {
                setLeaveError(t("legacy.080"));
                return;
            }
        }
        if (documentsRef.current.some(document => document.dirty || document.saving)) {
            setLeaveError(t("legacy.081"));
            return;
        }
        await finishLeave();
    };
    const discardAndLeave = async () => {
        const snapshots = documentsRef.current;
        if (snapshots.some(item => savingPaths.current.has(item.path)))
            return;
        for (const item of snapshots)
            savingPaths.current.add(item.path);
        try {
            for (const item of snapshots) {
                await draftWrites.current.get(item.path);
                const response = await request('/api/desktop/projects/file', {
                    method: 'POST', headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ path: item.path, action: 'discard-draft', expectedDraft: item.draft }),
                });
                if (!response.ok)
                    throw new Error(t("legacy.082"));
                persistedDrafts.current.delete(item.path);
            }
            if (snapshots.some(item => documentsRef.current.find(current => current.path === item.path)?.draft !== item.draft))
                throw new Error(t("legacy.083"));
            await finishLeave();
        }
        catch (error) {
            setLeaveError(String(error instanceof Error ? error.message : error));
        }
        finally {
            for (const item of snapshots)
                savingPaths.current.delete(item.path);
        }
    };
    useEffect(() => {
        const protectUnload = (event: BeforeUnloadEvent) => {
            if (!documentsRef.current.some(document => document.dirty || document.saving))
                return;
            event.preventDefault();
            event.returnValue = '';
        };
        window.addEventListener('beforeunload', protectUnload);
        return () => window.removeEventListener('beforeunload', protectUnload);
    }, []);
    const openNodeDialog = (mode: NodeDialogState['mode'], targetPath: string, initialName = '') => {
        setContextMenu(null);
        setNodeName(initialName);
        setNodeDialog({ mode, targetPath, initialName });
    };
    const nodeRequest = async (method: 'POST' | 'PATCH' | 'DELETE', body: Record<string, unknown>): Promise<{
        path?: string;
    }> => {
        const response = await request('/api/desktop/projects/node', {
            method,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        });
        const payload = await response.json().catch(() => ({})) as {
            path?: string;
            error?: string;
        };
        if (!response.ok)
            throw new Error(payload.error ?? t("legacy.084", { value0: response.status }));
        return payload;
    };
    const submitNodeDialog = async () => {
        if (nodeDialog === null || nodeName.trim() === '' || nodeBusy)
            return;
        setNodeBusy(true);
        setLoadError(null);
        try {
            if (nodeDialog.mode === 'rename') {
                const oldPath = nodeDialog.targetPath;
                const result = await nodeRequest('PATCH', { path: oldPath, newName: nodeName.trim() });
                const nextPath = result.path ?? oldPath;
                setDocuments(previous => previous.map(document => {
                    const suffix = descendantSuffix(document.path, oldPath);
                    if (suffix === null)
                        return document;
                    return { ...document, path: nextPath + suffix, ...(suffix === '' ? { name: nodeName.trim() } : {}) };
                }));
                setActivePath(current => {
                    if (current === null)
                        return null;
                    const suffix = descendantSuffix(current, oldPath);
                    return suffix === null ? current : nextPath + suffix;
                });
            }
            else {
                const createdPath = nodePath(nodeDialog.targetPath, nodeName.trim());
                const result = await nodeRequest('POST', { path: createdPath, kind: nodeDialog.mode });
                if (nodeDialog.mode === 'file') await openFilePath(result.path ?? createdPath, nodeName.trim());
            }
            setNodeDialog(null);
            setNodeName('');
            await reloadStructure();
        }
        catch (error) {
            setLoadError(error instanceof Error ? error.message : String(error));
        }
        finally {
            setNodeBusy(false);
        }
    };
    const deleteNode = async (node: TreeNode) => {
        setContextMenu(null);
        const label = node.kind === 'dir' ? t("legacy.085") : t("legacy.086");
        if (!window.confirm(t("legacy.087", { value0: label, value1: node.name })))
            return;
        try {
            await nodeRequest('DELETE', { path: node.path });
            const remaining = documentsRef.current.filter(document => descendantSuffix(document.path, node.path) === null);
            setDocuments(remaining);
            setActivePath(current => current !== null && descendantSuffix(current, node.path) !== null ? remaining[0]?.path ?? null : current);
            await reloadStructure();
        }
        catch (error) {
            setLoadError(error instanceof Error ? error.message : String(error));
        }
    };
    const copyNodePath = async (path: string) => {
        setContextMenu(null);
        try {
            await navigator.clipboard.writeText(path);
        }
        catch {
            setLoadError(t("legacy.088"));
        }
    };
    const addNodeToChat = async (node: TreeNode) => {
        setContextMenu(null);
        if (node.kind !== 'file')
            return;
        try {
            const response = await request('/api/desktop/projects/file?path=' + encodeURIComponent(node.path));
            if (!response.ok)
                throw new Error(t("legacy.089"));
            const body = await response.json() as {
                content: string;
            };
            await addSelectionToConversation('current', t("legacy.090", { value0: node.path, value1: body.content }), t("legacy.086"), node.path);
        }
        catch (error) {
            setLoadError(error instanceof Error ? error.message : String(error));
        }
    };
    const openImportPicker = (targetPath: string): void => {
        setContextMenu(null);
        importTargetRef.current = targetPath;
        importPickerRef.current?.click();
    };
    const importFiles = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
        const files = Array.from(event.target.files ?? []);
        event.target.value = '';
        if (files.length === 0)
            return;
        setLoadError(null);
        let imported = false;
        try {
            for (const file of files) {
                const query = new URLSearchParams({
                    projectPath,
                    destinationPath: importTargetRef.current,
                    name: file.name,
                });
                const response = await request('/api/desktop/projects/import?' + query.toString(), {
                    method: 'POST',
                    body: file,
                });
                const payload = await response.json().catch(() => ({})) as {
                    error?: string;
                };
                if (!response.ok) {
                    if (response.status === 409)
                        throw new Error(t("legacy.091", { value0: file.name }));
                    if (response.status === 413)
                        throw new Error(t("legacy.092", { value0: file.name }));
                    throw new Error(payload.error ?? t("legacy.093", { value0: file.name, value1: response.status }));
                }
                imported = true;
            }
        }
        catch (error) {
            setLoadError(error instanceof Error ? error.message : String(error));
        }
        finally {
            if (imported)
                await reloadStructure();
        }
    };
    const nativeProjectAction = useCallback(async (action: 'reveal' | 'terminal', path: string) => {
        setContextMenu(null);
        try {
            const response = await request(`/api/desktop/projects/${action}`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ path }),
            });
            const payload = await response.json().catch(() => ({})) as {
                error?: string;
            };
            if (!response.ok)
                throw new Error(payload.error ?? t("legacy.094", { value0: action === 'reveal' ? t("legacy.095") : t("legacy.096") }));
        }
        catch (error) {
            setLoadError(error instanceof Error ? error.message : String(error));
        }
    }, [request, t]);
    const parentPath = (path: string): string => path.replace(/[/\\][^/\\]*$/u, '') || projectPath;
    const openProjectMenu = useCallback((event: React.MouseEvent<HTMLButtonElement>): void => {
        const rect = event.currentTarget.getBoundingClientRect();
        setContextMenu({ node: null, x: Math.max(8, rect.right - 184), y: rect.bottom + 6 });
    }, []);
    const renderFileIcon = (node: TreeNode): ReactNode => {
        const iconProps = { size: 15, strokeWidth: 1.7, 'aria-hidden': true as const };
        if (/\.json$/i.test(node.name))
            return <FileJson {...iconProps}/>;
        if (/\.(md|mdx)$/i.test(node.name))
            return <FileText {...iconProps}/>;
        return <File {...iconProps}/>;
    };
    /** Recursive tree render: a folder expands to reveal its real contents. */
    const renderNodes = (nodes: TreeNode[]): ReactNode[] => nodes.map(node => {
        const isOpen = fileQuery.trim() !== '' || expanded.has(node.path);
        const isSelected = node.kind === 'file' && activePath === node.path;
        const isDirty = node.kind === 'file' && documents.some(document => document.path === node.path && document.dirty);
        const detail = node.kind === 'dir'
            ? node.children !== undefined && node.children.length > 0 ? t("legacy.097", { value0: node.children.length }) : ''
            : node.detail === '0 B' ? t("legacy.098") : node.detail;
        return (<li key={node.path} role="none">
        <button type="button" role="treeitem" aria-expanded={node.kind === 'dir' ? isOpen : undefined} aria-current={isSelected ? 'page' : undefined} className={css.structureNode
                + (node.kind === 'dir' ? ' ' + css.structureDir : ' ' + css.structureFile)
                + (isSelected ? ' ' + css.structureNodeSelected : '')} title={node.path} onClick={() => void onOpenNode(node)} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); setContextMenu({ node, x: event.clientX, y: event.clientY }); }}>
          <span className={css.structureChevron} aria-hidden="true">
            {node.kind === 'dir'
                ? isOpen ? <ChevronDown size={13} strokeWidth={2}/> : <ChevronRight size={13} strokeWidth={2}/>
                : null}
          </span>
          <span className={css.structureIcon} aria-hidden="true">
            {node.kind === 'dir'
                ? isOpen ? <FolderOpen size={16} strokeWidth={1.7}/> : <Folder size={16} strokeWidth={1.7}/>
                : renderFileIcon(node)}
          </span>
          <span className={css.structureLabel}>{node.name}</span>
          {isDirty && <span className={css.structureDirty} title={t("legacy.099")} aria-label={t("legacy.099")}/>}
          {detail !== '' && <span className={css.structureDetail} aria-hidden="true">{detail}</span>}
        </button>
        {node.kind === 'dir' && isOpen && node.children !== undefined && (<ul className={css.structureChildren} role="group">{renderNodes(node.children)}</ul>)}
      </li>);
    });
    const resizeLeft = useCallback((delta: number) => {
        setLeftWidth(clamp(leftDragBase.current + delta, LEFT_MIN, LEFT_MAX));
    }, []);
    const resizeRight = useCallback((delta: number) => {
        const requested = rightDragBase.current - delta;
        const collapsed = requested < (rightDragCollapsed.current ? RIGHT_EXPAND : RIGHT_COLLAPSE);
        rightDragCollapsed.current = collapsed;
        setRightCollapsed(collapsed);
        // A collapse gesture preserves the width from before the gesture.
        setRightWidth(collapsed ? rightDragPreferred.current : Math.max(RIGHT_MIN, Math.min(requested, rightMax)));
    }, [rightMax]);
    return (<div className={css.workspace} ref={workspaceRef} data-testid="workspace-grid" style={{ gridTemplateColumns: `${visibleLeftWidth}px 14px minmax(${centerMin}px, 1fr) 14px ${visibleRightWidth}px` }}>
      <div className={css.leftRail} data-collapsed={leftCollapsed || undefined}>
        {leftCollapsed && <button className={css.panelToggle} type="button" title={t("legacy.100")} aria-label={t("legacy.100")} aria-expanded={false} onClick={() => setLeftCollapsed(false)}><PanelLeftOpen size={16} aria-hidden="true"/></button>}
        <aside className={css.paneStructure} aria-label={t("legacy.101")}>
          <div className={css.structureHeader}>
            <div className={css.structureNavRow}>
              <div className={css.structureIdentity} title={structure?.root ?? t("legacy.103")} onContextMenu={event => { event.preventDefault(); setContextMenu({ node: null, x: event.clientX, y: event.clientY }); }}>
                <span className={css.structureProjectIcon} aria-hidden="true"><FolderOpen size={17} strokeWidth={1.7}/></span>
                <span className={css.structureIdentityText}>
                  <span className={css.structureEyebrow}>{t("legacy.104")}</span>
                  <strong className={css.structureTitle}>{structure?.root ?? t("legacy.103")}</strong>
                </span>
              </div>
              <button className={css.panelToggle} type="button" title={t("legacy.102")} aria-label={t("legacy.102")} aria-expanded={true} onClick={() => setLeftCollapsed(true)}><PanelLeftClose size={16} aria-hidden="true"/></button>
            </div>
          </div>
          <div className={css.structureSectionBar}>
            <span className={css.structureSectionTitle}>{t("legacy.105")}</span>
            <div className={css.structureToolbar}>
              <button type="button" title={t("legacy.106")} aria-label={t("legacy.106")} onClick={() => fileInput.current?.focus()}><Search size={15} aria-hidden="true"/></button>
              <button type="button" title={t("legacy.107")} aria-label={t("legacy.107")} onClick={() => openNodeDialog('file', projectPath)}><FilePlus size={15}/></button>
              <button type="button" title={t("legacy.127")} aria-label={t("legacy.127")} onClick={() => void nativeProjectAction('reveal', projectPath)}><FolderSearch size={16}/></button>
              <button type="button" title={t("legacy.108")} aria-label={t("legacy.108")} aria-haspopup="menu" aria-expanded={contextMenu?.node === null} onClick={openProjectMenu}><MoreHorizontal size={16}/></button>
            </div>
          </div>
          <div className={css.structureSearch}>
            <input ref={fileInput} className={css.findInput} aria-label={t("legacy.106")} placeholder={t("legacy.109")} value={fileQuery} onChange={event => setFileQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape')
        setFileQuery(''); }}/>
          </div>
          <input ref={importPickerRef} type="file" multiple hidden onChange={event => { void importFiles(event); }}/>
          {structure !== null && fileQuery.trim() !== '' && filterTree(structure.tree, fileQuery).length === 0 && <div className={css.structureError} role="status">{t("legacy.110")}</div>}
          {loadError !== null && (<div className={css.structureError} role="alert">
              <span>{loadError}</span>
              <button type="button" onClick={() => void reloadStructure()}>{t("legacy.111")}</button>
            </div>)}
          <ul className={css.structureList} role="tree" aria-label={t("legacy.105")} aria-busy={structure === null} onContextMenu={event => { if (event.target === event.currentTarget) {
        event.preventDefault();
        setContextMenu({ node: null, x: event.clientX, y: event.clientY });
    } }}>
            {structure === null ? (<li className={css.structureLoading} aria-label={t("legacy.112")}>
                <span /><span /><span />
              </li>) : structure.tree.length === 0 ? (<li className={css.structureEmpty} role="none">
                <FileText size={20} strokeWidth={1.5} aria-hidden="true"/>
                <strong>{t("legacy.113")}</strong>
                <button type="button" onClick={() => openNodeDialog('file', projectPath)}>{t("legacy.114")}</button>
              </li>) : renderNodes(filterTree(structure.tree, fileQuery))}
          </ul>
          {activeIsMarkdown && activeDocument?.visualMode && <div className={css.documentOutline}>
            <button type="button" className={css.documentOutlineHeader} aria-expanded={outlineOpen} aria-controls="workspace-document-outline" aria-label={t("legacy.115", { value0: headings.length })} onClick={() => setOutlineOpen(value => !value)}>
              <span>{t("legacy.116")}</span>
              <span className={css.documentOutlineHeaderMeta}>
                <small aria-hidden="true">{headings.length}</small>
                <ChevronDown size={14} aria-hidden="true"/>
              </span>
            </button>
            {outlineOpen && <div id="workspace-document-outline" className={css.documentOutlineList} aria-label={t("legacy.117")}>
              {headings.length === 0 ? <span className={css.documentOutlineEmpty}>{t("legacy.118")}</span> : headings.map(heading => {
                    const title = heading.title || t("legacy.119");
                    return <button type="button" key={heading.position} title={title} style={{ paddingLeft: 10 + Math.min(Math.max(heading.level - 1, 0), 3) * 12 }} onClick={() => navigation?.jump(heading.position)}>{title}</button>;
                })}
            </div>}
          </div>}
        </aside>
        <div className={css.workspaceFooterActions}>
          <div className={css.workspaceSettings}>{renderSlot('sidebar.settings', { wide: true })}</div>
          <div className={css.workspacePluginActions}>{renderSlot('sidebar.footer.action', { wide: true })}</div>
        </div>
      </div>
      {contextMenu !== null && (<div className={css.contextMenu} style={{ left: contextMenu.x, top: contextMenu.y }} role="menu" onPointerDown={event => event.stopPropagation()}>
          <button type="button" role="menuitem" onClick={() => openImportPicker(contextMenu.node?.kind === 'dir' ? contextMenu.node.path : contextMenu.node === null ? projectPath : parentPath(contextMenu.node.path))}><FilePlus size={14}/>{t("legacy.120")}</button>
          <button type="button" role="menuitem" onClick={() => openNodeDialog('file', contextMenu.node?.kind === 'dir' ? contextMenu.node.path : projectPath)}><FilePlus size={14}/>{t("legacy.107")}</button>
          <button type="button" role="menuitem" onClick={() => openNodeDialog('directory', contextMenu.node?.kind === 'dir' ? contextMenu.node.path : projectPath)}><FolderPlus size={14}/>{t("legacy.121")}</button>
          {contextMenu.node !== null && <>
            {contextMenu.node.kind === 'file' && <button type="button" role="menuitem" onClick={() => { setContextMenu(null); void onOpenNode(contextMenu.node as TreeNode); }}><FileText size={14}/>{t("legacy.122")}</button>}
            {contextMenu.node.kind === 'dir' && <button type="button" role="menuitem" onClick={() => { setContextMenu(null); void onOpenNode(contextMenu.node as TreeNode); }}><FolderOpen size={14}/>{t("legacy.123")}</button>}
            <button type="button" role="menuitem" onClick={() => openNodeDialog('rename', contextMenu.node!.path, nodeBasename(contextMenu.node!.path))}><Pencil size={14}/>{t("legacy.124")}</button>
            <button type="button" role="menuitem" onClick={() => void deleteNode(contextMenu.node as TreeNode)}><Trash2 size={14}/>{t("legacy.125")}</button>
            <button type="button" role="menuitem" onClick={() => void copyNodePath(contextMenu.node!.path)}><Copy size={14}/>{t("legacy.126")}</button>
            <button type="button" role="menuitem" onClick={() => void nativeProjectAction('reveal', contextMenu.node!.path)}><FolderSearch size={14}/>{t("legacy.127")}</button>
            <button type="button" role="menuitem" onClick={() => void nativeProjectAction('terminal', contextMenu.node!.kind === 'dir' ? contextMenu.node!.path : parentPath(contextMenu.node!.path))}><Terminal size={14}/>{t("legacy.128")}</button>
            {contextMenu.node.kind === 'file' && <button type="button" role="menuitem" onClick={() => void addNodeToChat(contextMenu.node as TreeNode)}><MessageSquare size={14}/>{t("legacy.129")}</button>}
          </>}
          {contextMenu.node === null && <button type="button" role="menuitem" onClick={() => void nativeProjectAction('reveal', projectPath)}><FolderSearch size={14}/>{t("legacy.127")}</button>}
          {contextMenu.node === null && <button type="button" role="menuitem" onClick={() => { setContextMenu(null); setExpanded(new Set()); }}><ChevronsDownUp size={14}/>{t("legacy.130")}</button>}
          <button type="button" role="menuitem" onClick={() => { setContextMenu(null); void reloadStructure(); syncNow.current(); }}><RefreshCw size={14}/>{t("legacy.131")}</button>
        </div>)}
      {nodeDialog !== null && (<div className={css.nodeDialogOverlay} role="presentation" onClick={() => { if (!nodeBusy)
            setNodeDialog(null); }}>
          <form className={css.nodeDialog} role="dialog" aria-modal="true" onSubmit={event => { event.preventDefault(); void submitNodeDialog(); }} onClick={event => event.stopPropagation()}>
            <h2>{nodeDialog.mode === 'rename' ? t("legacy.124") : nodeDialog.mode === 'file' ? t("legacy.107") : t("legacy.121")}</h2>
            <input value={nodeName} onChange={event => setNodeName(event.target.value)} autoFocus placeholder={nodeDialog.mode === 'file' ? t("legacy.132") : t("legacy.133")}/>
            <div className={css.nodeDialogActions}><button type="button" onClick={() => setNodeDialog(null)} disabled={nodeBusy}>{t("legacy.035")}</button><button type="submit" disabled={nodeBusy || nodeName.trim() === ''}>{nodeBusy ? t("legacy.134") : t("legacy.135")}</button></div>
          </form>
        </div>)}
      <ResizeHandle label={t("legacy.136")} value={leftWidth} onStart={() => { leftDragBase.current = leftWidth; }} onDrag={resizeLeft}/>
      <section className={css.paneEditor} aria-label={t("legacy.137")} onCompositionStartCapture={() => { composing.current = true; }} onCompositionEndCapture={() => { composing.current = false; syncNow.current(); }}>
        {activePanel !== null && <div className={css.pluginPage}>{renderSlot('main', {}, { entryKey: activePanel })}</div>}
        <div className={css.editorSurface} hidden={activePanel !== null}>
        <div className={css.editorToolbar}>
          <div className={css.documentTabsViewport}>
            <div className={css.documentTabs} role="tablist" aria-label={t("legacy.138")}>
              {documents.map(document => (<div key={document.path} className={css.documentTab + (document.path === activePath ? ' ' + css.documentTabActive : '')}>
                  <button type="button" role="tab" aria-selected={document.path === activePath} className={css.documentTabSelect} title={document.path} onClick={() => setActivePath(document.path)}>
                    <span className={css.documentTabName}>{document.name}</span>
                    {document.dirty && <span className={css.documentTabDirty} aria-label={t("legacy.139")}>*</span>}
                  </button>
                  <button type="button" className={css.documentTabClose} aria-label={t("legacy.140", { value0: document.name })} title={t("legacy.141")} onClick={event => { event.stopPropagation(); void closeDocument(document.path); }}>
                    <X size={13} strokeWidth={2} aria-hidden="true"/>
                  </button>
                </div>))}
              {documents.length === 0 && <span className={css.documentTabsEmpty}>{t("legacy.142")}</span>}
            </div>
          </div>
          {activeDocument !== null && !activeIsBinary && (<div className={css.editorHeaderActions}>
              {activeIsMarkdown && activeDocument.visualMode && <div className={css.historyActions} role="group" aria-label={t("legacy.143")}>
                <button type="button" title={t("legacy.144")} aria-label={t("legacy.145")} disabled={!editorHistories[activeDocument.path]?.canUndo} onClick={() => editorHistories[activeDocument.path]?.undo()}><Undo2 size={15} aria-hidden="true"/></button>
                <button type="button" title={t("legacy.146")} aria-label={t("legacy.147")} disabled={!editorHistories[activeDocument.path]?.canRedo} onClick={() => editorHistories[activeDocument.path]?.redo()}><Redo2 size={15} aria-hidden="true"/></button>
              </div>}
              <button className={css.toggleButton} type="button" disabled={!hasDocumentPreview(activeDocument.path)} aria-label={activeIsMarkdown ? (activeDocument.visualMode ? t("legacy.148") : t("legacy.149")) : (activeDocument.visualMode ? t("sourceEdit") : t("switchPreview"))} title={activeIsMarkdown ? (activeDocument.visualMode ? t("legacy.148") : t("legacy.149")) : (activeDocument.visualMode ? t("sourceEdit") : t("switchPreview"))} onClick={() => setDocuments(previous => previous.map(document => document.path === activeDocument.path ? { ...document, visualMode: !document.visualMode } : document))}>
                {activeDocument.visualMode ? <Code2 size={14} strokeWidth={1.9} aria-hidden="true"/> : <Eye size={14} strokeWidth={1.9} aria-hidden="true"/>}
                {activeDocument.visualMode ? t("legacy.150") : activeIsMarkdown ? t("legacy.151") : t("preview")}
              </button>
              <label className={css.autoSaveToggle} title={t("legacy.152")}>
                <input type="checkbox" aria-label={t("legacy.153")} checked={autoSave} onChange={event => setAutoSave(event.target.checked)}/>
                <span className={css.autoSaveSwitch} aria-hidden="true"/>
                <span className={css.autoSaveLabel}>{t("legacy.153")}</span>
              </label>
              <button className={css.saveButton} type="button" onClick={() => void saveDocument(activeDocument.path)} disabled={activeDocument.saving}>
                <Save size={14} strokeWidth={2} aria-hidden="true"/>
                {activeDocument.saving ? t("legacy.036") : activeDocument.dirty ? t("legacy.154") : t("legacy.037")}
              </button>
            </div>)}
        </div>
        {activeDocument === null ? (<div className={css.editorPlaceholder}>{t("legacy.155")}</div>) : null}
        {documents.map(document => (<div key={document.path} className={css.documentEditor} hidden={document.path !== activePath}>
            {isBinaryDocument(document.path) || (document.visualMode && documentKind(document.path) !== 'markdown') ? (<DocumentPreview path={document.path} source={document.draft} revision={fileRevision} request={request} t={t} />) : document.visualMode ? (<VisualEditor initialDoc={document.draft} externalUpdate={document.externalUpdate} onNavigationChange={navigation => setEditorNavigation(previous => ({ ...previous, [document.path]: navigation }))} onHistoryChange={history => setEditorHistories(previous => {
                    const next = { ...previous };
                    if (history === null)
                        delete next[document.path];
                    else
                        next[document.path] = history;
                    return next;
                })} onSelectionChange={next => { if (document.path === activePath)
                setSelection(next === null ? null : { ...next, path: document.path }); }} onChange={draft => setDocuments(previous => previous.map(item => item.path === document.path ? { ...item, draft, dirty: draft !== item.content, saveStatus: null } : item))}/>) : (<Editor path={document.path} initialDoc={document.draft} externalUpdate={document.externalUpdate} mode={documentKind(document.path) === 'markdown' ? 'markdown' : 'text'} reveal={fileRequest?.path === document.path ? fileRequest : null} onSelectionChange={next => { if (document.path === activePath)
                setSelection(next === null ? null : { ...next, path: document.path }); }} onChange={draft => setDocuments(previous => previous.map(item => item.path === document.path ? { ...item, draft, dirty: draft !== item.content, saveStatus: null } : item))}/>)}
          </div>))}
        {contentSearchOpen && activeIsMarkdown && activeDocument?.visualMode && <div className={css.editorFindOverlay} role="search" aria-label={t("legacy.156")}>
          <input autoFocus ref={findInput} aria-label={t("legacy.157")} placeholder={t("legacy.157")} value={findQuery} onChange={event => setFindQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') {
            event.preventDefault();
            runFind(event.shiftKey ? 'previous' : 'next');
        } }}/>
          <span role="status">{findQuery ? findResult.total ? `${findResult.index}/${findResult.total}` : t("legacy.158") : ''}</span>
          <button type="button" aria-label={t("legacy.159")} title={t("legacy.160")} disabled={!findResult.total} onClick={() => runFind('previous')}><ChevronUp size={15}/></button>
          <button type="button" aria-label={t("legacy.161")} title={t("legacy.162")} disabled={!findResult.total} onClick={() => runFind('next')}><ChevronDown size={15}/></button>
          <button type="button" aria-label={t("legacy.163")} title={t("legacy.164")} onClick={() => { setContentSearchOpen(false); navigation?.focus(); }}><X size={15}/></button>
        </div>}
        {activeDocument !== null && <div className={css.editorMeta} aria-label={t("legacy.165")}>{activeIsBinary ? t("readOnlyPreview") : <>{wordCount}{t("legacy.166")}</>}{selection?.path === activePath ? t("legacy.167", { value0: countText(selection.text) }) : ''}<span title={t("legacy.168")}> ⓘ</span></div>}
        {selection !== null && activeDocument !== null && (<div ref={selectionPopoverRef} onMouseDown={event => event.preventDefault()} className={css.selectionPopover} style={{ left: `clamp(12px, ${selection.rect.left}px, calc(100% - 372px))`, top: `clamp(58px, ${selection.rect.bottom + 8}px, calc(100% - 118px))` }} role="dialog" aria-label={t("legacy.169")}>
            {selectionError && <p role="alert">{selectionError}</p>}
            <div className={css.selectionPopoverActions}>
              <button type="button" onClick={() => void submitSelection('current')} disabled={selectionBusy}>{t("legacy.170")}</button>
              <button type="button" onClick={() => void submitSelection('new')} disabled={selectionBusy}>{t("legacy.171")}</button>
            </div>
          </div>)}
        {activeDocument !== null && <div className={css.saveStatus} role="status" aria-live="polite">
          {activeDocument.saving ? t("legacy.036") : activeDocument.saveStatus?.startsWith(t("legacy.072")) ? activeDocument.saveStatus : activeDocument.dirty ? t("legacy.139") : activeDocument.saveStatus ?? t("legacy.070")}
          {activeDocument.saveStatus?.startsWith(t("legacy.072")) && !activeDocument.saving && <button type="button" onClick={() => void saveDocument(activeDocument.path)}>{t("legacy.172")}</button>}
        </div>}
        {activeDocument?.syncError && <div role="alert">{t("legacy.173")}{activeDocument.syncError}{t("legacy.174")}<button type="button" onClick={() => syncNow.current()}>{t("legacy.175")}</button></div>}
        {activeDocument?.conflict && <div className={css.syncNotice} role="alert">
          <span>{activeDocument.conflict.content === null ? t("legacy.176") : t("legacy.177")}</span>
          <button type="button" onClick={() => setConflictOpen(true)}>{t("legacy.178")}</button>
        </div>}
        {conflictOpen && activeDocument?.conflict && <div className={css.closeDialogOverlay + ' ' + css.conflictOverlay}>
          <div className={css.conflictDialog} role="dialog" aria-modal="true" aria-label={t("legacy.179")}>
            <h2>{t("legacy.179")}</h2><p>{activeDocument.path}</p>
            <div className={css.conflictVersions}>
              <label>{t("legacy.180")}<textarea readOnly value={activeDocument.draft}/></label>
              <label>{t("legacy.181")}<textarea readOnly value={activeDocument.conflict.content ?? t("legacy.182")}/></label>
            </div>
            <p>{t("legacy.183")}</p>
            {activeDocument.saveStatus?.startsWith(t("legacy.072")) && <p role="alert">{activeDocument.saveStatus}</p>}
            <div className={css.closeDialogActions}>
              <button type="button" onClick={() => setConflictOpen(false)}>{t("legacy.184")}</button>
              <button type="button" disabled={activeDocument.saving} onClick={() => void resolveConflict(activeDocument)}>{t("legacy.185")}</button>
              <button type="button" disabled={activeDocument.saving} onClick={() => {
                if (window.confirm(t("legacy.186")))
                    void saveDocument(activeDocument.path, { expectedContent: activeDocument.conflict!.content }).then(ok => { if (ok)
                        setConflictOpen(false); });
            }}>{activeDocument.conflict.content === null ? t("legacy.187") : t("legacy.188")}</button>
            </div>
          </div>
        </div>}
        {leaving && <div className={css.closeDialogOverlay}>
          <div className={css.closeDialog} role="dialog" aria-modal="true" aria-labelledby="leave-project-title">
            <h2 id="leave-project-title">{t("legacy.189")}</h2>
            <p>{t("legacy.190")}</p>
            {leaveError && <p role="alert">{leaveError}</p>}
            <div className={css.closeDialogActions}>
              <button type="button" onClick={() => { leaveDecision.current?.(false); leaveDecision.current = null; setLeaving(false); setLeaveError(null); }}>{t("legacy.035")}</button>
              <button type="button" disabled={documents.some(document => document.saving)} onClick={() => void discardAndLeave()}>{t("legacy.191")}</button>
              <button type="button" disabled={documents.some(document => document.saving)} onClick={() => void saveAndLeave()}>{t("legacy.192")}</button>
            </div>
          </div>
        </div>}
        {pendingClosePath !== null && (<div className={css.closeDialogOverlay} role="presentation">
            <div className={css.closeDialog} role="dialog" aria-modal="true" aria-labelledby="close-document-title">
              <h2 id="close-document-title">{t("legacy.193")}</h2>
              <p>{t("legacy.194")}{documents.find(document => document.path === pendingClosePath)?.name ?? ''}{t("legacy.195")}</p>
              <div className={css.closeDialogActions}>
                <button type="button" className={css.closeDialogCancel} onClick={() => setPendingClosePath(null)}>{t("legacy.035")}</button>
                <button type="button" className={css.closeDialogDiscard} disabled={documents.some(document => document.path === pendingClosePath && document.saving)} onClick={() => { const path = pendingClosePath; setPendingClosePath(null); void closeDocument(path, true); }}>{t("legacy.196")}</button>
                <button type="button" className={css.closeDialogSave} disabled={documents.some(document => document.path === pendingClosePath && document.saving)} onClick={() => void confirmSaveAndClose()}>{t("legacy.197")}</button>
              </div>
            </div>
          </div>)}
        </div>
      </section>
      <ResizeHandle label={t("legacy.198")} value={visibleRightWidth} onStart={() => {
        rightDragBase.current = visibleRightWidth;
        rightDragPreferred.current = rightWidth;
        rightDragCollapsed.current = rightCollapsed;
      }} onDrag={resizeRight}/>
      <aside className={css.paneChat} aria-label={t("legacy.199")} data-collapsed={rightCollapsed || undefined}>
        {rightCollapsed && <button className={css.panelToggle} type="button" title={t("legacy.200")} aria-label={t("legacy.200")} aria-expanded={false} onClick={() => setRightCollapsed(false)}><PanelRightOpen size={16} aria-hidden="true"/></button>}
        <div className={css.conversationBar}>
          <div ref={conversationControlRef} className={css.conversationControl}>
            <button className={`${css.conversationAction} ${css.conversationPrimary}`} type="button" title={t("legacy.201")} aria-label={t("legacy.201")} disabled={projectWorkspace === undefined} onClick={() => {
            if (projectWorkspace === undefined)
                return;
            setHistoryOpen(false);
            startSession(projectWorkspace.workspaceId);
        }}>
              <IconNewChatOutline16 size={15}/>
              <span className={css.conversationPrimaryLabel}>{t("legacy.201")}</span>
            </button>
            <button className={`${css.conversationAction} ${css.conversationHistoryAction}`} type="button" aria-label={t("legacy.202", { value0: history.length })} aria-expanded={historyOpen} title={t("legacy.202", { value0: history.length })} onClick={() => { setHistoryOpen(open => !open); }}>
              <History size={15} strokeWidth={1.9} aria-hidden="true"/>
              <span className={css.historyCount} aria-hidden="true">{history.length}</span>
            </button>
          </div>
          <button className={css.panelToggle} type="button" title={t("legacy.203")} aria-label={t("legacy.203")} aria-expanded={true} onClick={() => setRightCollapsed(true)}><PanelRightClose size={16} aria-hidden="true"/></button>
        </div>
        {historyOpen && <SessionBrowser {...props} mode="history" projectPath={projectPath} onClose={() => setHistoryOpen(false)} />}
        {/* The project shell already binds this session to projectPath; keep
            both generic hero controls available for non-Zenwit shells. */}
        <div className={css.workspaceConversation} hidden={rightCollapsed}>
        {renderSlot('main', {}, { entryKey: 'conversation' })}
        </div>
      </aside>
      <ScrollDots root={workspaceRef} label={t('scroll')}/>
      {quickOpen && <div className={css.quickOpenOverlay} role="presentation" onClick={() => setQuickOpen(false)}><div className={css.quickOpen} role="dialog" aria-modal="true" aria-label={t("legacy.206")} onClick={event => event.stopPropagation()}><div className={css.quickOpenHeading}>{t("legacy.206")}<kbd>{t("legacy.207")}</kbd></div><input autoFocus aria-label={t("legacy.106")} value={quickQuery} onChange={event => { setQuickQuery(event.target.value); setQuickIndex(0); }} onKeyDown={event => { if (event.key === 'ArrowDown') {
        event.preventDefault();
        setQuickIndex(index => Math.max(0, Math.min(index + 1, quickFiles.length - 1)));
    } if (event.key === 'ArrowUp') {
        event.preventDefault();
        setQuickIndex(index => Math.max(index - 1, 0));
    } if (event.key === 'Enter' && quickFiles[quickIndex]) {
        const node = quickFiles[quickIndex]!;
        setQuickOpen(false);
        void openFilePath(node.path, node.name);
    } }} placeholder={t("legacy.208")}/><div className={css.quickOpenResults}>{quickFiles.length === 0 && <p>{t("legacy.209")}</p>}{quickFiles.map((node, index) => <button type="button" data-quick-result={index === quickIndex ? 'true' : undefined} aria-current={index === quickIndex ? 'true' : undefined} key={node.path} onClick={() => { setQuickOpen(false); void openFilePath(node.path, node.name); }}>{node.name}<span>{node.path.slice(projectPath.length + 1)}</span></button>)}</div></div></div>}
    </div>);
}
