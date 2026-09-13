/** Authoritative registry in private app data; project content never grants access. */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

export class ProjectRegistry {
  constructor(private readonly file: string) {}

  private read(): Record<string, Record<string, unknown>> {
    let source: string
    try { source = readFileSync(this.file, 'utf8') }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return Object.create(null) as Record<string, Record<string, unknown>>
      throw error
    }
    const value = JSON.parse(source) as { version?: unknown; projects?: unknown }
    if (value?.version !== 1 || !value.projects || typeof value.projects !== 'object' || Array.isArray(value.projects)
      || Object.values(value.projects).some(record => !record || typeof record !== 'object' || Array.isArray(record))) {
      throw new Error('invalid workspace registry')
    }
    return value.projects as Record<string, Record<string, unknown>>
  }

  get(path: string): Record<string, unknown> | undefined {
    return this.read()[path]
  }

  paths(): string[] {
    return Object.keys(this.read())
  }

  private write(projects: Record<string, Record<string, unknown>>): void {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 })
    const temporary = this.file + '.' + randomUUID() + '.tmp'
    try {
      writeFileSync(temporary, JSON.stringify({ version: 1, projects }) + '\n', { flag: 'wx', mode: 0o600 })
      renameSync(temporary, this.file)
    } finally { rmSync(temporary, { force: true }) }
  }

  set(path: string, metadata: Record<string, unknown>): void {
    const projects = this.read()
    projects[path] = metadata
    this.write(projects)
  }

  delete(path: string): void {
    const projects = this.read()
    delete projects[path]
    this.write(projects)
  }
}
