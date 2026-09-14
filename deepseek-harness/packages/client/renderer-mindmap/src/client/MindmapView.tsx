/** Read-only mindmap view: renders the parsed node tree as React elements. */
import type { ReactNode } from 'react'
import type { PreviewViewProps } from '@deepseek-ai/dsh-client-ui-workbench/preview'
import type { MindmapNode } from './mindmap.ts'
import { parseMindmap } from './mindmap.ts'
import css from './MindmapView.module.css'

function Node({ node, t }: { readonly node: MindmapNode; readonly t: PreviewViewProps['t'] }): ReactNode {
  return <li className={css.node} data-folded={node.folded ? 'true' : undefined}>
    <span className={css.label}>{node.text}</span>
    {node.children.length > 0 && <ul className={css.children}>
      {node.children.map((child, index) => <Node key={index} node={child} t={t} />)}
    </ul>}
  </li>
}

/**
 * Render a `.mm` draft as a mindmap.
 * @param props - the preview props; only `source` and `t` are read.
 * @returns the mindmap tree, or a refusal notice.
 */
export function MindmapView({ source, t }: PreviewViewProps): ReactNode {
  const parsed = parseMindmap(source)
  if (!parsed.ok) {
    return <div className={css.mindmap} data-mindmap-error={parsed.reason} role="alert">{t('previewFailed')}</div>
  }
  return <div className={css.mindmap} data-mindmap-root>
    <ul className={css.root}><Node node={parsed.root} t={t} /></ul>
  </div>
}
