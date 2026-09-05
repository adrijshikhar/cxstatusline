/** Process environment as an immutable lookup. Tests build their own. */
export type Env = Readonly<Record<string, string | undefined>>;

/** Result of running a child process synchronously. */
export interface RunResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Synchronous process runner; injected so tests never spawn anything.
 * `interactive` inherits stdio so a child (upstream's own updater) can talk to the user;
 * `stdout`/`stderr` come back empty in that mode.
 */
export type Runner = (
  cmd: string,
  args: readonly string[],
  opts?: { cwd?: string; interactive?: boolean },
) => RunResult;
