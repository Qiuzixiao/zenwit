import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'

export function ZenwitMark({ size = 24, className }: { size?: number; className?: string | undefined }) {
  return <svg className={className} width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <path fill="currentColor" d="M5 5h22v5L12 22h15v5H5v-5L20 10H5z" />
  </svg>
}

export function ZenwitName() {
  return <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: 0 }}>zenwit</span>
}

export function applyProductBrand(ctx: Context): void {
  ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register({
    name: 'sidebar.brand.mark',
  }, ZenwitMark))
  ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register({
    name: 'sidebar.brand.name',
  }, ZenwitName))
  ctx.slots.inject('conversation.hero.brand.mark', () => ctx.slots.register({
    name: 'conversation.hero.brand.mark',
  }, ZenwitMark))
}
