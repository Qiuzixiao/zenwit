import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { DesktopClientEnvironment } from './environment.ts'
import { installNativeCaptionStyles } from './styles.ts'

/** Reserve native caption space without owning workbench content. */
export function applyAdvancedShell(ctx: ClientContext, environment: DesktopClientEnvironment): void {
  if (environment.mode !== 'advanced') {
    throw new Error(`dsh-plugin-desktop: advanced shell received mode ${JSON.stringify(environment.mode)}`)
  }

  ctx.effect(() => {
    document.body.dataset.dshDesktopMode = 'advanced'
    document.body.dataset.dshDesktopPlatform = environment.platform
    document.body.dataset.dshDesktopMaterial = environment.material
    const removeStyles = installNativeCaptionStyles()
    return () => {
      removeStyles()
      delete document.body.dataset.dshDesktopMode
      delete document.body.dataset.dshDesktopPlatform
      delete document.body.dataset.dshDesktopMaterial
    }
  }, 'desktop: advanced shell styles')
}
