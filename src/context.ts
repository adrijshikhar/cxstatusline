import { existsSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Env, Runner } from "./env";
import { resolvePaths, type Paths } from "./paths";
import { realDeps } from "./patch/preflight";

export interface Context {
  readonly env: Env;
  readonly paths: Paths;
  readonly run: Runner;
  which(cmd: string): string | null;
  freeBytes(path: string): number;
  /** Absolute path Codex and the hook will invoke - the installed cxstatusline. */
  readonly cxBin: string;
  readonly patchesDir: string;
  now(): Date;
  /** Verbose build/progress output (goes to the patch log). */
  log(line: string): void;
  /** User-facing lines (stdout). */
  say(line: string): void;
}

function ownBinary(paths: Paths): string {
  // Why rendererLink is preferred: the hook entry records this string, and Codex's trust hash
  // covers the command text. A path that flips between the symlink and the dist file would
  // re-trigger the startup trust review on every change.
  if (existsSync(paths.rendererLink)) return paths.rendererLink;
  return realpathSync(process.argv[1] ?? paths.rendererLink);
}

export function realContext(env: Env, io: { say(line: string): void; log(line: string): void }): Context {
  const paths = resolvePaths(env);
  const deps = realDeps();
  const sccache = deps.which("sccache");
  const run: Runner = (cmd, args, opts) => {
    const baseEnv = opts?.env ? { ...process.env, ...opts.env } : process.env;
    const r = spawnSync(cmd, args, {
      encoding: "utf8",
      cwd: opts?.cwd,
      stdio: opts?.interactive ? "inherit" : "pipe",
      env: sccache && cmd === "cargo" ? { ...baseEnv, RUSTC_WRAPPER: sccache } : baseEnv,
      maxBuffer: 64 * 1024 * 1024,
      ...(opts?.timeoutMs === undefined ? {} : { timeout: opts.timeoutMs, killSignal: "SIGKILL" as const }),
    });
    return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  };
  const own = ownBinary(paths);
  return {
    env,
    paths,
    run,
    which: deps.which,
    freeBytes: deps.freeBytes,
    cxBin: own,
    // Assets belong to the running build, even when the trusted renderer link targets another install.
    patchesDir: fileURLToPath(new URL("../patches", import.meta.url)),
    now: () => new Date(),
    log: io.log,
    say: io.say,
  };
}
