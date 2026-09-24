import type { Env } from "./env";
import { freemem, platform, totalmem } from "node:os";
import { execFileSync } from "node:child_process";
import { runRender } from "./commands/render";
import { runRefreshCommand } from "./commands/refresh-command";
import { VERSION } from "./version-info";
import { resolvePaths } from "./paths";
import { realContext, type Context } from "./context";
import { appendLog, describeOutcome, runAcquisition, runInstall, runPatch, runUpdate, simulateDrift } from "./patch/run";
import { loadState, upstreamFor } from "./patch/acquire";
import { readUpstreamVersion } from "./codex/upstream";
import { loadManifest, supportedCodexVersions } from "./patch/manifest";
import { fetchPublishedPrebuiltVersions } from "./distribution/prebuilt";
import { promptCodexVersion, type PromptVersionOptions, type PromptVersionSelection } from "./ui/prompt-version";
import { installHook, uninstallHook } from "./hook/install";
import { realHookDeps, runHook } from "./hook/run";
import { doctorReport, formatDoctor } from "./commands/doctor";
import { runPolicy } from "./commands/policy";
import { revert } from "./commands/revert";
import { getTerminalWidth } from "./utils/terminal";
import { runTUI as runTUIFromApp } from "./tui/App";
import { readMemoryUsage } from "./utils/memory";

import type { UpdateOptions } from "./patch/run";
import type { FetchLike, TransportOptions } from "./distribution/transport";

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
  readonly promptVersion?: (
    options: PromptVersionOptions,
  ) => Promise<PromptVersionSelection | string | null>;
  readonly promptUpdate?: UpdateOptions["promptUpdate"];
  readonly fetchPrebuilts?: (fetchFn?: FetchLike, repo?: string) => Promise<string[]>;
}

export const USAGE = `usage: cxstatusline [command]

  (no command)                open the interactive configuration TUI (TTY only)
  render                      read payload v1 on stdin, print one to three ANSI lines
  install [--compile] [--codex-version <v>] [-y]
                              install the published Codex pair (--compile builds it from source)
  patch [--force]             build and install the patched Codex from source
  patch --simulate-drift <v>  record <v> as the installed version so the next session sees drift
  update [--compile|--force]  run upstream's own updater, then install the pair for it
  hook [install|uninstall]    manage the SessionStart entry; bare 'hook' is what Codex runs
  doctor                      report toolchain, drift, hook and wrapper state
  policy [get|set <policy>]   view or update policy (every, stable-minors, manual)
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
async function runHookCommand(io: MainIo, deps: MainDeps): Promise<number> {
  try {
    const r = await runHook(contextFor(io, deps), io.stdin(), realHookDeps());
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
 * `install [--compile] [--codex-version <v>] [-y]`:
 * Installs the Codex pair. If in an interactive terminal and no version is specified, prompts
 * the user with supported versions from the patch manifest.
 */
async function installCommand(argv: readonly string[], io: MainIo, deps: MainDeps): Promise<number> {
  let compile = false;
  let codexVersion: string | undefined;
  let yes = false;

  let i = 1;
  while (i < argv.length) {
    const arg = argv[i]!;
    if (arg === "--compile") {
      compile = true;
      i++;
    } else if (arg === "-y" || arg === "--yes") {
      yes = true;
      i++;
    } else if (arg === "--codex-version") {
      i++;
      if (i >= argv.length || argv[i]!.startsWith("-")) {
        io.stderr("--codex-version requires a version argument\n");
        return 2;
      }
      codexVersion = argv[i]!;
      i++;
    } else if (arg.startsWith("--codex-version=")) {
      const v = arg.slice("--codex-version=".length);
      if (!v) {
        io.stderr("--codex-version requires a version argument\n");
        return 2;
      }
      codexVersion = v;
      i++;
    } else {
      io.stderr(USAGE);
      return 2;
    }
  }

  const ctx = contextFor(io, deps);

  if (io.isTTY === true && !yes && !codexVersion) {
    let manifest;
    try {
      manifest = loadManifest(ctx.patchesDir);
    } catch {
      // runInstall surfaces manifest failures during acquisition.
    }
    if (manifest) {
      const supported = supportedCodexVersions(manifest);
      if (supported.length > 0) {
        let prebuiltVersions: string[] | undefined;
        if (!compile) {
          try {
            prebuiltVersions = await fetchPublishedPrebuiltVersions(deps.transport?.fetch);
          } catch {
            prebuiltVersions = undefined;
          }
        }

        let defaultVersion: string | undefined;
        try {
          const located = upstreamFor(ctx, loadState(ctx));
          if ("bin" in located) {
            const upstream = readUpstreamVersion(located.bin, ctx.run);
            if (upstream) {
              const semverStr = `${upstream.major}.${upstream.minor}.${upstream.patch}`;
              if (supported.includes(semverStr)) {
                if (compile || !prebuiltVersions || prebuiltVersions.includes(semverStr)) {
                  defaultVersion = semverStr;
                }
              }
            }
          }
        } catch {
          // ignore detection error
        }

        if (!defaultVersion && prebuiltVersions && prebuiltVersions.length > 0) {
          defaultVersion = supported.find((v) => prebuiltVersions.includes(v));
        }

        const prompter = deps.promptVersion ?? promptCodexVersion;
        const result = await prompter({
          supportedVersions: supported,
          prebuiltVersions,
          defaultVersion,
          compile,
          isTTY: true,
          say: (l) => io.stdout(`${l}\n`),
        });
        if (result === null) {
          io.stdout("Installation cancelled.\n");
          return 0;
        }
        const selection = typeof result === "string" ? { version: result, compile: false } : result;
        codexVersion = selection.version;
        compile = compile || selection.compile;
      }
    }
  }

  return runInstall(ctx, { compile, codexVersion }, deps.transport);
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
      isTTY: io.isTTY,
      promptUpdate: deps.promptUpdate,
      fetchPrebuilts: deps.fetchPrebuilts,
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
  if (cmd === "--internal-refresh-command") {
    const key = argv[1];
    return key ? runRefreshCommand(key, { env: io.env }) : 2;
  }
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
    io.stdout(formatDoctor(await doctorReport(contextFor(io, deps))));
    return 0;
  }
  if (cmd === "policy") {
    return runPolicy(contextFor(io, deps), argv.slice(1), io);
  }
  if (cmd === "revert") {
    const result = revert(contextFor(io, deps));
    for (const a of result.actions) io.stdout(`${a}\n`);
    return result.code;
  }
  io.stderr(USAGE);
  return 2;
}
