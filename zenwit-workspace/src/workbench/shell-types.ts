/** Structural PTY types, so the registry compiles without the native addon. */

/** One started shell process. */
export interface ShellProcess {
  /** Operating-system process id. */
  readonly pid: number
  /** Observe terminal output. */
  onData(listener: (chunk: string) => void): () => void
  /** Observe process exit (fires once). */
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): () => void
  /** Write keystrokes. */
  write(data: string): void
  /** Report a new terminal size. */
  resize(cols: number, rows: number): void
  /** Terminate the process. */
  kill(signal?: string): void
}

/** What a spawn implementation receives. */
export interface ShellSpawnOptions {
  shell: string
  args: readonly string[]
  cwd: string
  cols: number
  rows: number
  env: Record<string, string>
}

/** How a shell is started (the default loads `node-pty`). */
export interface ShellSpawn {
  spawn(options: ShellSpawnOptions): ShellProcess
}
