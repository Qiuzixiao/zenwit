/** Generic project vocabulary: project summaries and creation results. */

export interface ProjectSummary {
  /** Directory basename — the single canonical project title. */
  name: string
  /** Absolute project directory path. */
  path: string
  updatedAt: number
  /** Agent bound to this project, when one has been selected. */
  agentId?: string
  /** User-owned project classification labels. */
  tags: string[]
  /** Only application-created library projects support permanent deletion. */
  canDelete: boolean
  /** A registered directory can temporarily be offline or moved. */
  available: boolean
}

export const PROJECT_TAG_LIMIT = 8
export const PROJECT_TAG_MAX_LENGTH = 24

/** Normalize and validate project tags at every write boundary. */
export function normalizeProjectTags(value: unknown): string[] {
  if (!Array.isArray(value)) throw new TypeError('project tags must be an array')
  if (value.length > PROJECT_TAG_LIMIT) throw new TypeError(`a project may have at most ${PROJECT_TAG_LIMIT} tags`)
  const result: string[] = []
  const seen = new Set<string>()
  for (const candidate of value) {
    if (typeof candidate !== 'string') throw new TypeError('project tags must be strings')
    const tag = candidate.normalize('NFKC').trim()
    if (tag.length === 0) throw new TypeError('project tags must not be empty')
    if ([...tag].length > PROJECT_TAG_MAX_LENGTH) {
      throw new TypeError(`project tags may have at most ${PROJECT_TAG_MAX_LENGTH} characters`)
    }
    const key = tag.toLocaleLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(tag)
  }
  return result
}

/** Read optional legacy metadata without making one malformed field hide a project. */
export function readProjectTags(value: unknown): string[] {
  if (value === undefined) return []
  try { return normalizeProjectTags(value) } catch { return [] }
}

export interface ProjectLibrarySnapshot {
  root: string
  projects: ProjectSummary[]
}

export interface ProjectCreated {
  project: ProjectSummary
}
