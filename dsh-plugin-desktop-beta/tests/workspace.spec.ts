import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, inject, nativeAction } from '../src/workspace.ts'
import { PROJECT_API_PATHS } from 'zenwit-workspace'

const native = vi.hoisted(() => ({ execFile: vi.fn(), spawn: vi.fn() }))
vi.mock('node:child_process', () => native)

const disposers: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose()
  vi.resetAllMocks()
  vi.unstubAllEnvs()
})

function temporaryDirectory(): string {
  const path = realpathSync(mkdtempSync(join(tmpdir(), 'desktop-workspace-')))
  disposers.push(() => { rmSync(path, { recursive: true, force: true }) })
  return path
}

function successfulExec() {
  native.execFile.mockImplementation((...args: unknown[]) => {
    const callback = args.at(-1) as (error: Error | null, stdout: string, stderr: string) => void
    callback(null, '', '')
    return {}
  })
}

describe('desktop workspace native adapter', () => {
  it.each(['darwin', 'win32', 'linux'] as const)('passes paths as data for %s reveal and terminal actions', async platform => {
    successfulExec()
    const root = temporaryDirectory()
    const directory = join(root, "project ' $() ; & name")
    mkdirSync(directory)
    const file = join(directory, 'note.txt')
    writeFileSync(file, 'hello')
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() })
    native.spawn.mockImplementation(() => {
      queueMicrotask(() => child.emit('spawn'))
      return child
    })

    await nativeAction('reveal', file, platform)
    await nativeAction('terminal', file, platform)

    if (platform === 'darwin') {
      expect(native.execFile.mock.calls[0]?.slice(0, 2)).toEqual(['/usr/bin/open', ['-R', file]])
      expect(native.execFile.mock.calls[1]?.slice(0, 2)).toEqual(['/usr/bin/open', ['-a', 'Terminal', directory]])
    } else if (platform === 'win32') {
      expect(native.execFile.mock.calls[0]?.[0]).toMatch(/\\explorer\.exe$/)
      expect(native.execFile.mock.calls[0]?.[1]).toEqual([directory])
      const args = native.execFile.mock.calls[1]?.[1] as string[]
      expect(args.join(' ')).not.toContain(directory)
      expect(args.at(-1)).toContain('$env:ZENWIT_WORKSPACE_DIRECTORY')
      expect(native.execFile.mock.calls[1]?.[2]).toMatchObject({ env: { ZENWIT_WORKSPACE_DIRECTORY: directory } })
    } else {
      expect(native.execFile.mock.calls[0]?.slice(0, 2)).toEqual(['xdg-open', [directory]])
      expect(native.spawn).toHaveBeenCalledWith('x-terminal-emulator', [], { cwd: directory, detached: true, stdio: 'ignore' })
      expect(child.unref).toHaveBeenCalledOnce()
    }
  })

  it('propagates native launcher failures', async () => {
    native.execFile.mockImplementation((...args: unknown[]) => {
      const callback = args.at(-1) as (error: Error) => void
      callback(new Error('launcher failed'))
    })
    await expect(nativeAction('reveal', temporaryDirectory(), 'darwin')).rejects.toThrow('launcher failed')
  })

  it.each([false, true])('uses the app home (explicit: %s), registers once and fences native actions', async explicitHome => {
    successfulExec()
    const directory = temporaryDirectory()
    const homeDir = join(directory, 'actual-home')
    mkdirSync(homeDir)
    const homeAlias = join(directory, 'home-alias')
    symlinkSync(homeDir, homeAlias, 'junction')
    vi.stubEnv('DSH_HOME', explicitHome ? join(directory, 'other-dsh-home') : homeAlias)
    vi.stubEnv('ZENWIT_HOME', join(directory, 'wrong-home'))
    const routes = new Map<string, (req: IncomingMessage, res: ServerResponse) => Promise<void>>()
    const effects: Array<() => void> = []
    let rejection: number | undefined
    const server = createServer((req, res) => {
      const handler = routes.get(new URL(req.url ?? '/', 'http://localhost').pathname)
      if (handler) void handler(req, res)
      else { res.writeHead(404); res.end() }
    })
    await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
    disposers.push(async () => {
      effects.reverse().forEach(dispose => { dispose() })
      server.closeAllConnections()
      await new Promise<void>(resolve => { server.close(() => { resolve() }) })
      expect(routes.size).toBe(0)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('missing bound address')
    const origin = `http://127.0.0.1:${address.port}`
    apply({
      webServer: {
        port: address.port,
        register: route => {
          expect(routes.has(route.path)).toBe(false)
          routes.set(route.path, route.handler)
          return () => { routes.delete(route.path) }
        },
      },
      connection: { requestRejection: () => rejection },
      effect: callback => { effects.push(callback()) },
    }, { projectsDir: join(directory, 'projects'), ...(explicitHome ? { homeDir: homeAlias } : {}) })
    expect(inject).toEqual(['webServer', 'connection'])
    expect([...routes.keys()]).toEqual([...PROJECT_API_PATHS])
    const post = (suffix: string, body: unknown, headers: Record<string, string> = {}) => fetch(origin + '/api/desktop/projects' + suffix, {
      method: 'POST', headers: { origin, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
    })
    const created = await post('', { name: 'Notes' })
    expect(created.status).toBe(200)
    const { project } = await created.json() as { project: { path: string } }
    expect(readFileSync(join(homeDir, 'workspace', 'projects.json'), 'utf8')).toContain(project.path)

    for (const route of ['/reveal', '/terminal']) {
      native.execFile.mockClear()
      native.spawn.mockClear()
      native.spawn.mockImplementation(() => {
        const child = Object.assign(new EventEmitter(), { unref: vi.fn() })
        queueMicrotask(() => child.emit('spawn'))
        return child
      })
      expect((await post(route, { path: project.path }, { origin: 'https://attacker.example' })).status).toBe(403)
      expect((await post(route, { path: project.path }, { origin: 'null' })).status).toBe(403)
      expect((await post(route, { path: project.path }, { 'sec-fetch-site': 'cross-site' })).status).toBe(403)
      rejection = 401
      expect((await post(route, { path: project.path })).status).toBe(401)
      rejection = undefined
      expect((await post(route, { path: homeDir })).status).toBe(403)
      expect(native.execFile).not.toHaveBeenCalled()
      expect(native.spawn).not.toHaveBeenCalled()
      expect((await post(route, { path: project.path })).status).toBe(200)
      expect(native.execFile.mock.calls.length + native.spawn.mock.calls.length).toBe(1)
    }
  })
})
