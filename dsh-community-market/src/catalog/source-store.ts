import { ZENWIT_SOURCE } from '../adapters/zenwit.js'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import type { CatalogSnapshot } from '../contracts/generated/catalog-snapshot.js'
import { validateLocalSourceRecords } from '../contracts/validate.js'
import type { CatalogSourceStore, LocalSourceRecord } from '../contracts/types.js'

export interface MarketCatalogCache {
  readonly version: 1
  readonly sourceRecordId: string
  readonly locale: string
  readonly savedAt: string
  readonly snapshot: CatalogSnapshot
  readonly categories: readonly string[]
  readonly scannedAt: string
  readonly expiresAt: string
  readonly providerRevision?: string
}

export interface MarketSettingsDocument {
  readonly sources: readonly LocalSourceRecord[]
  readonly catalogCache?: MarketCatalogCache
}

/**
 * Reconcile legacy multi-enabled settings into the single active-source model.
 * The first enabled record by user order wins. An all-disabled registry keeps
 * its explicit no-selection state.
 */
export function normalizeActiveSourceRecords(
  records: readonly LocalSourceRecord[],
): readonly LocalSourceRecord[] {
  const ordered = [...records].sort((left, right) => left.order - right.order)
  const activeSourceRecordId = ordered.find(record => record.enabled)?.sourceRecordId
  return ordered.map(record => ({
    ...record,
    enabled: record.sourceRecordId === activeSourceRecordId,
  }))
}

export class SettingsCatalogSourceStore implements CatalogSourceStore {
  constructor(private readonly scope: SettingsScope<MarketSettingsDocument>) {}

  async load(): Promise<readonly LocalSourceRecord[]> {
    // Ignore legacy provider records, including user-supplied URLs.
    return [{ ...ZENWIT_SOURCE }]
  }

  async save(records: readonly LocalSourceRecord[]): Promise<void> {
    if (records.length !== 1 || JSON.stringify(records[0]) !== JSON.stringify(ZENWIT_SOURCE)) {
      throw new Error('Zenwit is the only supported catalog source')
    }
    await this.scope.update({ sources: [{ ...ZENWIT_SOURCE }] })
  }
}

export class MemoryCatalogSourceStore implements CatalogSourceStore {
  private records: readonly LocalSourceRecord[] = []

  async load(): Promise<readonly LocalSourceRecord[]> {
    return this.records
  }

  async save(records: readonly LocalSourceRecord[]): Promise<void> {
    const normalized = normalizeActiveSourceRecords(records)
    validateLocalSourceRecords(normalized)
    this.records = normalized.map(record => ({ ...record }))
  }
}
