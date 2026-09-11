import type { Context } from '@deepseek-ai/cordis'
import {
  deepEqualJson,
  installSettingsSection,
  settingsNamespace,
  type SettingsSectionHooks,
} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { describe, expect, it, vi } from 'vitest'

describe('pre-alpha.2 settings compatibility', () => {
  it('keeps namespace validation while restoring the legacy constructor', () => {
    expect(String(settingsNamespace('dsh-market'))).toBe('dsh-market')
    expect(() => settingsNamespace('DSH Market')).toThrow(TypeError)
  })

  it('re-exports the legacy JSON equality helper from its alpha.2 owner', () => {
    expect(deepEqualJson({ nested: [1, true] }, { nested: [1, true] })).toBe(true)
    expect(deepEqualJson({ nested: [1] }, { nested: [2] })).toBe(false)
  })

  it('delegates the legacy section helper to the alpha.2 provider method', () => {
    const schema = z.object({ enabled: z.boolean().default(true) })
    const entry = { enabled: true }
    const hooks: SettingsSectionHooks<typeof entry> = {
      setSource: vi.fn(),
      onChange: vi.fn(),
    }
    const installSection = vi.fn()
    const settingsContext = { settings: { installSection } }
    const inject = vi.fn((services: string[], callback: (ctx: typeof settingsContext) => void) => {
      expect(services).toEqual(['settings'])
      callback(settingsContext)
    })
    const owner = { inject } as unknown as Context

    installSettingsSection(owner, settingsNamespace('dsh-market'), schema, entry, hooks)

    expect(installSection).toHaveBeenCalledOnce()
    expect(installSection).toHaveBeenCalledWith(owner, 'dsh-market', schema, entry, hooks)
  })

})
