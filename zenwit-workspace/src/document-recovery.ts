/** Private on-disk drafts and bounded document checkpoints, separate from project content. */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface DocumentCheckpoint { id: string; time: number; content: string }
export interface DocumentRecovery {
  path: string
  draft?: { content: string; baseline: string; time: number }
  versions: DocumentCheckpoint[]
}

/** The storage root belongs to application data, never to the editable project. */
export class DocumentRecoveryStore {
  constructor(private readonly root: string) {}

  private directory(project: string): string {
    return join(this.root, createHash('sha256').update(project).digest('hex'))
  }

  private file(project: string, path: string): string {
    return join(this.directory(project), createHash('sha256').update(path).digest('hex') + '.json')
  }

  read(project: string, path: string): DocumentRecovery {
    const file = this.file(project, path)
    if (!existsSync(file)) return { path, versions: [] }
    return JSON.parse(readFileSync(file, 'utf8')) as DocumentRecovery
  }

  update(project: string, record: DocumentRecovery): void {
    const directory = this.directory(project)
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    record.versions = record.versions.slice(-50)
    const file = this.file(project, record.path)
    const temp = file + '.' + randomUUID() + '.tmp'
    try {
      writeFileSync(temp, JSON.stringify(record), { mode: 0o600, flag: 'wx' })
      renameSync(temp, file)
    } finally {
      rmSync(temp, { force: true })
    }
    // Drafts are never evicted. The budget applies only to revision content.
    const records = readdirSync(directory).filter(name => name.endsWith('.json')).map(name => {
      const path = join(directory, name)
      return { path, record: JSON.parse(readFileSync(path, 'utf8')) as DocumentRecovery }
    })
    let bytes = records.reduce((total, item) => total + item.record.versions.reduce((sum, v) => sum + Buffer.byteLength(v.content), 0), 0)
    const oldest = records.flatMap(item => item.record.versions.map(version => ({ item, version }))).sort((a, b) => a.version.time - b.version.time)
    const changed = new Set<typeof records[number]>()
    for (const { item, version } of oldest) {
      if (bytes <= 100 * 1024 * 1024) break
      item.record.versions = item.record.versions.filter(v => v.id !== version.id)
      bytes -= Buffer.byteLength(version.content)
      changed.add(item)
    }
    for (const item of changed) {
      const temporary = item.path + '.' + randomUUID() + '.tmp'
      try {
        writeFileSync(temporary, JSON.stringify(item.record), { mode: 0o600, flag: 'wx' })
        renameSync(temporary, item.path)
      } finally { rmSync(temporary, { force: true }) }
    }
  }

  checkpoint(record: DocumentRecovery, content: string): void {
    if (record.versions.at(-1)?.content === content) return
    record.versions.push({ id: randomUUID(), time: Date.now(), content })
  }
}
