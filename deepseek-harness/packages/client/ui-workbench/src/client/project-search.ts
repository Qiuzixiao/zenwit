/** Project list filtering shared by the home and project-library surfaces. */
import type { ProjectSummary } from './project-api.ts'

/** Tags carried by one project; the library wire may omit the field entirely. */
export function projectTags(project: ProjectSummary): string[] {
  return Array.isArray(project.tags) ? project.tags : []
}

/** True when the query appears in a project's name, path, or tags. */
export function projectMatches(project: ProjectSummary, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase()
  if (normalized === '') return true
  return [project.name, project.path, ...projectTags(project)]
    .some(value => value.toLocaleLowerCase().includes(normalized))
}
