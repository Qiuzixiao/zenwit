import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only service and SlotMap convergence for the Desktop settings section.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { applyAdvancedShell } from './advanced-shell.ts'
import { applyProductBrand } from './product-brand.tsx'
import { startRendererBootReporter } from './boot-health.ts'
import { applyDesktopSettings } from './desktop-settings.ts'
import { applyDesktopAccountSection } from './AccountSection.tsx'
import { applyDesktopAccountCenter } from './AccountCenter.tsx'
import { installDesktopDirectoryPickerBridge } from './directory-picker.ts'
import { parseDesktopClientEnvironment } from './environment.ts'
import { applyExtendedShell } from './extended-shell.ts'
import { desktopWindowService, provideDesktopWindow } from './window-service.ts'

export { applyAdvancedShell } from './advanced-shell.ts'
export { applyDesktopSettings } from './desktop-settings.ts'
export { AccountSection, applyDesktopAccountSection } from './AccountSection.tsx'
export type {
  DesktopAccountSectionInjected,
  DesktopAccountSectionProps,
} from './AccountSection.tsx'
export {
  AccountCenterIcon,
  AccountCenterPanel,
  DESKTOP_ACCOUNT_PANEL_ID,
  applyDesktopAccountCenter,
} from './AccountCenter.tsx'
export type {
  DesktopAccountCenterIconProps,
  DesktopAccountCenterInjected,
  DesktopAccountCenterPanelProps,
} from './AccountCenter.tsx'
export {
  DESKTOP_CONSOLE_RECHARGE_URL,
  createDesktopAccountApi,
  desktopAccountPaths,
  parseDesktopAccountOverview,
  parseDesktopAccountStatus,
  parseDesktopAccountUsage,
} from './account-api.ts'
export type {
  DesktopAccountApi,
  DesktopAccountErrorCode,
  DesktopAccountOverviewUserView,
  DesktopAccountOverviewView,
  DesktopAccountProviderState,
  DesktopAccountState,
  DesktopAccountStatusView,
  DesktopAccountUsageItemView,
  DesktopAccountUsageQuery,
  DesktopAccountUsageView,
  DesktopAccountUserView,
} from './account-api.ts'
export { applyExtendedShell, applyFramedShell } from './extended-shell.ts'
export {
  createDesktopSettingsApi,
  desktopSettingsPaths,
  parseDesktopActionAcceptance,
  parseDesktopRestartAcceptance,
  parseDesktopSettingsView,
} from './desktop-settings-api.ts'
export type {
  DesktopMarketProvider,
  DesktopMarketView,
  DesktopProfileView,
  DesktopRestartAcceptance,
  DesktopSettingsApi,
  DesktopSettingsView,
} from './desktop-settings-api.ts'
export { DesktopSettingsSection } from './DesktopSettingsSection.tsx'
export { DesktopTerminalSettingsAction } from './DesktopTerminalSettingsAction.tsx'
export type {
  DesktopTerminalSettingsActionInjected,
  DesktopTerminalSettingsActionProps,
} from './DesktopTerminalSettingsAction.tsx'
export type {
  DesktopNotificationSettings,
  DesktopSettingsSectionInjected,
  DesktopSettingsSectionProps,
  DesktopShellSettings,
} from './DesktopSettingsSection.tsx'
export {
  RENDERER_BOOT_REPORT_PATH,
  rendererBootReport,
  sendRendererBootReport,
  startRendererBootReporter,
} from './boot-health.ts'
export type { RendererBootLoader, RendererBootReport } from './boot-health.ts'
export { parseDesktopClientEnvironment } from './environment.ts'
export type {
  DesktopClientEnvironment,
  DesktopClientMaterial,
  DesktopClientMode,
  DesktopClientPlatform,
} from './environment.ts'
export { desktopWindowService, provideDesktopWindow } from './window-service.ts'
export type {
  DesktopWindowDragRegion,
  DesktopWindowInsets,
  DesktopWindowService,
} from './contracts.ts'

/** Services required by Desktop settings and Desktop-owned presentations. */
export const inject = [
  'slots',
  'locale',
  'connection',
  'remote',
  'settingsScope',
  'sessions',
  'theme',
  'uiRenderer',
]

/** Register desktop-owned client surfaces for the current BrowserWindow mode. @param ctx - browser Cordis context. */
export function apply(ctx: ClientContext): void {
  applyProductBrand(ctx)
  const environment = parseDesktopClientEnvironment(window.location.search)
  if (!environment) return
  ctx.effect(
    () => provideDesktopWindow(ctx, desktopWindowService(environment)),
    'dsh-plugin-desktop: native window geometry service',
  )
  const desktopSettings = applyDesktopSettings(ctx, environment)
  applyDesktopAccountSection(ctx)
  applyDesktopAccountCenter(ctx)
  ctx.effect(
    () => startRendererBootReporter(ctx.loader),
    'dsh-plugin-desktop: renderer boot health report',
  )
  if (environment.platform === 'win32') {
    ctx.effect(
      () => installDesktopDirectoryPickerBridge(),
      'dsh-plugin-desktop: native directory picker bridge',
    )
  }
  if (environment.mode === 'advanced') applyAdvancedShell(ctx, environment)
  if (environment.mode === 'extended') applyExtendedShell(ctx, environment, desktopSettings)
}
