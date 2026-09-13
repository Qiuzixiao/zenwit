/** Document-owned CodeMirror and Milkdown editors, retained while their tab is open. */
import { useEffect, useRef } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { Compartment, EditorState as CodeEditorState } from '@codemirror/state'
import { sourceLanguage } from './source-language.ts'
import { markdown } from '@codemirror/lang-markdown'
import { defaultValueCtx, parserCtx, editorViewCtx, Editor as MilkdownEditor, rootCtx, serializerCtx } from '@milkdown/core'
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react'
import { listener, listenerCtx } from '@milkdown/plugin-listener'
import { commonmark } from '@milkdown/preset-commonmark'
import { gfm } from '@milkdown/preset-gfm'
import { history } from '@milkdown/kit/plugin/history'
import { undo, redo, undoDepth, redoDepth } from '@milkdown/kit/prose/history'
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model'
import { EditorState as ProseEditorState, Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import css from './workbench.module.css'

export type EditorMode = 'markdown' | 'text'

/** A non-empty editor selection, positioned in viewport coordinates. */
export interface DocumentSelection {
  /** The selected text as it appears in the editor. */
  text: string
  /** Start offset in the editor document. */
  from: number
  /** End offset in the editor document. */
  to: number
  /** One-based line containing the selection start. */
  startLine: number
  /** One-based line containing the selection end. */
  endLine: number
  /** Bounding viewport rectangle for the selection. */
  rect: { left: number, top: number, right: number, bottom: number }
}

export interface EditorProps {
  path?: string
  reveal?: { line: number | undefined; sequence: number } | null
  externalUpdate?: { content: string } | undefined
  initialDoc: string
  onChange: (doc: string) => void
  onSelectionChange?: (selection: DocumentSelection | null) => void
  mode?: EditorMode
}

function selectionRect(from: { left: number, top: number, right: number, bottom: number }, to: { left: number, top: number, right: number, bottom: number }) {
  return {
    left: Math.min(from.left, to.left),
    top: Math.min(from.top, to.top),
    right: Math.max(from.right, to.right),
    bottom: Math.max(from.bottom, to.bottom),
  }
}

/** Editor (keyed by the parent per open document). */
export function Editor({ initialDoc, externalUpdate, onChange, onSelectionChange, mode = 'markdown', reveal, path = '' }: EditorProps) {
  const viewRef = useRef<EditorView | null>(null)
  useEffect(() => {
    const view = viewRef.current
    if (!view || reveal?.line === undefined) return
    const line = view.state.doc.line(Math.max(1, Math.min(view.state.doc.lines, Math.floor(reveal.line))))
    view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) })
    view.focus()
  }, [reveal])
  const replaceExternal = useRef<((text: string) => void) | null>(null)
  const appliedExternal = useRef(externalUpdate)
  useEffect(() => {
    if (externalUpdate && externalUpdate !== appliedExternal.current) replaceExternal.current?.(externalUpdate.content)
    appliedExternal.current = externalUpdate
  }, [externalUpdate])
  const host = useRef<HTMLDivElement>(null)
  const onChangeRef = useRef(onChange)
  const onSelectionChangeRef = useRef(onSelectionChange)
  onChangeRef.current = onChange
  onSelectionChangeRef.current = onSelectionChange

  useEffect(() => {
    let pointerSelecting = false
    let selectionTimer: number | undefined
    const emitSelection = (view: EditorView): void => {
      const { main } = view.state.selection
      if (main.empty) {
        onSelectionChangeRef.current?.(null)
        return
      }
      const fromRect = view.coordsAtPos(main.from)
      const toRect = view.coordsAtPos(main.to)
      if (fromRect === null || toRect === null) {
        onSelectionChangeRef.current?.(null)
        return
      }
      const document = view.state.doc
      onSelectionChangeRef.current?.({ text: document.sliceString(main.from, main.to), from: main.from, to: main.to, startLine: document.lineAt(main.from).number, endLine: document.lineAt(main.to).number, rect: selectionRect(fromRect, toRect) })
    }
    const scheduleSelection = (view: EditorView): void => {
      if (pointerSelecting) return
      if (selectionTimer !== undefined) window.clearTimeout(selectionTimer)
      selectionTimer = window.setTimeout(() => {
        selectionTimer = undefined
        emitSelection(view)
      }, 180)
    }
    const updateListener = EditorView.updateListener.of(updateEvent => {
      if (updateEvent.docChanged) onChangeRef.current(updateEvent.state.doc.toString())
      if (!updateEvent.selectionSet) return
      scheduleSelection(updateEvent.view)
    })
    const language = new Compartment()
    const extensions = [basicSetup, language.of(mode === 'markdown' ? markdown() : []), updateListener]
    let disposed = false
    let loadedLanguage: import('@codemirror/language').LanguageSupport | undefined
    const view = new EditorView({
      doc: initialDoc,
      extensions,
      parent: host.current!,
    })
    viewRef.current = view
    const description = mode === 'markdown' ? undefined : sourceLanguage(path)
    if (description) void description.load().then(support => {
      if (disposed) return
      loadedLanguage = support
      view.dispatch({ effects: language.reconfigure(support) })
    }).catch(error => { console.error('[workbench] language loading failed', error) })
    if (reveal?.line !== undefined) {
      const line = view.state.doc.line(Math.max(1, Math.min(view.state.doc.lines, Math.floor(reveal.line))))
      view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) })
    }
    replaceExternal.current = text => {
      const scrollTop = view.scrollDOM.scrollTop
      const anchor = Math.min(view.state.selection.main.anchor, text.length)
      view.setState(CodeEditorState.create({ doc: text, extensions, selection: { anchor } }))
      if (loadedLanguage) view.dispatch({ effects: language.reconfigure(loadedLanguage) })
      view.scrollDOM.scrollTop = scrollTop
      onSelectionChangeRef.current?.(null)
    }
    const clearSelection = (): void => onSelectionChangeRef.current?.(null)
    const beginPointerSelection = (): void => {
      pointerSelecting = true
      if (selectionTimer !== undefined) window.clearTimeout(selectionTimer)
    }
    const endPointerSelection = (): void => {
      pointerSelecting = false
      window.requestAnimationFrame(() => emitSelection(view))
    }
    view.dom.addEventListener('blur', clearSelection)
    view.dom.addEventListener('pointerdown', beginPointerSelection)
    view.dom.addEventListener('pointerup', endPointerSelection)
    view.dom.addEventListener('pointercancel', endPointerSelection)
    return () => {
      if (selectionTimer !== undefined) window.clearTimeout(selectionTimer)
      view.dom.removeEventListener('blur', clearSelection)
      view.dom.removeEventListener('pointerdown', beginPointerSelection)
      view.dom.removeEventListener('pointerup', endPointerSelection)
      view.dom.removeEventListener('pointercancel', endPointerSelection)
      replaceExternal.current = null
      viewRef.current = null
      disposed = true
      view.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={host} className={css.editor} />
}

/** Commands and availability for one live visual editor instance. */
export interface EditorHistory {
  canUndo: boolean
  canRedo: boolean
  undo: () => void
  redo: () => void
}

/** Search operations owned by one live visual editor. */
export interface EditorNavigation {
  find: (query: string, direction: 'first' | 'next' | 'previous' | 'count') => { index: number, total: number }
  headings: () => Array<{ title: string, level: number, position: number }>
  jump: (position: number) => void
  text: () => string
  focus: () => void
}

interface SearchIndex {
  text: string
  positions: number[]
}

/** Build searchable plain text while retaining ProseMirror positions. */
function buildSearchIndex(doc: ProseMirrorNode): SearchIndex {
  const characters: string[] = []
  const positions: number[] = []
  const append = (value: string, position: number): void => {
    for (let index = 0; index < value.length; index += 1) {
      characters.push(value[index]!)
      positions.push(position + index)
    }
  }
  const visit = (node: ProseMirrorNode, position: number, root = false): void => {
    if (node.isText) {
      append(node.text ?? '', position)
      return
    }
    if (node.type.name === 'hardbreak') {
      characters.push('\n')
      positions.push(position)
      return
    }
    if (node.isBlock && !root && characters.length > 0 && characters.at(-1) !== '\n') {
      characters.push('\n')
      positions.push(position)
    }
    node.forEach((child, offset) => visit(child, root ? offset : position + 1 + offset))
  }
  visit(doc, 0, true)
  return { text: characters.join(''), positions }
}
const searchPluginKey = new PluginKey<SearchDecorationState>('zenwit-search')

interface SearchDecorationState {
  matches: Array<{ from: number, to: number }>
  active: number
}

interface VisualEditorProps {
  externalUpdate?: { content: string } | undefined
  initialDoc: string
  onChange: (doc: string) => void
  onSelectionChange?: (selection: DocumentSelection | null) => void
  onHistoryChange?: (history: EditorHistory | null) => void
  onNavigationChange?: (navigation: EditorNavigation | null) => void
}

/** Typora-style Markdown editing surface. The document remains Markdown at the boundary. */
function VisualEditorInner({ initialDoc, externalUpdate, onChange, onSelectionChange, onHistoryChange, onNavigationChange }: VisualEditorProps) {
  const replaceExternal = useRef<((text: string) => void) | null>(null)
  const appliedExternal = useRef(externalUpdate)
  useEffect(() => {
    if (externalUpdate && externalUpdate !== appliedExternal.current) replaceExternal.current?.(externalUpdate.content)
    appliedExternal.current = externalUpdate
  }, [externalUpdate])

  const onChangeRef = useRef(onChange)
  const onSelectionChangeRef = useRef(onSelectionChange)
  const selectionTimer = useRef<number | undefined>(undefined)
  const onHistoryChangeRef = useRef(onHistoryChange)
  const onNavigationChangeRef = useRef(onNavigationChange)
  onHistoryChangeRef.current = onHistoryChange
  onNavigationChangeRef.current = onNavigationChange
  onChangeRef.current = onChange
  onSelectionChangeRef.current = onSelectionChange
  useEffect(() => () => {
    if (selectionTimer.current !== undefined) window.clearTimeout(selectionTimer.current)
  }, [])
  useEditor((root) => MilkdownEditor.make()
    .config(ctx => {
      ctx.set(rootCtx, root)
      ctx.set(defaultValueCtx, initialDoc)
      ctx.get(listenerCtx).selectionUpdated((selectionCtx, selection) => {
        if (selectionTimer.current !== undefined) window.clearTimeout(selectionTimer.current)
        selectionTimer.current = window.setTimeout(() => {
          selectionTimer.current = undefined
          if (selection.empty) {
            onSelectionChangeRef.current?.(null)
            return
          }
          const view = selectionCtx.get(editorViewCtx)
          if (!view.hasFocus()) return
          const { from, to } = selection
          onSelectionChangeRef.current?.({
            text: view.state.doc.textBetween(from, to, '\n'), from, to,
            startLine: view.state.doc.textBetween(0, from, '\n').split('\n').length,
            endLine: view.state.doc.textBetween(0, to, '\n').split('\n').length,
            rect: selectionRect(view.coordsAtPos(from), view.coordsAtPos(to)),
          })
        }, 180)
      })
      ctx.get(listenerCtx).blur(() => {
        if (selectionTimer.current !== undefined) window.clearTimeout(selectionTimer.current)
        selectionTimer.current = undefined
        onSelectionChangeRef.current?.(null)
      })
    })
    .use(commonmark)
    .use(gfm)
    .use(history)
    .use($prose(ctx => new Plugin({
      key: searchPluginKey,
      view(view) {
        let initialNode = view.state.doc
        let baselineText = initialDoc
        let replacing = false
        replaceExternal.current = text => {
          const doc = ctx.get(parserCtx)(text)
          if (!doc) return
          const scroll = []
          for (let element: HTMLElement | null = view.dom; element; element = element.parentElement) {
            scroll.push({ element, top: element.scrollTop, left: element.scrollLeft })
          }
          const selection = TextSelection.near(doc.resolve(Math.min(view.state.selection.from, doc.content.size)))
          replacing = true
          initialNode = doc
          baselineText = text
          try {
            view.updateState(ProseEditorState.create({ doc, selection, plugins: view.state.plugins }))
          } finally { replacing = false }
          for (const { element, top, left } of scroll) { element.scrollTop = top; element.scrollLeft = left }
          onSelectionChangeRef.current?.(null)
          publishHistory()
        }
        const publishSearch = (matches: Array<{ from: number, to: number }>, active: number): void => {
          view.dispatch(view.state.tr.setMeta(searchPluginKey, { matches, active }))
        }
        const findMatches = (query: string): Array<{ from: number, to: number }> => {
          const matches: Array<{ from: number, to: number }> = []
          const needle = query.toLocaleLowerCase()
          if (needle === '') return matches
          const index = buildSearchIndex(view.state.doc)
          const haystack = index.text.toLocaleLowerCase()
          let offset = haystack.indexOf(needle)
          while (offset >= 0) {
            const from = index.positions[offset]
            const last = index.positions[offset + query.length - 1]
            if (from !== undefined && last !== undefined) matches.push({ from, to: last + 1 })
            offset = haystack.indexOf(needle, offset + Math.max(1, needle.length))
          }
          return matches
        }
        const publishHistory = () => onHistoryChangeRef.current?.({
          canUndo: undoDepth(view.state) > 0,
          canRedo: redoDepth(view.state) > 0,
          undo: () => { undo(view.state, view.dispatch); view.focus() },
          redo: () => { redo(view.state, view.dispatch); view.focus() },
        })
        publishHistory()
        const find: EditorNavigation['find'] = (query, direction) => {
          const matches = findMatches(query)
          if (matches.length === 0) {
            publishSearch([], -1)
            return { index: 0, total: 0 }
          }
          const selection = view.state.selection
          const selectedIndex = matches.findIndex(match => match.from === selection.from && match.to === selection.to)
          if (direction === 'count') {
            publishSearch(matches, selectedIndex)
            return { index: selectedIndex + 1, total: matches.length }
          }
          let index = direction === 'first' ? 0 : direction === 'next'
            ? matches.findIndex(match => match.from > selection.from)
            : matches.findLastIndex(match => match.to < selection.to)
          if (index < 0) index = direction === 'previous' ? matches.length - 1 : 0
          const match = matches[index]!
          view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, match.from, match.to)).setMeta(searchPluginKey, { matches, active: index }).scrollIntoView())
          // Search keeps focus in its input, so reveal the decoration instead of
          // relying on ProseMirror's focused DOM selection for scrolling.
          view.dom.querySelector('[data-search-current="true"]')?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
          return { index: index + 1, total: matches.length }
        }
        onNavigationChangeRef.current?.({ find, focus: () => view.focus(),
          text: () => view.state.doc.textContent,
          headings: () => {
            const headings: Array<{ title: string, level: number, position: number }> = []
            view.state.doc.descendants((node, position) => {
              if (node.type.name === 'heading') headings.push({ title: node.textContent, level: Number(node.attrs.level), position: position + 1 })
            })
            return headings
          },
          jump: position => { view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, position)).scrollIntoView()); view.focus() },
        })
        return {
          update(_view, previous) {
            if (view.state.doc.eq(previous.doc)) return
            if (replacing) return
            onChangeRef.current(view.state.doc.eq(initialNode) ? baselineText : ctx.get(serializerCtx)(view.state.doc))
            publishHistory()
          },
          destroy() { replaceExternal.current = null; onHistoryChangeRef.current?.(null); onNavigationChangeRef.current?.(null) },
        }
      },
      state: {
        init: (): SearchDecorationState => ({ matches: [], active: -1 }),
        apply(transaction, previous) {
          const next = transaction.getMeta(searchPluginKey) as SearchDecorationState | undefined
          return next ?? (transaction.docChanged ? { matches: [], active: -1 } : previous)
        },
      },
      props: {
        decorations(state) {
          const search = searchPluginKey.getState(state)
          if (search === undefined) return DecorationSet.empty
          return DecorationSet.create(state.doc, search.matches.map((match, index) => Decoration.inline(match.from, match.to, {
            class: index === search.active ? 'searchMatchActive' : 'searchMatch',
            'data-search-current': String(index === search.active),
          })))
        },
      },
    })))
    .use(listener), [])

  return <div className={css.visualEditor}><Milkdown /></div>
}

/** MilkdownProvider owns the editor context for the visual editor instance. */
export function VisualEditor(props: VisualEditorProps) {
  return <MilkdownProvider><VisualEditorInner {...props} /></MilkdownProvider>
}
