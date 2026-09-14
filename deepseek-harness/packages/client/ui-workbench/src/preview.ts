/**
 * Public preview contract for document renderer plugins.
 *
 * Type-only: a plugin never imports runtime code from this package. It declares
 * its contribution's contract version as data and reaches the registry through
 * `ctx.documentRenderers`, whose Context merge these re-exports carry.
 * @module @deepseek-ai/dsh-client-ui-workbench/preview
 */
export type {
  DocumentRenderers,
  PreviewAssetResolver,
  PreviewTranslate,
  PreviewViewProps,
  RegistrationRejectionRecord,
  RendererContribution,
  RendererInventory,
  RendererInventoryEntry,
  RendererModule,
} from './client/document-renderers.ts'
export type {
  DocumentDescriptor,
  DocumentViewId,
  DocumentViewMap,
  RegistrationRejection,
  RendererDeclaration,
  RendererFallbackReason,
  RendererId,
  RendererMatch,
  RendererRegistryState,
  StorageClass,
} from './client/document-descriptor.ts'
