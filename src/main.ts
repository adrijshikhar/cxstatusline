import type { Env } from "./env";
import { freemem, platform, totalmem } from "node:os";
import { execFileSync } from "node:child_process";
import { runRender } from "./commands/render";
import { VERSION } from "./version-info";
import { resolvePaths } from "./paths";
import { realContext, type Context } from "./context";
import { appendLog, describeOutcome, runAcquisition, runInstall, runPatch, runUpdate, simulateDrift } from "./patch/run";
import { installHook, uninstallHook } from "./hook/install";
import { realHookDeps, runHook } from "./hook/run";
import { doctorReport, formatDoctor } from "./commands/doctor";
import { revert } from "./commands/revert";
import { getTerminalWidth } from "./utils/terminal";
import { runTUI as runTUIFromApp } from "./tui/App";
import { readMemoryUsage } from "./utils/memory";

import type { TransportOptions } from "./distribution/transport";

export interface MainIo {
  readonly env: Env;
  /** The CLI supplies the real terminal state; embedded tests default to interactive. */
  readonly isTTY?: boolean;
  stdin(): string;
  stdout(s: string): void;
  stderr(s: string): void;
  now(): Date;
}

export interface MainDeps {
  readonly runTUI?: (settingsPath: string) => Promise<void>;
  /**
   * Test seam with the shape of `realContext`. Command dispatch is the thing under test, and a
   * real Context would reach for the owner's own ~/.local, ~/.codex and toolchain to prove it.
   */
  readonly context?: (env: Env, io: { say(line: string): void; log(line: string): void }) => Context;
  readonly transport?: TransportOptions;
}

export const USAGE = `usage: cxstatusline [command]

  (no command)                open the interactive configuration TUI (TTY only)
  render                      read payload v1 on stdin, print one to three ANSI lines
  install [--compile]         install the published Codex pair (--compile builds it from source)
  patch [--force]             build and install the patched Codex from source
  patch --simulate-drift <v>  record <v> as the installed version so the next session sees drift
  update [--compile|--force]  run upstream's own updater, then install the pair for it
  hook [install|uninstall]    manage the SessionStart entry; bare 'hook' is what Codex runs
  doctor                      report toolchain, drift, hook and wrapper state
  revert                      restore stock Codex; keep settings
  --version
`;

/** Built lazily: `render` and `--version` must not touch the filesystem beyond settings.json. */
function contextFor(io: MainIo, deps: MainDeps = {}): Context {
  return (deps.context ?? realContext)(io.env, {
    say: (l) => io.stdout(`${l}\n`),
    log: (l) => appendLog(resolvePaths(io.env).patchLog, l),
  });
}

/**
 * The bare `hook` subcommand. Returns 0 unconditionally.
 * Why contextFor() is inside the try: `resolvePaths` throws when HOME is unset and
 * `realpathSync(process.argv[1])` throws when the renderer link dangles. Both used to happen
 * before the try and took the whole hook down with a non-zero exit.
 */
function runHookCommand(io: MainIo, deps: MainDeps): number {
  try {
    const r = runHook(contextFor(io, deps), io.stdin(), realHookDeps());
    if (r.stdout) io.stdout(`${r.stdout}\n`);
  } catch (e) {
    io.stdout(`${JSON.stringify({ systemMessage: `cxstatusline hook error: ${String(e)}` })}\n`);
  }
  return 0;
}

/** `patch`, `patch --force`, and `patch --simulate-drift <version>`. */
async function patchCommand(argv: readonly string[], io: MainIo, deps: MainDeps): Promise<number> {
  const ctx = contextFor(io, deps);
  const sim = argv.indexOf("--simulate-drift");
  if (sim !== -1) {
    const v = argv[sim + 1];
    if (!v) {
      io.stderr("--simulate-drift needs a version, e.g. `cxstatusline patch --simulate-drift 0.151.0`\n");
      return 2;
    }
    io.stdout(`${simulateDrift(ctx, v)}\n`);
    return 0;
  }
  const outcome = await runPatch(ctx, { force: argv.includes("--force") });
  io.stdout(`${describeOutcome(outcome)}\n`);
  return outcome.kind === "installed" || outcome.kind === "held" ? 0 : 1;
}

/**
 * `install` and `install --compile`. Anything else after `install` is a typo, not a default:
 * silently ignoring an unknown flag would let `install --compiled` quietly download instead.
 */
async function installCommand(argv: readonly string[], io: MainIo, deps: MainDeps): Promise<number> {
  const flags = argv.slice(1);
  if (flags.length > 1 || (flags.length === 1 && flags[0] !== "--compile")) {
    io.stderr(USAGE);
    return 2;
  }
  return runInstall(contextFor(io, deps), { compile: flags[0] === "--compile" }, deps.transport);
}

/**
 * `update`, `update --compile`, and `update --force`.
 */
async function updateCommand(argv: readonly string[], io: MainIo, deps: MainDeps): Promise<number> {
  const flags = argv.slice(1);
  const allowed = new Set(["--compile", "--force", "-y", "--yes"]);
  if (flags.some((f) => !allowed.has(f))) {
    io.stderr(USAGE);
    return 2;
  }
  return runUpdate(
    contextFor(io, deps),
    {
      compile: flags.includes("--compile"),
      force: flags.includes("--force") || flags.includes("-y") || flags.includes("--yes"),
    },
    deps.transport,
  );
}

/**
 * The internal `hook acquire`: what the SessionStart hook spawns detached when it sees drift.
 * Not documented in USAGE and deliberately not a second public install API - it acquires the
 * default (prebuilt) pair and does not touch hooks.json.
 */
async function hookAcquireCommand(io: MainIo, deps: MainDeps): Promise<number> {
  const ctx = contextFor(io, deps);
  const outcome = await runAcquisition(ctx, { source: "prebuilt", force: false });
  ctx.say(describeOutcome(outcome));
  return outcome.kind === "installed" ? 0 : 1;
}

/** `hook install` and `hook uninstall` (the bare `hook` is handled by runHookCommand). */
function hookAdminCommand(sub: string | undefined, io: MainIo, deps: MainDeps): number {
  const ctx = contextFor(io, deps);
  if (sub === "install") {
    const r = installHook(ctx.paths.hooksFile, ctx.cxBin);
    io.stdout(`hook ${r} in ${ctx.paths.hooksFile}\n`);
    if (r === "added") io.stdout("Start Codex once and accept the cxstatusline hook when prompted.\n");
    return 0;
  }
  io.stdout(`hook ${uninstallHook(ctx.paths.hooksFile)}\n`);
  return 0;
}

export async function main(argv: readonly string[], io: MainIo, deps: MainDeps = {}): Promise<number> {
  const [cmd] = argv;
  if (cmd === undefined) {
    if (io.isTTY === false) {
      io.stderr(USAGE);
      return 2;
    }
    await (deps.runTUI ?? runTUIFromApp)(resolvePaths(io.env).settingsFile);
    return 0;
  }
  if (cmd === "--version" || cmd === "-V") {
    io.stdout(`cxstatusline ${VERSION}\n`);
    return 0;
  }
  if (cmd === "render") {
    const r = await runRender(io.stdin(), {
      env: io.env,
      now: io.now(),
      terminalWidth: getTerminalWidth(),
      freeMemoryBytes: freemem(),
      memoryUsage: readMemoryUsage({ platform, totalmem, freemem, execFileSync }, io.now().getTime()),
    });
    if (r.stderr) io.stderr(r.stderr);
    if (r.stdout) io.stdout(r.stdout);
    return r.code;
  }
  if (cmd === "hook" && argv.length === 1) return runHookCommand(io, deps);
  if (cmd === "hook" && argv[1] === "acquire" && argv.length === 2) return hookAcquireCommand(io, deps);
  if (cmd === "patch") return patchCommand(argv, io, deps);
  if (cmd === "update") return updateCommand(argv, io, deps);
  if (cmd === "install") return installCommand(argv, io, deps);
  if (cmd === "hook" && (argv[1] === "install" || argv[1] === "uninstall")) {
    return hookAdminCommand(argv[1], io, deps);
  }
  if (cmd === "doctor") {
    io.stdout(formatDoctor(doctorReport(contextFor(io, deps))));
    return 0;
  }
  if (cmd === "revert") {
    const result = revert(contextFor(io, deps));
    for (const a of result.actions) io.stdout(`${a}\n`);
    return result.code;
  }
  io.stderr(USAGE);
  return 2;
}
