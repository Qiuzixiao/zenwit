import type { CatalogAdapter, LocalSourceRecord } from '../contracts/types.js'
import { parseCatalogProviderPage } from '../contracts/validate.js'
import { normalizeCatalogQuery } from '../contracts/query.js'
import { snapshotFromStandardPage } from './standard-http.js'

export const ZENWIT_ENDPOINT = 'https://plugins.zenwit.cn/v1/plugins'
export const ZENWIT_HOSTNAME = 'plugins.zenwit.cn'
export const ZENWIT_SOURCE: LocalSourceRecord = Object.freeze({
  sourceRecordId: '62f0a590-9425-4b3e-9f48-9c06e47e1932',
  registrationKind: 'built-in',
  adapterId: 'market.zenwit-v1',
  providerId: 'com.qnovel.plugins',
  builtInProviderKey: 'zenwit',
  enabled: true,
  order: 0,
})

export const zenwitAdapter: CatalogAdapter = {
  adapterId: ZENWIT_SOURCE.adapterId,
  async fetch(queryValue, context) {
    const query = normalizeCatalogQuery(queryValue)
    const url = new URL(ZENWIT_ENDPOINT)
    const limit = Math.min(query.limit ?? 50, 100)
    url.searchParams.set('limit', String(limit))
    if (query.cursor !== undefined) url.searchParams.set('cursor', query.cursor)
    // Search and category filtering use the complete local index, preserving
    // multi-category semantics even though the API accepts one category.
    const response = await context.http.getJson(url.href, context.signal, { allowedOrigin: url.origin })
    if (new URL(response.finalUrl).origin !== url.origin) throw new Error('Zenwit catalog origin changed')
    return snapshotFromStandardPage(parseCatalogProviderPage(response.value, limit), context, response.finalUrl)
  },
}
