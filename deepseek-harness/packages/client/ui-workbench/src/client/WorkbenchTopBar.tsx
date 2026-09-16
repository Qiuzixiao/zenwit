/** Workbench chrome shared by every built-in first-level surface. */
import type { ReactNode } from 'react'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { CopyProps, Panel, WorkbenchProps } from './contract.ts'
import css from './workbench.module.css'

/** Built-in surface the chrome is currently rendered for. */
export type WorkbenchSurface = 'home' | 'library'

/** Chrome props: the live panel registry, the selection, and the surface actions. */
export interface WorkbenchTopBarProps extends CopyProps {
  surface: WorkbenchSurface
  panels: readonly Panel[]
  activePanel: MainPanelId | null
  selectPanel: (id: MainPanelId | null) => void
  goHome: () => void
  openLibrary: () => void
  renderSlot: WorkbenchProps['renderSlot']
  /** Surface-owned tools rendered before the global chrome seats. */
  children?: ReactNode
}

/**
 * Render the brand block, the first-level navigation, the surface tools and the
 * two global chrome seats.
 *
 * Both built-in surfaces render this component so their chrome cannot drift
 * apart; only the tool cluster belongs to the surface.
 */
export function WorkbenchTopBar({
  surface, panels, activePanel, selectPanel, goHome, openLibrary, renderSlot, t, children,
}: WorkbenchTopBarProps) {
  const homeActive = surface === 'home' && activePanel === null
  return (
    <header className={css.homeNav}>
      <div className={css.navBrand} aria-label={t('brand')}>
        <span className={css.brandMark} aria-hidden="true">{t('brandMark')}</span>
        <strong>{t('brand')}</strong>
        <span className={css.brandDivider} aria-hidden="true" />
        <span className={css.brandContext}>{t('legacy.009')}</span>
      </div>
      <nav className={css.navLinks} aria-label={t('legacy.010')}>
        <button
          className={homeActive ? css.navActive : undefined}
          type="button"
          aria-current={homeActive ? 'page' : undefined}
          onClick={goHome}
        >
          {t('legacy.011')}
        </button>
        <button
          type="button"
          className={surface === 'library' ? css.navActive : undefined}
          aria-current={surface === 'library' ? 'page' : undefined}
          onClick={openLibrary}
        >
          {t('legacy.012')}
        </button>
        {panels.map(item => (<button
          key={item.id}
          type="button"
          className={activePanel === item.id ? css.navActive : undefined}
          aria-current={activePanel === item.id ? 'page' : undefined}
          onClick={() => selectPanel(item.id)}
        >
            {renderSlot('sidebar.panellist', { size: 15, active: activePanel === item.id }, { only: item.id })}
            {item.label}
          </button>))}
      </nav>
      <div className={css.navTools}>
        {children}
        <div className={css.navSettings}>{renderSlot('sidebar.settings', { wide: false })}</div>
        <div className={css.navPluginActions}>{renderSlot('sidebar.footer.action', { wide: false })}</div>
      </div>
    </header>
  )
}
