/**
 * Lazy chunk loader for the workbench's heavy views.
 *
 * The editor (CodeMirror), terminal (xterm) and diagram (mermaid) stacks are
 * several megabytes; each lives behind a `chunks/<name>.tsx` re-export shim
 * so the view module loads only on first use of the feature that needs it.
 * The kernel bundles one dynamic client artifact per package, so these loads
 * are the bundler's own `import()` rather than a plugin-served chunk script;
 * the loader API (name in, module exports out, one in-flight promise per
 * chunk) is what the views depend on.
 *
 * Test seams: {@link registerChunkForTests} substitutes a loader for one
 * name, and {@link setChunkScriptLoaderForTests} stays as a no-op for older
 * callers.
 */
export type ChunkName = 'terminal' | 'editor' | 'mermaid'

/** The module exports a chunk provides (namespace-ish record). */
export type ChunkExports = Record<string, unknown>

/** Chunk sources: the re-export shims the bundler splits on demand. */
const CHUNK_SOURCES: Record<ChunkName, () => Promise<ChunkExports>> = {
  terminal: () => import('./chunks/terminal.tsx'),
  editor: () => import('./chunks/editor.tsx'),
  mermaid: () => import('./chunks/mermaid.tsx'),
}

/**
 * Platform modules the chunk sources reach: React and the shared UI
 * libraries the kernel's client baseline seeds for every dynamic bundle.
 */
export const CHUNK_EXTERNALS: readonly string[] = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
]

/** The client module system surface callers used to inject (kept for API compatibility). */
export interface ChunkModuleSystem {
  import(specifier: string): Promise<unknown>
}

/** One in-flight load per chunk; a failed load drops its entry so the next open retries. */
const cache = new Map<ChunkName, Promise<ChunkExports>>()

/** Loader overrides installed by tests. */
const testLoaders = new Map<ChunkName, () => Promise<ChunkExports>>()

/**
 * Accept the client module system. The bundled build resolves its externals
 * itself, so the value is not read; the call keeps the activation sequence
 * identical for callers that still pass it.
 * @param system - the module system, or undefined to clear.
 */
export function setChunkModuleSystem(system: ChunkModuleSystem | undefined): void {
  void system
}

/**
 * No-op revalidation hook: a bundled chunk is re-imported with the bundle
 * that owns it, so there is no chunk script to revalidate on re-activation.
 * @returns a resolved promise.
 */
export async function revalidateChunksOnReactivate(): Promise<void> {
  return undefined
}

/**
 * Install a test loader for one chunk name.
 * @param name - the chunk to override.
 * @param loader - the replacement loader.
 */
export function registerChunkForTests(name: ChunkName, loader: () => Promise<ChunkExports>): void {
  testLoaders.set(name, loader)
}

/**
 * Accept a legacy script loader override; the bundled build ignores it.
 * @param loader - the override, or null to clear.
 */
export function setChunkScriptLoaderForTests(loader: (() => Promise<void>) | null): void {
  void loader
}

/**
 * Load one chunk, at most once per name.
 * @param name - the chunk to load.
 * @returns the chunk's exports.
 */
export async function loadChunk(name: ChunkName): Promise<ChunkExports> {
  const cached = cache.get(name)
  if (cached !== undefined) return cached
  const test = testLoaders.get(name)
  const task = test !== undefined ? test() : CHUNK_SOURCES[name]()
  cache.set(name, task)
  void task.catch(() => { cache.delete(name) })
  return task
}

/** Drop all chunk state (a fresh activation re-imports lazily). */
export function resetChunks(): void {
  cache.clear()
  testLoaders.clear()
}
