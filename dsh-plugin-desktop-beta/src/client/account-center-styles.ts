/** Account center styles, installed independently of presentation mode. */

const STYLE_ID = 'dsh-desktop-account-center-styles'

// The workbench frame defines its palette as --zw-* custom properties on the
// frame root, so every value here inherits the live theme (including dark) from
// the surface the panel is rendered into. Each lookup keeps a --dsw-alias
// fallback for hosts that mount the panel outside that frame.
const CSS = `
.dshAccountCenter {
  display: grid;
  grid-template-columns: minmax(300px, 372px) minmax(0, 1fr);
  align-items: start;
  gap: 14px;
  width: 100%;
  min-width: 0;
  padding: 2px 2px 28px 0;
  overflow: auto;
  color: var(--zw-text, var(--dsw-alias-label-primary));
  font-family: var(--dsw-font-family);
}
@media (max-width: 940px) {
  .dshAccountCenter { grid-template-columns: minmax(0, 1fr); }
}

.dshAccountCenterHead {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  min-width: 0;
  padding: 4px 2px 6px;
}
.dshAccountCenterRule {
  flex: none;
  width: min(26vw, 280px);
  height: 1px;
  margin-right: 6%;
  background: linear-gradient(90deg, var(--zw-brand, #1677ff), transparent);
  opacity: .6;
}
.dshAccountCenterKicker {
  color: var(--zw-faint, var(--dsw-alias-label-tertiary));
  font: 10px var(--zw-mono, ui-monospace);
  letter-spacing: .1em;
  text-transform: uppercase;
}
.dshAccountCenterTitle {
  margin: 8px 0 0;
  color: var(--zw-ink, var(--dsw-alias-label-primary));
  font-family: var(--zw-writing, Georgia, serif);
  font-size: clamp(26px, 2.6vw, 34px);
  font-weight: 500;
  line-height: 1.15;
}
.dshAccountCenterIntro { margin: 6px 0 0; color: var(--zw-muted, var(--dsw-alias-label-secondary)); font-size: 13px; }

.dshAccountCenterColumn { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.dshAccountCenterWide { grid-column: 1 / -1; }

.dshAccountCard {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
  padding: 18px;
  border: 1px solid var(--zw-hairline, var(--dsw-alias-border-l1));
  border-radius: var(--zw-r-card, 18px);
  background: var(--zw-surface, var(--dsw-alias-bg-layer-1));
  box-shadow: var(--zw-shadow, none);
}
.dshAccountCardHead { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; min-width: 0; }
.dshAccountCardTitle {
  margin: 6px 0 0;
  color: var(--zw-ink, var(--dsw-alias-label-primary));
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -.01em;
}

.dshAccountStatus {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 7px;
  min-height: 26px;
  padding: 0 11px;
  border: 1px solid var(--zw-hairline, var(--dsw-alias-border-l1));
  border-radius: var(--zw-r-pill, 100px);
  background: var(--zw-surface-2, var(--dsw-alias-bg-layer-2));
  color: var(--zw-muted, var(--dsw-alias-label-secondary));
  font-size: 11px;
  white-space: nowrap;
}
.dshAccountStatusDot { width: 6px; height: 6px; border-radius: 50%; background: var(--zw-faint, var(--dsw-alias-label-tertiary)); }
.dshAccountStatus[data-state="ready"] {
  border-color: color-mix(in srgb, var(--zw-brand, #1677ff) 30%, var(--zw-hairline, transparent));
  background: var(--zw-brand-soft, rgba(22, 119, 255, .1));
  color: var(--zw-brand-deep, #0756c9);
}
.dshAccountStatus[data-state="ready"] .dshAccountStatusDot {
  background: var(--zw-green, #1FA958);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--zw-green, #1FA958) 18%, transparent);
}
.dshAccountStatus[data-state="degraded"] {
  border-color: color-mix(in srgb, var(--zw-danger, #e5484d) 30%, var(--zw-hairline, transparent));
  background: color-mix(in srgb, var(--zw-danger, #e5484d) 8%, transparent);
  color: var(--zw-danger, #e5484d);
}
.dshAccountStatus[data-state="stale"] {
  border-color: color-mix(in srgb, var(--zw-danger, #e5484d) 32%, var(--zw-hairline, transparent));
  background: color-mix(in srgb, var(--zw-danger, #e5484d) 9%, transparent);
  color: var(--zw-danger, #e5484d);
}
.dshAccountStatus[data-state="stale"] .dshAccountStatusDot {
  background: var(--zw-danger, #e5484d);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--zw-danger, #e5484d) 16%, transparent);
}

.dshAccountFacts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 18px; margin: 0; }
.dshAccountFact { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.dshAccountFact dt { color: var(--zw-faint, var(--dsw-alias-label-tertiary)); font-size: 11px; }
.dshAccountFact dd {
  margin: 0;
  overflow: hidden;
  color: var(--zw-text, var(--dsw-alias-label-primary));
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dshAccountBalanceHero { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
.dshAccountBalanceValue {
  color: var(--zw-ink, var(--dsw-alias-label-primary));
  font-size: 34px;
  font-weight: 600;
  letter-spacing: -.02em;
  line-height: 1.05;
  font-variant-numeric: tabular-nums;
}
.dshAccountBalanceGrid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  padding-top: 15px;
  border-top: 1px solid var(--zw-hairline, var(--dsw-alias-border-l1));
}
.dshAccountBalanceCell { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.dshAccountBalanceCell span:first-child { color: var(--zw-faint, var(--dsw-alias-label-tertiary)); font-size: 11px; }
.dshAccountBalanceCell span:last-child {
  color: var(--zw-text, var(--dsw-alias-label-primary));
  font-size: 14px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.dshAccountActions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.dshAccountButton {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 34px;
  padding: 0 14px;
  border: 1px solid var(--zw-brand, #1677ff);
  border-radius: 8px;
  background: var(--zw-brand, #1677ff);
  color: #fff;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
  transition: background 120ms, border-color 120ms, color 120ms;
}
.dshAccountButton:hover:not(:disabled) { border-color: var(--zw-brand-deep, #0756c9); background: var(--zw-brand-deep, #0756c9); }
.dshAccountButton:disabled { cursor: not-allowed; opacity: .55; }
.dshAccountButton[data-variant="secondary"] {
  border-color: var(--zw-hairline-strong, var(--dsw-alias-border-l2));
  background: var(--zw-surface, var(--dsw-alias-bg-layer-1));
  color: var(--zw-text, var(--dsw-alias-label-primary));
  font-weight: 500;
}
.dshAccountButton[data-variant="secondary"]:hover:not(:disabled) {
  border-color: var(--zw-brand, #1677ff);
  background: var(--zw-brand-soft, rgba(22, 119, 255, .1));
  color: var(--zw-brand-deep, #0756c9);
}
.dshAccountButton[data-variant="quiet"] {
  border-color: transparent;
  background: transparent;
  color: var(--zw-muted, var(--dsw-alias-label-secondary));
  font-weight: 500;
}
.dshAccountButton[data-variant="quiet"]:hover:not(:disabled) {
  background: var(--zw-surface-2, var(--dsw-alias-bg-layer-2));
  color: var(--zw-ink, var(--dsw-alias-label-primary));
}
.dshAccountButton[data-variant="quiet"][data-tone="danger"]:hover:not(:disabled) {
  background: color-mix(in srgb, var(--zw-danger, #e5484d) 10%, transparent);
  color: var(--zw-danger, #e5484d);
}
.dshAccountButton:focus-visible { outline: 2px solid color-mix(in srgb, var(--zw-brand, #1677ff) 45%, transparent); outline-offset: 2px; }
.dshAccountSpinner { animation: dshAccountSpin 900ms linear infinite; }
@keyframes dshAccountSpin { to { transform: rotate(360deg); } }

.dshAccountAlert {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 11px 14px;
  border: 1px solid color-mix(in srgb, var(--zw-danger, #e5484d) 30%, var(--zw-hairline, transparent));
  border-radius: var(--zw-r-sm, 12px);
  background: color-mix(in srgb, var(--zw-danger, #e5484d) 8%, transparent);
  color: var(--zw-danger, #e5484d);
  font-size: 12px;
}
.dshAccountAlertText { flex: 1; min-width: 0; }
.dshAccountNotice {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 11px 14px;
  border: 1px solid color-mix(in srgb, var(--zw-brand, #1677ff) 26%, var(--zw-hairline, transparent));
  border-radius: var(--zw-r-sm, 12px);
  background: var(--zw-brand-soft, rgba(22, 119, 255, .1));
  color: var(--zw-brand-deep, #0756c9);
  font-size: 12px;
}
.dshAccountError { margin: 0; color: var(--zw-danger, #e5484d); font-size: 12px; }
.dshAccountHint { margin: 0; color: var(--zw-faint, var(--dsw-alias-label-tertiary)); font-size: 11px; }

.dshAccountEmpty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 300px;
  padding: 28px;
  color: var(--zw-muted, var(--dsw-alias-label-secondary));
  text-align: center;
}
.dshAccountEmpty[data-compact="true"] { min-height: 200px; gap: 8px; }
.dshAccountEmpty > svg { color: var(--zw-brand, #1677ff); }
.dshAccountEmpty strong { color: var(--zw-ink, var(--dsw-alias-label-primary)); font-size: 15px; }
.dshAccountEmpty span { max-width: 420px; font-size: 12px; line-height: 1.6; }
.dshAccountEmpty .dshAccountActions { justify-content: center; margin-top: 6px; }

.dshAccountCode {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 13px 16px;
  border: 1px solid var(--zw-hairline, var(--dsw-alias-border-l1));
  border-radius: var(--zw-r-sm, 12px);
  background: var(--zw-surface-2, var(--dsw-alias-bg-layer-2));
}
.dshAccountCodeValue {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--zw-ink, var(--dsw-alias-label-primary));
  font-family: var(--zw-mono, ui-monospace);
  font-size: 24px;
  font-weight: 600;
  letter-spacing: .16em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dshAccountUsageWrap { min-width: 0; overflow-x: auto; }
.dshAccountUsage { width: 100%; border-collapse: collapse; font-size: 13px; }
.dshAccountUsage th {
  padding: 0 12px 10px;
  border-bottom: 1px solid var(--zw-hairline, var(--dsw-alias-border-l1));
  color: var(--zw-faint, var(--dsw-alias-label-tertiary));
  font: 10px var(--zw-mono, ui-monospace);
  font-weight: 500;
  letter-spacing: .08em;
  text-align: left;
  text-transform: uppercase;
  white-space: nowrap;
}
.dshAccountUsage td {
  padding: 11px 12px;
  color: var(--zw-text, var(--dsw-alias-label-primary));
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.dshAccountUsage tbody tr + tr td { border-top: 1px solid var(--zw-hairline, var(--dsw-alias-border-l1)); }
.dshAccountUsage tbody tr:hover td { background: var(--zw-surface-2, var(--dsw-alias-bg-layer-2)); }
.dshAccountUsage th[data-numeric="true"], .dshAccountUsage td[data-numeric="true"] { text-align: right; }
.dshAccountUsage th:first-child, .dshAccountUsage td:first-child { width: 1%; }
.dshAccountUsage td[data-field="time"] { color: var(--zw-muted, var(--dsw-alias-label-secondary)); font-size: 12px; }
.dshAccountUsage td[data-field="model"] { color: var(--zw-ink, var(--dsw-alias-label-primary)); font-family: var(--zw-mono, ui-monospace); font-size: 12px; }
.dshAccountUsage td[data-field="cost"] { color: var(--zw-ink, var(--dsw-alias-label-primary)); font-weight: 600; }

.dshAccountPager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 2px;
  padding-top: 14px;
  border-top: 1px solid var(--zw-hairline, var(--dsw-alias-border-l1));
}
.dshAccountPagerInfo, .dshAccountUsageCount { color: var(--zw-faint, var(--dsw-alias-label-tertiary)); font: 11px var(--zw-mono, ui-monospace); }

.dshAccountSkeleton {
  height: 13px;
  border-radius: 6px;
  background: var(--zw-surface-2, var(--dsw-alias-bg-layer-2));
}
.dshAccountSkeleton[data-size="title"] { width: 42%; height: 20px; }
.dshAccountSkeleton[data-size="value"] { width: 58%; height: 30px; }
.dshAccountSkeleton[data-size="short"] { width: 24%; }
`

/** Install one scoped stylesheet; tolerate headless Client boot. */
export function installAccountCenterStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  const existing = document.getElementById(STYLE_ID)
  if (existing !== null) return () => {}
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
  return () => { style.remove() }
}
