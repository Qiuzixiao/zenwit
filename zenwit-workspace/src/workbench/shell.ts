/**
 * PTY sessions for the workbench terminal.
 *
 * A session is one shell process plus the transcript of what it printed: a
 * browser that reconnects (a reload, a window move, a dropped socket) is sent
 * the transcript before it is attached to the live stream, so the scrollback
 * it lost comes back. Transcripts are bounded — the oldest output is dropped
 * first — because a chatty process (`yes`, a build log) must not grow the
 * host's memory without limit.
 *
 * The PTY dependency is loaded lazily and probed rather than imported at
 * module load: `node-pty` is a native addon, and a build whose ABI does not
 * match the running Electron must degrade to a diagnosable "terminal
 * unavailable" instead of failing the whole Host.
 */
import type { ShellSpawn, ShellSpawnOptions, ShellProcess } from './shell-types.js'

/** Byte cap of one session's replay transcript. */
export const TRANSCRIPT_LIMIT = 256 * 1024

/** One attached listener. */
type Listener<T> = (value: T) => void

/** One live shell session. */
export interface ShellSession {
  /** Session key (session id + tab id, or an agent terminal uuid). */
  readonly key: string
  /** Operating-system process id. */
  readonly pid: number
  /** Whether the process is still running. */
  readonly alive: boolean
  /** The directory the shell was started in. */
  readonly cwd: string
  /** The replay transcript (bounded; oldest output dropped first). */
  transcript(): string
  /** Write keystrokes to the process. */
  write(data: string): void
  /** Report a new terminal size. */
  resize(cols: number, rows: number): void
  /** Terminate the process (the session is dropped once it exits). */
  kill(signal?: string): void
  /** Observe output; returns the unsubscribe. */
  onData(listener: Listener<string>): () => void
  /** Observe exit; returns the unsubscribe. Fires once. */
  onExit(listener: Listener<{ exitCode: number; signal?: number }>): () => void
}

/** What a caller must supply to open a session. */
export interface ShellOpenOptions {
  /** Session key (see {@link ShellSession.key}). */
  key: string
  /** Working directory; the caller has already confined it to a project. */
  cwd: string
  /** Columns and rows to start with. */
  cols: number
  rows: number
}

/** Options of one registry. */
export interface ShellRegistryOptions {
  /** How a shell is started; the default loads `node-pty`. */
  spawn?: ShellSpawn
  /** Environment overrides; defaults to the host environment. */
  env?: Record<string, string | undefined>
  /** Shell executable; defaults to the host's `$SHELL` (or `/bin/sh`). */
  shell?: string
  /** Extra shell arguments (a login shell is used when omitted). */
  shellArgs?: readonly string[]
  /** Transcript cap; defaults to {@link TRANSCRIPT_LIMIT}. */
  transcriptLimit?: number
}

/** The registry's public face. */
export interface ShellRegistry {
  /** Open (or reuse) the session under `key`. */
  open(options: ShellOpenOptions): Promise<ShellSession>
  /** The live session under `key`, when there is one. */
  get(key: string): ShellSession | undefined
  /** Close the session under `key` (no-op when absent). */
  close(key: string): void
  /** Whether the PTY dependency is usable. */
  available(): Promise<{ available: boolean; detail?: string }>
  /** The effective shell executable and its display name. */
  shellInfo(): { shell: string; name: string }
  /** Close every session. */
  dispose(): void
}

/** The message a degraded host reports instead of a terminal. */
export const PTY_UNAVAILABLE_DETAIL = 'node-pty failed to load in this build'

/** Keep the last `limit` bytes of `text`, never splitting a UTF-8 sequence. */
export function boundTranscript(text: string, limit: number): string {
  const buffer = Buffer.from(text, 'utf8')
  if (buffer.byteLength <= limit) return text
  let start = buffer.byteLength - limit
  // Walk forward to the first byte that starts a character.
  while (start < buffer.byteLength && ((buffer[start] ?? 0) & 0xc0) === 0x80) start += 1
  return buffer.subarray(start).toString('utf8')
}

/**
 * The specifier is read through a function so TypeScript does not require the
 * native addon at build time: the desktop runtime provides it (the kernel's
 * terminal provider depends on the same package) and {@link createShellRegistry}
 * reports a load failure as a diagnosable state instead of a build error.
 */
function ptySpecifier(): string {
  return 'node-pty'
}

/** Structural view of the addon's runtime face. */
interface RawPty {
  pid: number
  onData(listener: (chunk: string) => void): { dispose(): void }
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void }
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
}

interface RawPtyModule {
  spawn(shell: string, args: string[], options: {
    name: string; cols: number; rows: number; cwd: string; env: Record<string, string>
  }): RawPty
}

/** Lazily resolve `node-pty`; the failure text is reported to the client. */
async function defaultSpawn(): Promise<ShellSpawn> {
  const module = await import(ptySpecifier()) as unknown as RawPtyModule
  return {
    spawn(options: ShellSpawnOptions): ShellProcess {
      const child = module.spawn(options.shell, [...(options.args ?? [])], {
        name: 'xterm-256color',
        cols: options.cols,
        rows: options.rows,
        cwd: options.cwd,
        env: options.env,
      })
      return {
        pid: child.pid,
        onData: (listener) => { const d = child.onData(listener); return () => { d.dispose() } },
        onExit: (listener) => { const d = child.onExit(listener); return () => { d.dispose() } },
        write: (data) => child.write(data),
        resize: (cols, rows) => child.resize(cols, rows),
        kill: (signal) => child.kill(signal),
      }
    },
  }
}

/**
 * Create one shell registry.
 * @param options - spawn override, environment, shell and transcript bound.
 * @returns the registry.
 */
export function createShellRegistry(options: ShellRegistryOptions = {}): ShellRegistry {
  const sessions = new Map<string, ShellSession>()
  const limit = options.transcriptLimit ?? TRANSCRIPT_LIMIT
  let spawnOverride = options.spawn
  let spawnFailure: string | undefined
  let spawnPromise: Promise<ShellSpawn> | undefined

  const resolveSpawn = async (): Promise<ShellSpawn> => {
    if (spawnOverride !== undefined) return spawnOverride
    spawnPromise ??= defaultSpawn().catch((error: unknown) => {
      spawnFailure = error instanceof Error ? error.message : String(error)
      throw new Error(spawnFailure)
    })
    return await spawnPromise
  }

  const environment = (): Record<string, string> => {
    const base: Record<string, string> = {}
    for (const [name, value] of Object.entries(options.env ?? process.env)) {
      if (value !== undefined) base[name] = value
    }
    return base
  }

  const shellOf = (): { shell: string; args: readonly string[] } => {
    if (options.shell !== undefined) {
      return { shell: options.shell, args: options.shellArgs ?? [] }
    }
    const shell = process.env.SHELL ?? (process.platform === 'win32' ? 'powershell.exe' : '/bin/sh')
    // A login shell picks up the user's profile, which is what a terminal in
    // an editor is expected to be; explicit args replace that flag.
    return { shell, args: options.shellArgs ?? (process.platform === 'win32' ? [] : ['-l']) }
  }

  const open = async (openOptions: ShellOpenOptions): Promise<ShellSession> => {
    const existing = sessions.get(openOptions.key)
    if (existing !== undefined && existing.alive) return existing
    const spawn = await resolveSpawn()
    const { shell, args } = shellOf()
    const dataListeners = new Set<Listener<string>>()
    const exitListeners = new Set<Listener<{ exitCode: number; signal?: number }>>()
    let transcript = ''
    let alive = true
    const child = spawn.spawn({
      shell,
      args,
      cwd: openOptions.cwd,
      cols: openOptions.cols,
      rows: openOptions.rows,
      env: environment(),
    })
    child.onData((chunk) => {
      transcript = boundTranscript(transcript + chunk, limit)
      for (const listener of [...dataListeners]) listener(chunk)
    })
    child.onExit((event) => {
      alive = false
      sessions.delete(openOptions.key)
      for (const listener of [...exitListeners]) listener(event)
      dataListeners.clear()
      exitListeners.clear()
    })
    const session: ShellSession = {
      key: openOptions.key,
      pid: child.pid,
      get alive() { return alive },
      cwd: openOptions.cwd,
      transcript: () => transcript,
      write: (data) => { if (alive) child.write(data) },
      resize: (cols, rows) => { if (alive) child.resize(cols, rows) },
      kill: (signal) => { if (alive) child.kill(signal) },
      onData: (listener) => { dataListeners.add(listener); return () => { dataListeners.delete(listener) } },
      onExit: (listener) => { exitListeners.add(listener); return () => { exitListeners.delete(listener) } },
    }
    sessions.set(openOptions.key, session)
    return session
  }

  return {
    open,
    get: (key) => sessions.get(key),
    close(key) {
      const session = sessions.get(key)
      if (session === undefined) return
      sessions.delete(key)
      session.kill()
    },
    shellInfo() {
      const { shell } = shellOf()
      return { shell, name: shell.split(/[\\/]/u).pop() ?? shell }
    },
    async available() {
      if (spawnOverride !== undefined) return { available: true }
      try {
        await resolveSpawn()
        return { available: true }
      } catch (error) {
        return { available: false, detail: error instanceof Error ? error.message : String(error) }
      }
    },
    dispose() {
      for (const key of [...sessions.keys()]) this.close(key)
    },
  }
}
