import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { MarketLocaleKey } from './locales.js'
import { MarketPanel, MarketPanelIcon } from './MarketPanel.js'
import { MarketSettingsTab } from './MarketSettingsTab.js'
import { en, zh } from './locales.js'
import { installMarketStyles } from './styles.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'community-market': MarketLocaleKey
  }
}

export const inject = ['slots', 'locale']
export const NS = 'community-market'

/** Main-panel key and sidebar entry id of the market's first-level view. */
const MARKET_PANEL_ID = 'community-market'

export function apply(ctx: ClientContext): void {
  const readLocale = () => ctx.locale.getLocale().active
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'community-market: dictionaries')
  ctx.effect(() => installMarketStyles(), 'community-market: styles')
  // The workbench offers every registered panel as a first-level entry on its
  // home surface and in the workspace tool row; the keyed `main` entry supplies
  // the page that entry selects.
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: MARKET_PANEL_ID,
    order: 10,
    label: () => ctx.locale.bind(NS)('tab'),
    locale: NS,
  }, MarketPanelIcon))
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: MARKET_PANEL_ID,
    locale: NS,
    inject: () => ({ readLocale }),
  }, MarketPanel))
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'community-market',
    order: 20,
    label: () => ctx.locale.bind(NS)('tab'),
    locale: NS,
    inject: () => ({ readLocale }),
  }, MarketSettingsTab))
}
