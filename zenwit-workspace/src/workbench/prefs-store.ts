/**
 * Workbench preference storage.
 *
 * The engine's side-card settings live beside the project library, in one
 * JSON document with a monotonic revision. A writer that carries a stale
 * revision is refused instead of overwriting a newer change (the same
 * revision-guard rule the rest of the settings surface uses).
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { WorkbenchError } from './wire.js'

/** One stored document as callers see it. */
export interface PrefsSnapshot {
  /** The stored value (undefined before the first write). */
  value?: unknown
  /** Monotonic revision; absent before the first write. */
  revision?: number
}

/** The store's face. */
export interface PrefsStore {
  /** Read the current document. */
  get(): Promise<PrefsSnapshot>
  /**
   * Merge a patch into the stored object.
   * @param patch - the fields to merge.
   * @param expectedRevision - when given, the write is refused unless it matches.
   * @returns the fresh snapshot.
   */
  update(patch: Record<string, unknown>, expectedRevision?: number): Promise<PrefsSnapshot>
}

/** The stored envelope. */
interface StoredPrefs {
  value: Record<string, unknown>
  revision: number
}

/**
 * Create one preference store backed by a JSON file.
 * @param file - absolute path of the JSON document.
 * @returns the store.
 */
export function createPrefsStore(file: string): PrefsStore {
  let cached: StoredPrefs | undefined
  let queue: Promise<unknown> = Promise.resolve()

  const read = async (): Promise<StoredPrefs> => {
    if (cached !== undefined) return cached
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8')) as Partial<StoredPrefs>
      cached = {
        value: parsed.value !== null && typeof parsed.value === 'object' ? parsed.value as Record<string, unknown> : {},
        revision: typeof parsed.revision === 'number' ? parsed.revision : 0,
      }
    } catch {
      // A missing or unreadable document is the empty document: the first
      // write creates it, and a corrupted file must not lock the settings page.
      cached = { value: {}, revision: 0 }
    }
    return cached
  }

  /** Serialize writes so two callers cannot interleave a read-modify-write. */
  const serialize = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work)
    queue = next.catch(() => undefined)
    return next
  }

  return {
    async get() {
      const stored = await read()
      return stored.revision === 0 && Object.keys(stored.value).length === 0
        ? {}
        : { value: stored.value, revision: stored.revision }
    },
    async update(patch, expectedRevision) {
      return await serialize(async () => {
        const stored = await read()
        if (expectedRevision !== undefined && expectedRevision !== stored.revision) {
          throw new WorkbenchError('settings-conflict', 'the settings changed since they were read', 409)
        }
        const value = { ...stored.value, ...patch }
        const next: StoredPrefs = { value, revision: stored.revision + 1 }
        await mkdir(dirname(file), { recursive: true })
        const temporary = `${file}.tmp-${process.pid}`
        await writeFile(temporary, JSON.stringify(next), 'utf8')
        await rename(temporary, file)
        cached = next
        return { value, revision: next.revision }
      })
    },
  }
}
