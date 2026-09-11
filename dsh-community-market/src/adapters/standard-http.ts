import type { CatalogFetchContext } from '../contracts/types.js'
import type { CatalogProviderPage } from '../contracts/generated/catalog-provider-page.js'
import type { CatalogSnapshot } from '../contracts/generated/catalog-snapshot.js'
import { normalizeRepositoryIdentity } from '../contracts/identity.js'
import { parseCatalogSnapshot } from '../contracts/validate.js'

export function snapshotFromStandardPage(
  page: CatalogProviderPage,
  context: Pick<CatalogFetchContext, 'source' | 'media'>,
  finalUrl: string,
): CatalogSnapshot {
  const fetchedAt = new Date().toISOString()
  const providerOrigin = new URL(finalUrl).origin
  return parseCatalogSnapshot({
    schemaVersion: '1.0.0',
    source: {
      sourceRecordId: context.source.sourceRecordId,
      providerId: context.source.providerId,
      adapterId: context.source.adapterId,
      registrationKind: context.source.registrationKind,
      fetchedAt,
      finalUrl,
      ...(page.generatedAt === undefined ? {} : { providerGeneratedAt: page.generatedAt }),
      ...(page.revision === undefined ? {} : { providerRevision: page.revision }),
    },
    items: page.items.map(item => {
      const { media, repository, ...plainItem } = item
      const normalizedRepository = repository === undefined
        ? undefined
        : normalizeRepositoryIdentity(repository)
      let resolvedMedia: CatalogSnapshot['items'][number]['media']
      if (media !== undefined) {
        try {
          const remoteUrl = new URL(media.icon.url)
          if (remoteUrl.origin !== providerOrigin) {
            throw new Error('standard catalog icons must use the provider response origin')
          }
          const assetRef = context.media.register({
            remoteUrl: remoteUrl.href,
            role: 'plugin-icon',
            ...(media.icon.alt === undefined ? {} : { alt: media.icon.alt }),
            sourceRecordId: context.source.sourceRecordId,
            itemId: item.id,
            allowedHostnames: [remoteUrl.hostname],
          })
          resolvedMedia = {
            icon: {
              assetRef,
              role: 'plugin-icon',
              ...(media.icon.alt === undefined ? {} : { alt: media.icon.alt }),
            },
          }
        } catch {
          // Optional media is isolated from the otherwise valid catalog item.
        }
      }
      return {
        ...plainItem,
        ...(normalizedRepository === undefined ? {} : { repository: normalizedRepository }),
        ...(resolvedMedia === undefined ? {} : { media: resolvedMedia }),
        provenance: {
          sourceRecordId: context.source.sourceRecordId,
          providerId: context.source.providerId,
          itemId: item.id,
        },
      }
    }),
    page: page.page,
  })
}
