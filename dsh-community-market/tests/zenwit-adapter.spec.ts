import { describe, expect, it, vi } from 'vitest'
import { zenwitAdapter, ZENWIT_ENDPOINT, ZENWIT_SOURCE } from '../src/adapters/zenwit.js'
import { DefaultCatalogService } from '../src/catalog/service.js'
import type { CatalogHttpClient, CatalogProviderPage } from '../src/contracts/index.js'

const item = (id: string, category = 'writing') => ({
  id, name: id, displayName: id, summary: 'Writing plugin',
  latestVersion: '0.1.0', package: { registry: 'npm' as const, name: id },
  categories: [category],
})
const page = (items = [item('qnovel-mochi')]): CatalogProviderPage => ({
  schemaVersion: '1.0.0', revision: 'qnovel-4', items, page: { total: items.length },
})
const signal = () => new AbortController().signal

describe('Zenwit catalog', () => {
  it('reads only the fixed endpoint and normalizes npm identity', async () => {
    const getJson = vi.fn(async () => ({ value: page(), finalUrl: ZENWIT_ENDPOINT }))
    const snapshot = await zenwitAdapter.fetch({ limit: 200 }, {
      source: ZENWIT_SOURCE, signal: signal(), http: { getJson }, media: { register: vi.fn() },
    })
    expect(getJson).toHaveBeenCalledWith(ZENWIT_ENDPOINT + '?limit=100', expect.any(AbortSignal), {
      allowedOrigin: 'https://plugins.zenwit.cn',
    })
    expect(snapshot.items[0]).toMatchObject({
      latestVersion: '0.1.0', package: { registry: 'npm', name: 'qnovel-mochi' },
      provenance: { sourceRecordId: ZENWIT_SOURCE.sourceRecordId, providerId: ZENWIT_SOURCE.providerId },
    })
  })

  it('rejects a changed response origin and malformed catalog', async () => {
    const context = { source: ZENWIT_SOURCE, signal: signal(), media: { register: vi.fn() } }
    await expect(zenwitAdapter.fetch({}, { ...context, http: {
      getJson: async () => ({ value: page(), finalUrl: 'https://other.example/plugins' }),
    } })).rejects.toThrow('origin')
    await expect(zenwitAdapter.fetch({}, { ...context, http: {
      getJson: async () => ({ value: { items: [] }, finalUrl: ZENWIT_ENDPOINT }),
    } })).rejects.toThrow()
  })

  it('registers only same-origin images and preserves the plugin when an image is unsafe', async () => {
    const register = vi.fn(() => 'mktimg_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
    const value = page()
    const snapshot = await zenwitAdapter.fetch({}, {
      source: ZENWIT_SOURCE, signal: signal(), media: { register },
      http: { getJson: async () => ({ finalUrl: ZENWIT_ENDPOINT, value: {
        ...value, items: [{ ...value.items[0], media: { icon: { url: 'https://other.example/icon.png' } } }],
      } }) },
    })
    expect(snapshot.items).toHaveLength(1)
    expect(snapshot.items[0]?.media).toBeUndefined()
    expect(register).not.toHaveBeenCalled()
  })

  it('scans pages, caches the index, filters multiple categories and scopes cursors', async () => {
    const getJson = vi.fn<CatalogHttpClient['getJson']>(async url => {
      const second = new URL(url).searchParams.has('cursor')
      return { finalUrl: ZENWIT_ENDPOINT, value: {
        ...page(), items: second ? [item('qnovel-tools', 'tools')] : [item('qnovel-mochi')],
        page: { total: 2, ...(second ? {} : { nextCursor: '1' }) },
      } }
    })
    const service = new DefaultCatalogService({ load: async () => [ZENWIT_SOURCE] }, { getJson })
    const index = await service.scanCatalog(signal())
    expect(index).toBeDefined()
    const query = { q: 'qnovel', category: ['writing', 'tools'], limit: 1 }
    const first = service.queryCatalog(index!, query)[0]!.snapshot!
    expect(first.items[0]?.id).toBe('qnovel-mochi')
    const second = service.queryCatalog(index!, query, {
      sourceRecordId: ZENWIT_SOURCE.sourceRecordId, cursor: first.page.nextCursor!,
    })[0]!.snapshot!
    expect(second.items[0]?.id).toBe('qnovel-tools')
    expect(() => service.queryCatalog(index!, { ...query, q: 'changed' }, {
      sourceRecordId: ZENWIT_SOURCE.sourceRecordId, cursor: first.page.nextCursor!,
    })).toThrow()
    await service.scanCatalog(signal())
    expect(getJson).toHaveBeenCalledTimes(2)
    await service.scanCatalog(signal(), { force: true })
    expect(getJson).toHaveBeenCalledTimes(4)
  })

  it('carries operator-authored categories verbatim, including Chinese display labels', async () => {
    const service = new DefaultCatalogService({ load: async () => [ZENWIT_SOURCE] }, {
      getJson: async () => ({ finalUrl: ZENWIT_ENDPOINT, value: page([
        item('zenwit-plugin-screenplay', '写作'),
        item('zenwit-plugin-mochi', '桌面伙伴'),
      ]) }),
    })
    const index = await service.scanCatalog(signal())
    expect(index).toBeDefined()
    const snapshot = service.queryCatalog(index!, { limit: 10 })[0]!.snapshot!
    expect(snapshot.items.map(entry => entry.categories)).toEqual([['写作'], ['桌面伙伴']])
    // 分类同时充当筛选值与显示标签：中文值原样参与过滤
    expect(service.queryCatalog(index!, { category: ['写作'], limit: 10 })[0]!.snapshot!.items.map(entry => entry.id))
      .toEqual(['zenwit-plugin-screenplay'])
  })

  it('rejects mixed revisions across a paginated scan', async () => {
    const service = new DefaultCatalogService({ load: async () => [ZENWIT_SOURCE] }, {
      getJson: async url => {
        const second = new URL(url).searchParams.has('cursor')
        return { finalUrl: ZENWIT_ENDPOINT, value: {
          ...page([item(second ? 'second' : 'first')]), revision: second ? 'qnovel-5' : 'qnovel-4',
          page: { total: 2, ...(second ? {} : { nextCursor: '1' }) },
        } }
      },
    })
    await expect(service.scanCatalog(signal())).rejects.toThrow()
  })
})
