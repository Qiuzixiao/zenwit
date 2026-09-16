/** Desktop native capabilities for the single generic workspace Host. */
import { execFile, spawn } from 'node:child_process'
import { mkdirSync, realpathSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { dirname, win32 } from 'node:path'
import { promisify } from 'node:util'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import {
  apply as applyWorkspace,
  createChangesOpsMethod,
  createJobsKillMethod,
  createJobsOutputMethod,
  createSubagentsLiveMethod,
  type SubagentEntry,
  type WorkbenchSessionEvent,
  type WorkspaceHostContext,
} from 'zenwit-workspace'
import { createSidechatMethods } from './workbench-sidechat.ts'

export const name = 'desktop-workspace'
export const inject = ['webServer', 'connection', 'sessions']

export interface Config {
  homeDir?: string
  projectsDir?: string
}

const execute = promisify(execFile)

/** The backend passes only authorized, canonical paths inside registered projects. */
export async function nativeAction(
  action: 'reveal' | 'terminal',
  path: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  const directory = (await stat(path)).isDirectory() ? path : dirname(path)
  if (platform === 'darwin') {
    await execute('/usr/bin/open', action === 'terminal' ? ['-a', 'Terminal', directory] : ['-R', path])
  } else if (platform === 'win32') {
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
    if (action === 'reveal') {
      await execute(win32.join(systemRoot, 'explorer.exe'), [directory])
    } else {
      // Keep the project path out of PowerShell source, including quotes and metacharacters.
      await execute(win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), [
        '-NoProfile', '-NonInteractive', '-Command',
        "Start-Process powershell.exe -ArgumentList '-NoLogo', '-NoExit' -WorkingDirectory $env:ZENWIT_WORKSPACE_DIRECTORY",
      ], { env: { ...process.env, ZENWIT_WORKSPACE_DIRECTORY: directory } })
    }
  } else if (platform === 'linux') {
    if (action === 'reveal') {
      await execute('xdg-open', [directory])
    } else {
      // A terminal can live longer than the Host request. Confirm launch, then detach.
      await new Promise<void>((resolve, reject) => {
        const child = spawn('x-terminal-emulator', [], { cwd: directory, detached: true, stdio: 'ignore' })
        child.once('error', reject)
        child.once('spawn', () => { child.unref(); resolve() })
      })
    }
  } else {
    throw new Error(`Desktop workspace native actions are unavailable on ${platform}`)
  }
}

/** One registration, using the actual launcher home and the bound loopback origin. */
export function apply(ctx: WorkspaceHostContext, config: Config = {}): void {
  const homeDir = config.homeDir ?? resolveDshHome()
  mkdirSync(homeDir, { recursive: true })
  applyWorkspace(ctx, {
    // Host-supplied engine methods: the session log lens folds the model's own
    // tool calls into the workbench's per-file changes view. The session log
    // lives in the kernel, so the method is built here and joins the package's
    // project-scoped dispatch table.
    extra: {
      'changes.ops': createChangesOpsMethod(sessionId =>
        ctx.sessions?.get(sessionId)?.snapshotEvents() as readonly WorkbenchSessionEvent[] | undefined),
      // The task page refreshes the whole subagent tree in one call: the catalog
      // comes from the kernel subagent runtime, the live lines from each running
      // child's session log.
      'subagents.live': createSubagentsLiveMethod({
        listDescendants: async (rootSessionId: string) => {
          const subagents = ctx.get?.('subagents') as
            | { listDescendants?(rootId: string): Promise<readonly SubagentEntry[]> }
            | undefined
          const list = subagents?.listDescendants
          if (list === undefined) throw new Error('the subagent service is not mounted in this deployment')
          return await list.call(subagents, rootSessionId)
        },
        readEvents: (sessionId: string) =>
          ctx.sessions?.get(sessionId)?.snapshotEvents() as readonly WorkbenchSessionEvent[] | undefined,
      }),
      'jobs.output': createJobsOutputMethod({
        readEvents: (sessionId: string) =>
          ctx.sessions?.get(sessionId)?.snapshotEvents() as readonly WorkbenchSessionEvent[] | undefined,
        outputLimit: 256 * 1024,
      }),
      'jobs.kill': createJobsKillMethod({
        kill: (id, sessionId, reason) => {
          const registry = ctx.get?.('jobs') as
            | { kill?(jobId: string, owner: unknown, note: string): 'requested' | 'already-finished' }
            | undefined
          const cancel = registry?.kill
          if (cancel === undefined) {
            throw new Error('the background-job registry is not mounted in this deployment')
          }
          const agents = ctx.get?.('agents') as { get?(id: string): unknown } | undefined
          return cancel.call(registry, id, agents?.get?.(sessionId), reason)
        },
      }),
      // The side conversations live beside the parent session and are seeded
      // from its log, so they are built here where the agent registry, the
      // session log and the title service are all reachable.
      ...createSidechatMethods(ctx),
    },
    ...config,
    // Resolve trusted launcher aliases such as macOS /var before backend validation.
    homeDir: realpathSync(homeDir),
    expectedOrigin: `http://127.0.0.1:${ctx.webServer.port}`,
    nativeAction,
  })
}
