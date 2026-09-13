import { useEffect, useState } from 'react'
import { Archive, GitBranch, Pencil, Search, X } from 'lucide-react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionSearchResultItem } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkbenchProps } from './contract.ts'
import css from './workbench.module.css'

type Props = Pick<WorkbenchProps, 't' | 'useSessions' | 'useWorkspaces' | 'useSessionPendingInteraction' | 'usePendingActions'
  | 'openSession' | 'searchSessions' | 'renameSession' | 'archiveSession' | 'forkSession'> & {
  mode: 'history' | 'pending'
  projectPath?: string | undefined
  onClose(): void
}

/** History and attention share session identities, while actions stay with their owners. */
export function SessionBrowser(props: Props) {
  const { t, mode, onClose } = props
  const sessions = props.useSessions(value => value)
  const archived = props.useWorkspaces(value => value.archivedSessionIds)
  const pending = props.useSessionPendingInteraction(value => value)
  const pluginActions = props.usePendingActions(value => value)
  const [scope, setScope] = useState(props.projectPath === undefined || mode === 'pending' ? 'all' : 'project')
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SessionSearchResultItem[]>([])
  const [searching, setSearching] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<string>()
  const [title, setTitle] = useState('')
  const phrase = query.trim()
  useEffect(() => {
    const controller = new AbortController()
    setHits([])
    setHasMore(false)
    setError(undefined)
    setSearching(phrase !== '')
    if (phrase === '') return () => controller.abort()
    const timer = setTimeout(() => {
      void props.searchSessions(phrase, controller.signal).then(result => {
        if (controller.signal.aborted) return
        if (!result.ok) throw new Error(result.error.message)
        setHits(result.value.items)
        setHasMore(result.value.hasMore)
      }).catch(reason => { if (!controller.signal.aborted) setError(String(reason instanceof Error ? reason.message : reason)) })
        .finally(() => { if (!controller.signal.aborted) setSearching(false) })
    }, 250)
    return () => { clearTimeout(timer); controller.abort() }
  }, [phrase, props.searchSessions])
  const snippets = new Map(hits.map(hit => [hit.sessionId, hit.snippet]))
  const rows = Object.values(sessions.byId).filter(session => (mode === 'pending' || !session.blank) && !archived.includes(session.id)
    && (scope === 'all' || session.cwd === props.projectPath)
    && (mode !== 'pending' || pending.has(session.id))
    && (phrase === '' || session.displayTitle.toLocaleLowerCase().includes(phrase.toLocaleLowerCase()) || snippets.has(session.id)))
    .sort((a, b) => b.updatedAt - a.updatedAt)
  const actions = mode === 'pending' ? pluginActions.filter(action => !archived.includes(action.sessionId)) : []
  const perform = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true); setError(undefined)
    try { await action(); setEditing(undefined) }
    catch (reason) { setError(String(reason instanceof Error ? reason.message : reason)) }
    finally { setBusy(false) }
  }
  return <Modal open headless onClose={onClose} title={t(mode === 'history' ? 'history' : 'attention')} className={css.activityPanel!}>
      <header><h2>{t(mode === 'history' ? 'history' : 'attention')}</h2><button type="button" onClick={onClose} aria-label={t('close')} title={t('close')}><X size={18} /></button></header>
      {mode === 'history' && <div className={css.activitySearch}>
        <Search size={16} /><input autoFocus value={query} maxLength={500} aria-label={t('searchConversations')} placeholder={t('searchConversations')} onChange={event => setQuery(event.target.value.replaceAll('\0', ''))} />
        <select value={scope} onChange={event => setScope(event.target.value)} aria-label={t('searchScope')}><option value="all">{t('all')}</option>{props.projectPath !== undefined && <option value="project">{t('currentProject')}</option>}</select>
      </div>}
      <div className={css.activityRows}>
        {actions.map(action => <div key={action.key} className={css.activityRow}><button type="button" onClick={() => { onClose(); action.open() }}><strong>{action.label}</strong><small>{t('pluginApproval')} · {sessions.byId[action.sessionId]?.displayTitle ?? action.sessionId}</small></button></div>)}
        {rows.map(session => <div key={session.id} className={css.activityRow} data-session-row={session.id}>
          <button type="button" onClick={() => { onClose(); props.openSession(session.id) }} aria-current={sessions.current === session.id ? 'true' : undefined}>
            <strong>{session.displayTitle}</strong>
            <small>{session.cwd} · {new Date(session.updatedAt).toLocaleString()}</small>
            <span className={css.activityStatus}>{pending.has(session.id) ? t(pending.get(session.id)?.kind === 'approval' ? 'waitingApproval' : 'waitingAnswer') : t(session.running ? 'sessionRunning' : session.completed ? 'sessionCompleted' : 'sessionIdle')}</span>
            {snippets.has(session.id) && <p>{snippets.get(session.id)}</p>}
          </button>
          {mode === 'history' && <div className={css.activityRowActions}>
            <button type="button" disabled={busy} title={t('rename')} aria-label={t('rename')} onClick={() => { setEditing(session.id); setTitle(session.displayTitle) }}><Pencil size={15} /></button>
            <button type="button" disabled={busy} title={t('forkConversation')} aria-label={t('forkConversation')} onClick={() => { void perform(async () => { await props.forkSession(session.id); onClose() }) }}><GitBranch size={15} /></button>
            <button type="button" disabled={busy} title={t('archiveConversation')} aria-label={t('archiveConversation')} onClick={() => { void perform(() => props.archiveSession(session.id)) }}><Archive size={15} /></button>
          </div>}
          {editing === session.id && <form className={css.activityRename} onSubmit={event => { event.preventDefault(); if (title.trim()) void perform(() => props.renameSession(session.id, title.trim())) }}>
            <input autoFocus aria-label={t('conversationTitle')} value={title} onChange={event => setTitle(event.target.value)} maxLength={200} />
            <button type="submit" disabled={busy || !title.trim()}>{t('save')}</button><button type="button" onClick={() => setEditing(undefined)}>{t('cancel')}</button>
          </form>}
        </div>)}
        {searching && <p role="status">{t('loading')}</p>}
        {!searching && rows.length + actions.length === 0 && <p>{t(mode === 'pending' ? 'noAttention' : 'noConversations')}</p>}
        {hasMore && <p>{t('searchMore')}</p>}
        {error !== undefined && <p role="alert">{error}</p>}
      </div>
  </Modal>
}
