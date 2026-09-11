import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import { describe, expect, it, vi } from 'vitest'
import { SettingsCatalogSourceStore, type MarketSettingsDocument } from '../src/catalog/source-store.js'
import { ZENWIT_SOURCE } from '../src/adapters/zenwit.js'

describe('fixed Zenwit source', () => {
  it.each([{ sources: [] }, { sources: [{ ...ZENWIT_SOURCE, adapterId: 'market.standard-http-v1', manifestUrl: 'https://other.example/catalog.json' }] }])('ignores legacy source settings %j', async ({ sources }) => {
    const scope = { get: () => ({ sources }), update: vi.fn() } as unknown as SettingsScope<MarketSettingsDocument>
    expect(await new SettingsCatalogSourceStore(scope).load()).toEqual([ZENWIT_SOURCE])
    expect(scope.update).not.toHaveBeenCalled()
  })

  it('rejects replacement or removal of the fixed source', async () => {
    const update = vi.fn()
    const store = new SettingsCatalogSourceStore({ update } as unknown as SettingsScope<MarketSettingsDocument>)
    await expect(store.save([])).rejects.toThrow('only supported')
    await expect(store.save([{ ...ZENWIT_SOURCE, enabled: false }])).rejects.toThrow('only supported')
    expect(update).not.toHaveBeenCalled()
    await store.save([ZENWIT_SOURCE])
    expect(update).toHaveBeenCalledWith({ sources: [ZENWIT_SOURCE] })
  })
})
