/** Browser requests for the host-owned generic project and file API. */

/** Project-library row; no agent or domain metadata is needed by this UI. */
export interface ProjectSummary {
  name: string
  path: string
  tags: string[]
  updatedAt: number
  canDelete?: boolean
  available?: boolean
}

const base = '/api/desktop/projects'
async function request(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(base + path, {
    method,
    ...(signal === undefined ? {} : { signal }),
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  })
  const value: unknown = await response.json()
  if (!response.ok) throw new Error(isRecord(value) && typeof value.error === 'string' ? value.error : `Project API: ${response.status}`)
  return value
}
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' }
function project(value: unknown): ProjectSummary {
  if (!isRecord(value) || typeof value.path !== 'string' || typeof value.name !== 'string'
    || typeof value.updatedAt !== 'number' || !Array.isArray(value.tags) || !value.tags.every(tag => typeof tag === 'string')) throw new Error('Invalid project response')
  return { path: value.path, name: value.name, updatedAt: value.updatedAt, tags: value.tags, canDelete: value.canDelete === true, available: value.available !== false }
}
/** Explicit API callbacks injected into the presentation layer. */
export const projectApi = {
  async list(signal?: AbortSignal): Promise<ProjectSummary[]> {
    const value = await request('', 'GET', undefined, signal)
    if (!isRecord(value) || !Array.isArray(value.projects)) throw new Error('Invalid project list response')
    return value.projects.map(project)
  },
  async create(name: string, tags: string[]): Promise<ProjectSummary> {
    const value = await request('', 'POST', { name, tags })
    return project(isRecord(value) ? value.project : undefined)
  },
  async updateTags(path: string, tags: string[]): Promise<ProjectSummary> {
    const value = await request('', 'PATCH', { path, tags })
    return project(isRecord(value) ? value.project : undefined)
  },
  async remove(path: string): Promise<void> { await request('/delete', 'POST', { path }) },
  async forget(path: string): Promise<void> { await request('/forget', 'POST', { path }) },
  async adopt(path: string): Promise<ProjectSummary> {
    const value = await request('/adopt', 'POST', { path })
    return project(isRecord(value) ? value.project : undefined)
  },

}

/** Injected file and project commands. */
export type ProjectApi = typeof projectApi
