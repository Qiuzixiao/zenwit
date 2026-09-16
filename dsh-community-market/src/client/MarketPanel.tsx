import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { MarketStoreIcon } from './MarketLauncher.js'
import { MarketSurface } from './MarketSettingsTab.js'

/** Storefront glyph for the market's first-level workbench entry. */
export function MarketPanelIcon({ size = 16 }: { readonly size?: number }) {
  return <MarketStoreIcon size={size} />
}

export type MarketPanelProps = PropsLocale<'community-market'> & { readonly readLocale: () => string }

/** Market browser hosted by the workbench `main` panel named for this plugin. */
export function MarketPanel({ readLocale, t }: MarketPanelProps) {
  return (
    <div className="dshMarketPanel">
      <MarketSurface readLocale={readLocale} t={t} />
    </div>
  )
}
