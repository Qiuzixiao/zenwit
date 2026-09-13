/** Independent Desktop frame shared by compatibility and extended modes. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { DesktopSettingsClientControl } from './desktop-settings.ts'
import type { DesktopClientEnvironment } from './environment.ts'
import { installExtendedStyles } from './extended-styles.ts'

export function applyFramedShell(
  ctx: ClientContext,
  environment: DesktopClientEnvironment,
  _settingsControl?: DesktopSettingsClientControl,
): void {
  if (environment.mode !== 'compatibility' && environment.mode !== 'extended') {
    throw new Error(`dsh-plugin-desktop: framed shell received mode ${JSON.stringify(environment.mode)}`)
  }
  ctx.effect(() => {
    const contentViewport = document.getElementById('root')
    if (contentViewport === null) {
      throw new Error('dsh-plugin-desktop: framed shell requires the workbench viewport')
    }
    document.body.dataset.dshDesktopMode = environment.mode
    document.body.dataset.dshDesktopPlatform = environment.platform
    document.body.dataset.dshDesktopMaterial = environment.material
    contentViewport.dataset.dshDesktopContentViewport = ''
    const removeStyles = installExtendedStyles()
    return () => {
      removeStyles()
      delete contentViewport.dataset.dshDesktopContentViewport
      delete document.body.dataset.dshDesktopMode
      delete document.body.dataset.dshDesktopPlatform
      delete document.body.dataset.dshDesktopMaterial
    }
  }, `desktop: independent ${environment.mode} frame styles`)
}

/** Apply content viewport markers beneath the native Desktop frame. */
export function applyExtendedShell(
  ctx: ClientContext,
  environment: DesktopClientEnvironment,
  settingsControl?: DesktopSettingsClientControl,
): void {
  if (environment.mode !== 'extended') {
    throw new Error(`dsh-plugin-desktop: extended shell received mode ${JSON.stringify(environment.mode)}`)
  }
  applyFramedShell(ctx, environment, settingsControl)
}
