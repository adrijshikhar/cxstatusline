import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { preserveLauncherRestore, resolveUpstream } from "../codex/upstream";
import type { Context } from "../context";
import type { PreparedPair } from "../distribution";
import type { Paths } from "../paths";
import { sq } from "../sh";
import { readState, writeState } from "../state";
import { activeGeneration, createGeneration, readInstallation, readPointer, restorePointer, swapPointer } from "./generation";

export {
  activeGeneration,
  createGeneration,
  isGenerationDir,
  listGenerations,
  readInstallation,
  type InstallationRecord,
} from "./generation";

/** The flat-layout wrapper. Owners installed before generations still have this one on disk. */
export const WRAPPER_MARKER = "# cxstatusline-wrapper v1";

/** The generation-resolving wrapper. */
export const WRAPPER_MARKER_V2 = "# cxstatusline-wrapper v2";

/**
 * Every marker we have ever written. `isOurWrapper` must accept all of them, or an owner's v1
 * launcher would look foreign and `revert` would refuse to take it back.
 */
const WRAPPER_MARKERS: readonly string[] = [WRAPPER_MARKER, WRAPPER_MARKER_V2];

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

/**
 * The `~/.local/bin/codex` wrapper for the generation layout.
 * The executable path is pinned once, by resolving `current` to a real directory and exec'ing out
 * of it: a generation switched in mid-session cannot move this process's binary out from under it.
 */
export function generationWrapperScript(currentGeneration: string, cxBin: string): string {
  return [
    "#!/bin/sh",
    WRAPPER_MARKER_V2,
    "# Managed by cxstatusline. `cxstatusline revert` restores stock Codex.",
    `if [ "$1" = "update" ]; then`,
    `  exec ${sq(cxBin)} update`,
    "fi",
    `CXSTATUSLINE_COMMAND=${sq(`${sq(cxBin)} render`)}`,
    "export CXSTATUSLINE_COMMAND",
    `generation=$(CDPATH= cd -P -- ${sq(currentGeneration)} && pwd -P) || exit 1`,
    `exec "$generation/codex" "$@"`,
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
      const head = header.toString("utf8", 0, size).split("\n").slice(0, 3);
      return WRAPPER_MARKERS.some((marker) => head.includes(marker));
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

/**
 * Place the wrapper, refusing to destroy a real binary that is not ours.
 * Why the guard: `resolveUpstream` already refuses a foreign regular file at this path, but the
 * writers did not, so a Brew/Npm install (a regular file, not a symlink) would be deleted.
 * Hard constraint: "the upstream binary is never written" (spec L195).
 */
function foreignLauncher(target: string): string | null {
  return existsSync(target) && !isSymlink(target) && !isOurWrapper(target)
    ? `${target} is a real file we did not write (not a symlink, no cxstatusline marker); refusing to replace it. Move it aside and re-run, or point PATH at a different bin dir.`
    : null;
}

/**
 * Fail before any download, build or generation directory exists when the launcher is not ours to
 * replace. Hard constraint: "the upstream binary is never written" (spec L195).
 */
export function assertLauncherReplaceable(paths: Paths): void {
  const reason = foreignLauncher(paths.wrapperPath);
  if (reason) throw new Error(reason);
}

function placeWrapperScript(paths: Paths, script: string): WrapperResult {
  const target = paths.wrapperPath;
  const foreign = foreignLauncher(target);
  if (foreign) return { kind: "refused", reason: foreign };
  placeExecutable(target, (tmp) => writeFileSync(tmp, script));
  return { kind: "replaced" };
}

/**
 * The v1 (flat-layout) wrapper, written from scratch.
 * Legacy fixture for tests only: production installs go through `ensureWrapper`/`activatePair`,
 * which write the v2 generation-resolving wrapper. Kept because the v1 script is exactly what an
 * owner who installed before generations still has on disk, and several suites need that state.
 */
export function installWrapper(paths: Paths, cxBin: string): WrapperResult {
  return placeWrapperScript(paths, wrapperScript(paths.patchedBin, cxBin));
}

/**
 * The script the launcher is supposed to hold right now.
 * A valid active generation is the newer, authoritative layout, so the v2 script wins; without one
 * we are still on the flat layout and the v1 script is correct. Getting this wrong in the other
 * direction is what matters: writing v1 over a working v2 wrapper points `exec` at
 * `paths.patchedBin`, which the generation layout never writes, and `codex` stops starting.
 */
function expectedWrapperScript(paths: Paths, cxBin: string): string {
  return readInstallation(paths) !== null
    ? generationWrapperScript(paths.currentGeneration, cxBin)
    : wrapperScript(paths.patchedBin, cxBin);
}

/**
 * Re-place the wrapper if something else (upstream's installer) took the path back.
 * `patchedBinPresent` is proof from the caller that `paths.patchedBin` exists.
 * Why it is a required argument and not an `existsSync` inside: the caller has already decided
 * whether the patched binary is allowed to be used at all (update policy), and a wrapper that
 * `exec`s a missing path turns a working `codex` into one that cannot start (spec L330-331).
 */
export function ensureWrapper(paths: Paths, cxBin: string, patchedBinPresent: boolean): WrapperResult {
  const generation = readInstallation(paths) !== null;
  // `patchedBinPresent` only speaks for the flat layout. A generation's `codex` exists by
  // construction (installation.json is written last), so it is not the caller's proof to give.
  if (!generation && !patchedBinPresent) {
    return { kind: "refused", reason: `the patched binary ${paths.patchedBin} is missing; leaving the launcher alone` };
  }
  const want = expectedWrapperScript(paths, cxBin);
  if (isOurWrapper(paths.wrapperPath) && readFileSync(paths.wrapperPath, "utf8") === want) {
    return { kind: "present" };
  }
  return placeWrapperScript(paths, want);
}

// ---------------------------------------------------------------------------
// Generations: one directory is the unit of activation.
// ---------------------------------------------------------------------------

/**
 * Seam for the failure-injection tests. `rename` is the single commit primitive used for the
 * three points that matter - installation.json, the `current` pointer and the wrapper - so one
 * injected function can fail any one of them exactly the way a full disk or a lost mount would.
 */
export interface ActivationOptions {
  readonly rename?: typeof renameSync;
}

/**
 * Record where upstream lives and how to put its launcher back, before we replace it.
 * Once our wrapper occupies `~/.local/bin/codex`, `resolveUpstream` refuses it and the PATH walk
 * skips `~/.local/bin`, so `upstream_bin` and `launcher_restore` become the only record there is
 * (src/state.ts). Both are persisted together, through the same `preserveLauncherRestore` helper
 * the other two callers use, and a failed write aborts the install rather than proceeding without
 * a way home.
 */
function preserveStockLauncher(ctx: Context): void {
  const { state } = readState(ctx.paths.stateFile);
  if (state.launcher_restore !== null && state.upstream_bin !== null) return;
  const found = resolveUpstream(ctx.paths, ctx.env, isOurWrapper, state.upstream_bin);
  writeState(ctx.paths.stateFile, found.kind === "found"
    ? {
      ...state,
      upstream_bin: found.bin,
      launcher_restore: preserveLauncherRestore(state.launcher_restore, found.launcher_restore),
    }
    : { ...state, launcher_restore: state.launcher_restore ?? { kind: "none" } });
}

/** Write the wrapper to a sibling temp file and prove it landed intact, before `current` moves. */
function stageWrapper(paths: Paths, cxBin: string): string {
  const want = generationWrapperScript(paths.currentGeneration, cxBin);
  mkdirSync(paths.binDir, { recursive: true });
  const tmp = `${paths.wrapperPath}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  try {
    writeFileSync(tmp, want);
    chmodSync(tmp, 0o755);
    if (readFileSync(tmp, "utf8") !== want) throw new Error(`${paths.wrapperPath} did not stage intact`);
    return tmp;
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

/**
 * Make `pair` the active Codex, as one step.
 *
 * The order is the whole point. A fresh `codex` invocation can only ever observe the stock
 * launcher, the previously active generation, or this one - never a half-installed pair:
 *
 *   1. refuse a launcher that is not ours, and record how to restore the stock one;
 *   2. stage the wrapper (nothing observable changes);
 *   3. build the complete new generation (unreferenced, so still not observable);
 *   4. rename `current` onto it - the single commit;
 *   5. rename the wrapper into place.
 *
 * If step 5 fails the pointer goes back to where it was, which on a first install means no
 * pointer at all and a still-launchable stock Codex. Generations are never deleted here: a live
 * session may be executing out of one.
 *
 * The caller owns `pair.directory` and removes it afterwards, and owns the state bookkeeping -
 * `installation.json` inside the generation, not state.json, is the record of what is active.
 *
 * Takes no lock of its own: the caller must hold the patch lock (`paths.lockFile`).
 */
export function activatePair(pair: PreparedPair, ctx: Context, { rename = renameSync }: ActivationOptions = {}): void {
  const { paths } = ctx;
  assertLauncherReplaceable(paths);
  preserveStockLauncher(ctx);

  const wrapperTmp = stageWrapper(paths, ctx.cxBin);
  let generation: string | undefined;
  let previous: string | null = null;
  let committed = false;
  try {
    generation = createGeneration(pair, paths, rename);
    previous = readPointer(paths);
    swapPointer(paths, generation, rename);
    committed = true;
    rename(wrapperTmp, paths.wrapperPath);
  } catch (e) {
    rmSync(wrapperTmp, { force: true });
    // renameSync, never the injected `rename`: the injected one is what just failed, and the
    // rollback has to use the real primitive to actually put the pointer back.
    if (committed) restorePointer(paths, previous, renameSync);
    throw e;
  }
}
