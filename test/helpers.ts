import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Env, RunResult, Runner } from "../src/env";

export function tmpEnv(): { env: Env; root: string } {
  const root = mkdtempSync(join(tmpdir(), "cxstatusline-test-"));
  const env: Env = {
    HOME: root,
    XDG_CONFIG_HOME: join(root, ".config"),
    XDG_STATE_HOME: join(root, ".local", "state"),
    XDG_DATA_HOME: join(root, ".local", "share"),
    CODEX_HOME: join(root, ".codex"),
    PATH: join(root, "usr-bin"),
  };
  return { env, root };
}

/**
 * One recorded `Runner` invocation.
 * Why `| undefined` on `opts`: `exactOptionalPropertyTypes: true` rejects assigning the optional
 * parameter (`{...} | undefined`) to a plain `opts?: {...}` property (TS2379).
 */
export interface RecordedCall {
  cmd: string;
  args: readonly string[];
  opts?: { cwd?: string; interactive?: boolean } | undefined;
}

/** A Runner that replays canned results and records every call, including its options. */
export function fakeExec(
  script: (cmd: string, args: readonly string[]) => Partial<RunResult> | undefined,
): { run: Runner; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const run: Runner = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    const r = script(cmd, args) ?? {};
    return { status: r.status ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  };
  return { run, calls };
}
