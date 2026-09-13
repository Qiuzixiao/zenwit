/** Desktop native capabilities for the single generic workspace Host. */
import { execFile, spawn } from 'node:child_process'
import { mkdirSync, realpathSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { dirname, win32 } from 'node:path'
import { promisify } from 'node:util'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { apply as applyWorkspace, type WorkspaceHostContext } from 'zenwit-workspace'

export const name = 'desktop-workspace'
export const inject = ['webServer', 'connection']

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
    ...config,
    // Resolve trusted launcher aliases such as macOS /var before backend validation.
    homeDir: realpathSync(homeDir),
    expectedOrigin: `http://127.0.0.1:${ctx.webServer.port}`,
    nativeAction,
  })
}
