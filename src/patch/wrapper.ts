import { chmodSync, closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Paths } from "../paths";
import { sq } from "../sh";

export const WRAPPER_MARKER = "# cxstatusline-wrapper v1";
const CODE_MODE_HOST = "codex-code-mode-host";

/** The `~/.local/bin/codex` wrapper. Everything but `update` execs into the patched binary. */
export function wrapperScript(patchedBin: string, cxBin: string): string {
  return [
    "#!/bin/sh",
    WRAPPER_MARKER,
    "# Managed by cxstatusline. `cxstatusline revert` restores stock Codex.",
    `if [ "$1" = "update" ]; then`,
    `  exec ${sq(cxBin)} update`,
    "fi",
    `CXSTATUSLINE_COMMAND=${sq(`${sq(cxBin)} render`)}`,
    "export CXSTATUSLINE_COMMAND",
    `exec ${sq(patchedBin)} "$@"`,
    "",
  ].join("\n");
}

export function isOurWrapper(path: string): boolean {
  try {
    const fd = openSync(path, "r");
    try {
      // The managed marker is in the short header. Discovery also probes large native binaries.
      const header = Buffer.alloc(256);
      const size = readSync(fd, header, 0, header.length, 0);
      return header.toString("utf8", 0, size).split("\n").slice(0, 3).includes(WRAPPER_MARKER);
    } finally {
      closeSync(fd);
    }
  } catch {
    return false;
  }
}

/**
 * Outcome of any attempt to put our wrapper at `paths.wrapperPath`.
 * `refused` is a first-class result, not an exception: the caller (`runPatch`, the hook, `doctor`)
 * has to tell the operator *why* nothing was written.
 */
export type WrapperResult =
  | { readonly kind: "present" }
  | { readonly kind: "replaced" }
  | { readonly kind: "refused"; readonly reason: string };

function isSymlink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Write `tmp` next to `target` and rename over it.
 * Why there is no `rmSync(target)` first: `rename(2)` over an existing file *or* symlink is
 * already atomic. Unlinking first opens a window in which `~/.local/bin/codex` does not exist at
 * all, and on a Standalone install that is the only `codex` on PATH.
 */
function stageExecutable(target: string, write: (tmp: string) => void): string {
  mkdirSync(join(target, ".."), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}`;
  try {
    write(tmp);
    chmodSync(tmp, 0o755);
    if (statSync(tmp).size === 0) throw new Error(`${target} staged as an empty file`);
    return tmp;
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

function placeExecutable(target: string, write: (tmp: string) => void): void {
  renameSync(stageExecutable(target, write), target);
}

function stageExistingExecutable(target: string): string | undefined {
  return existsSync(target)
    ? stageExecutable(`${target}.previous`, (tmp) => copyFileSync(target, tmp))
    : undefined;
}

/**
 * Install Codex and its required Code Mode host as one staged set.
 * The host comes from the upstream release because the patched build only produces `codex`.
 */
export function installPatchedBinary(
  from: string,
  upstreamBin: string,
  paths: Paths,
  { rename = renameSync }: { readonly rename?: typeof renameSync } = {},
): void {
  const upstreamHost = join(dirname(upstreamBin), CODE_MODE_HOST);
  if (!existsSync(upstreamHost)) throw new Error(`upstream companion ${upstreamHost} is missing`);
  let codexTmp: string | undefined = stageExecutable(paths.patchedBin, (tmp) => copyFileSync(from, tmp));
  let hostTmp: string | undefined;
  let previousCodex: string | undefined;
  let previousHost: string | undefined;
  let hostActivated = false;
  let codexActivated = false;
  try {
    hostTmp = stageExecutable(paths.patchedCodeModeHost, (tmp) => copyFileSync(upstreamHost, tmp));
    previousCodex = stageExistingExecutable(paths.patchedBin);
    previousHost = stageExistingExecutable(paths.patchedCodeModeHost);
    // Commit the host first: the new Codex binary is never made available without its host.
    rename(hostTmp, paths.patchedCodeModeHost);
    hostTmp = undefined;
    hostActivated = true;
    rename(codexTmp, paths.patchedBin);
    codexTmp = undefined;
    codexActivated = true;
  } catch (e) {
    if (hostActivated || codexActivated) {
      if (previousHost) {
        rename(previousHost, paths.patchedCodeModeHost);
        previousHost = undefined;
      } else if (hostActivated) {
        rmSync(paths.patchedCodeModeHost, { force: true });
      }
      if (previousCodex) {
        rename(previousCodex, paths.patchedBin);
        previousCodex = undefined;
      } else if (codexActivated) {
        rmSync(paths.patchedBin, { force: true });
      }
    }
    if (codexTmp) rmSync(codexTmp, { force: true });
    if (hostTmp) rmSync(hostTmp, { force: true });
    throw e;
  } finally {
    if (previousCodex) rmSync(previousCodex, { force: true });
    if (previousHost) rmSync(previousHost, { force: true });
  }
}

/**
 * Place the wrapper, refusing to destroy a real binary that is not ours.
 * Why the guard: `resolveUpstream` already refuses a foreign regular file at this path, but the
 * writers did not, so a Brew/Npm install (a regular file, not a symlink) would be deleted.
 * Hard constraint: "the upstream binary is never written" (spec L195).
 */
export function installWrapper(paths: Paths, cxBin: string): WrapperResult {
  const target = paths.wrapperPath;
  if (existsSync(target) && !isSymlink(target) && !isOurWrapper(target)) {
    return {
      kind: "refused",
      reason: `${target} is a real file we did not write (not a symlink, no cxstatusline marker); refusing to replace it. Move it aside and re-run, or point PATH at a different bin dir.`,
    };
  }
  placeExecutable(target, (tmp) => writeFileSync(tmp, wrapperScript(paths.patchedBin, cxBin)));
  return { kind: "replaced" };
}

/**
 * Re-place the wrapper if something else (upstream's installer) took the path back.
 * `patchedBinPresent` is proof from the caller that `paths.patchedBin` exists.
 * Why it is a required argument and not an `existsSync` inside: the caller has already decided
 * whether the patched binary is allowed to be used at all (update policy), and a wrapper that
 * `exec`s a missing path turns a working `codex` into one that cannot start (spec L330-331).
 */
export function ensureWrapper(paths: Paths, cxBin: string, patchedBinPresent: boolean): WrapperResult {
  if (!patchedBinPresent) {
    return { kind: "refused", reason: `the patched binary ${paths.patchedBin} is missing; leaving the launcher alone` };
  }
  if (isOurWrapper(paths.wrapperPath)
    && readFileSync(paths.wrapperPath, "utf8") === wrapperScript(paths.patchedBin, cxBin)) {
    return { kind: "present" };
  }
  return installWrapper(paths, cxBin);
}
