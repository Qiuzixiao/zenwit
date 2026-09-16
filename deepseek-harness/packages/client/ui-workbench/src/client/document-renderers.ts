/** Client-side document renderer registry: the Workbench extension point for file presentation. */
import type { ComponentType } from 'react'
import type { CopyProps } from './contract.ts'
import type {
  DocumentDescriptor, DocumentResolution, RendererDeclaration, RendererId, RegistrationRejection,
} from './document-descriptor.ts'
import { DOCUMENT_RENDERER_CONTRACT, describeDocument, validateDeclaration } from './document-descriptor.ts'

/** Translate seat threaded to a preview view. */
export type PreviewTranslate = CopyProps['t']

/**
 * Resolve a reference relative to the previewed document.
 * @param relative - a reference with no scheme, drive, or leading separator.
 * @returns a same-origin URL the browser may fetch; the Host enforces project containment.
 */
export type PreviewAssetResolver = (relative: string) => string

/**
 * Props every preview view receives. P0 views are read-only and transport-free:
 * editing belongs to the editor layer, and file bytes reach built-ins through
 * the Workbench's own reader, never through a plugin.
 */
export interface PreviewViewProps {
  /** Absolute project path of the file being previewed. */
  readonly path: string
  /** The descriptor's resolved media type. */
  readonly mediaType: string
  /** Current text draft; empty when the descriptor's storage is binary. */
  readonly source: string
  /** Bumps when the project change feed reports an external write. */
  readonly revision: number
  readonly t: PreviewTranslate
  /** Resolve a document-relative asset through the Host; never build this URL in a renderer. */
  readonly resolve: PreviewAssetResolver
}

/** The lazy module a renderer contributes. */
export interface RendererModule {
  /** Renders one view; a throw during render is the component's defect, not a registry concern. */
  readonly View: ComponentType<PreviewViewProps>
  /** Optional locale key for the view's label, resolved by the owning plugin. */
  readonly label?: string
}

/**
 * A plugin renderer contribution: pure declaration data plus a lazy module loader.
 * `match` is pure data so the registry answers "who claims .mm" without running plugin code.
 */
export interface RendererContribution extends RendererDeclaration {
  /**
   * Loads the view module. The registry calls it at most once per successful
   * load and re-arms it through {@link DocumentRenderers.retry}.
   */
  readonly load: () => Promise<RendererModule>
}

/** One accepted renderer as the inventory reports it. */
export interface RendererInventoryEntry {
  readonly id: RendererId
  readonly builtin: boolean
  readonly status: 'active' | 'load-failed'
}

/** One soft-rejected registration, kept for the renderer inventory. */
export interface RegistrationRejectionRecord {
  readonly id: RendererId
  readonly rejection: RegistrationRejection
}

/** The renderer inventory: what is registered, what failed to load, and what was refused. */
export interface RendererInventory {
  readonly entries: readonly RendererInventoryEntry[]
  readonly rejected: readonly RegistrationRejectionRecord[]
}

/**
 * The Workbench document renderer registry. `describe` is synchronous and cheap
 * because the file tree calls it once per node.
 */
export interface DocumentRenderers {
  /** The single contract version this build implements. */
  readonly contractVersion: number
  /** Bumps on every registration, disposal, or load failure; consumers re-resolve descriptors on change. */
  readonly revision: number
  /**
   * Register one plugin contribution, which must carry a lazy loader.
   * @param contribution - the declaration plus its loader.
   * @returns an idempotent disposer that removes the contribution.
   */
  register(contribution: RendererContribution): () => void
  /**
   * Register a kernel built-in. Built-ins are in-process, have no loader, and
   * win an otherwise exact tie; the Workbench renders them itself.
   * @param declaration - the declaration only.
   * @returns an idempotent disposer that removes the built-in.
   */
  registerBuiltin(declaration: RendererDeclaration): () => void
  /**
   * Resolve a file's descriptor and fallback reason.
   * @param path - the file path.
   * @param size - known byte size, or `undefined` when unknown.
   * @returns the descriptor plus the fallback reason when it has no renderer.
   */
  resolve(path: string, size?: number): DocumentResolution
  /**
   * Resolve a file's descriptor.
   * @param path - the file path.
   * @param size - known byte size, or `undefined` when unknown.
   * @returns the authoritative descriptor.
   */
  describe(path: string, size?: number): DocumentDescriptor
  /**
   * Load a plugin renderer's module, caching success and remembering failure.
   * @param id - the renderer to load.
   * @returns the view module; rejects when the renderer is unknown, is a built-in, or its loader fails.
   */
  load(id: RendererId): Promise<RendererModule>
  /**
   * Clear a failed load so a later descriptor may select the renderer again.
   * @param id - the renderer to re-arm.
   */
  retry(id: RendererId): void
  /**
   * Subscribe to registry revision changes.
   * @param listener - called after every registration, disposal, load failure, or retry.
   * @returns an idempotent unsubscribe.
   */
  subscribe(listener: () => void): () => void
  /** @returns the accepted and rejected renderers, for the settings inventory. */
  inventory(): RendererInventory
  /**
   * The accepted declarations, for adapters that mirror this registry into
   * another one (the engine viewer adapter reads them).
   * @returns every live declaration in registration order.
   */
  declarations(): readonly RendererDeclaration[]
}

declare module '@deepseek-ai/cordis' {
  interface Context { documentRenderers: DocumentRenderers }
}

/**
 * Create one document renderer registry.
 * @param supportedContract - the contract version this build implements.
 * @returns the registry; per-contribution disposers are idempotent.
 */
export function createDocumentRenderers(supportedContract: number = DOCUMENT_RENDERER_CONTRACT): DocumentRenderers {
  const declarationsById = new Map<RendererId, RendererDeclaration>()
  const loaders = new Map<RendererId, () => Promise<RendererModule>>()
  const builtinIds = new Set<RendererId>()
  const failedIds = new Set<RendererId>()
  const modules = new Map<RendererId, RendererModule>()
  const rejected: RegistrationRejectionRecord[] = []
  const listeners = new Set<() => void>()
  let revisions = 0
  let declarations: readonly RendererDeclaration[] = []
  const noop = (): void => undefined

  const notify = (): void => {
    revisions += 1
    for (const listener of [...listeners]) listener()
  }

  const add = (declaration: RendererDeclaration, builtin: boolean): (() => void) | undefined => {
    const rejection = validateDeclaration(declaration, new Set(declarationsById.keys()), supportedContract)
    if (rejection !== undefined) {
      rejected.push({ id: declaration.id, rejection })
      return undefined
    }
    declarationsById.set(declaration.id, declaration)
    if (builtin) builtinIds.add(declaration.id)
    declarations = [...declarationsById.values()]
    notify()
    let disposed = false
    return (): void => {
      if (disposed) return
      disposed = true
      declarationsById.delete(declaration.id)
      builtinIds.delete(declaration.id)
      failedIds.delete(declaration.id)
      modules.delete(declaration.id)
      loaders.delete(declaration.id)
      declarations = [...declarationsById.values()]
      notify()
    }
  }

  const resolve = (path: string, size?: number): DocumentResolution =>
    describeDocument(path, { declarations, builtinIds, failedIds }, size)

  const load = async (id: RendererId): Promise<RendererModule> => {
    if (!declarationsById.has(id)) throw new Error(`unknown document renderer: ${id}`)
    const cached = modules.get(id)
    if (cached !== undefined) return cached
    const loader = loaders.get(id)
    if (loader === undefined) throw new Error(`document renderer ${id} has no loader`)
    try {
      const module = await loader()
      modules.set(id, module)
      if (failedIds.delete(id)) notify()
      return module
    } catch (error) {
      if (!failedIds.has(id)) {
        failedIds.add(id)
        notify()
      }
      throw error
    }
  }

  return {
    contractVersion: supportedContract,
    get revision(): number { return revisions },
    register(contribution: RendererContribution): () => void {
      if (typeof contribution.load !== 'function') {
        rejected.push({ id: contribution.id, rejection: { kind: 'invalid', field: 'load' } })
        return noop
      }
      const dispose = add(contribution, false)
      if (dispose === undefined) return noop
      loaders.set(contribution.id, contribution.load)
      return dispose
    },
    registerBuiltin(declaration: RendererDeclaration): () => void {
      return add(declaration, true) ?? noop
    },
    resolve,
    describe(path: string, size?: number): DocumentDescriptor { return resolve(path, size).descriptor },
    load,
    retry(id: RendererId): void {
      modules.delete(id)
      if (failedIds.delete(id)) notify()
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return (): void => { listeners.delete(listener) }
    },
    inventory(): RendererInventory {
      return {
        entries: [...declarationsById.values()].map(entry => ({
          id: entry.id,
          builtin: builtinIds.has(entry.id),
          status: failedIds.has(entry.id) ? 'load-failed' : 'active',
        })),
        rejected: [...rejected],
      }
    },
    declarations(): readonly RendererDeclaration[] { return declarations },
  }
}
