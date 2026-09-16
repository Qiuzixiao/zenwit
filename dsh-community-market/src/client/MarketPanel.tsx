import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { MarketSurface } from './MarketSettingsTab.js'

/** Storefront glyph for the market's first-level workbench entry. */
export function MarketStoreIcon({ size = 16 }: { readonly size?: number }) {
  return (
    <svg
      data-icon="market-store"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M2.25 6.25v6.5c0 .55.45 1 1 1h9.5c.55 0 1-.45 1-1v-6.5"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M1.5 5.75 2.75 2.5h10.5l1.25 3.25a2 2 0 0 1-3.25 1.55A2 2 0 0 1 8 7.3a2 2 0 0 1-3.25 0A2 2 0 0 1 1.5 5.75Z"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M6 13.75v-3.5h4v3.5" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
    </svg>
  )
}

/** First-level workbench entry glyph; the entry label owns the copy. */
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
