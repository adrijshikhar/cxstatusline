import { existsSync, lstatSync, rmSync, symlinkSync } from "node:fs";
import type { Context } from "../context";
import { uninstallHook } from "../hook/install";
import { acquireLock, lockHolder } from "../lock";
import { isOurWrapper } from "../patch/wrapper";
import { readState, writeState } from "../state";

function safeIsSymlink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

export interface RevertResult {
  readonly actions: string[];
  readonly code: 0 | 1;
}

/**
 * Back to stock Codex. Settings and the source checkout stay. Returns what was done.
 * Runs under the patch lock: without it, a detached background `patch` (spawned by the hook on
 * drift) could finish mid-revert and silently re-install everything this just removed.
 */
export function revert(ctx: Context): RevertResult {
  const release = acquireLock(ctx.paths.lockFile);
  if (!release) {
    return { code: 1, actions: [`another cxstatusline patch is running (pid ${lockHolder(ctx.paths.lockFile)}); wait for it to finish, or stop it, then re-run \`cxstatusline revert\``] };
  }
  try {
    return revertLocked(ctx);
  } finally {
    release();
  }
}

function revertLocked(ctx: Context): RevertResult {
  const actions: string[] = [];
  let code: 0 | 1 = 0;
  const { state, corrupt } = readState(ctx.paths.stateFile);
  if (corrupt) actions.push(`state.json was corrupt; used ${ctx.paths.stateBackupFile} where possible`);
  const w = ctx.paths.wrapperPath;

  if (existsSync(w) || safeIsSymlink(w)) {
    if (isOurWrapper(w)) {
      rmSync(w);
      actions.push(`removed wrapper ${w}`);
      if (state.launcher_restore?.kind === "symlink") {
        symlinkSync(state.launcher_restore.target, w);
        actions.push(`restored upstream symlink ${w} -> ${state.launcher_restore.target}`);
      } else {
        actions.push(`no upstream symlink recorded; ${w} left absent (upstream may need reinstalling)`);
      }
    } else {
      actions.push(`${w} is not ours; left in place`);
    }
  }
  if (existsSync(ctx.paths.patchedBin)) {
    rmSync(ctx.paths.patchedBin);
    actions.push(`removed patched binary ${ctx.paths.patchedBin}`);
  }
  if (existsSync(ctx.paths.patchedCodeModeHost)) {
    rmSync(ctx.paths.patchedCodeModeHost);
    actions.push(`removed Code Mode host ${ctx.paths.patchedCodeModeHost}`);
  }
  // Why the try: uninstallHook throws on a hand-broken hooks.json, and it runs AFTER the wrapper
  // and the binary are gone. Letting it escape would leave state.json still claiming
  // patched_from: "0.152.1" with nothing on disk - the escape hatch failing on a broken machine.
  try {
    actions.push(`hook ${uninstallHook(ctx.paths.hooksFile)}`);
  } catch (e) {
    code = 1;
    actions.push(`could not update ${ctx.paths.hooksFile}: ${String(e)}`);
    actions.push(`remove the cxstatusline SessionStart entry by hand, or run \`cxstatusline hook uninstall\` after fixing the file`);
  }
  writeState(ctx.paths.stateFile, { ...state, patched_from: null, last_attempt: null });
  actions.push(`state reset; settings kept at ${ctx.paths.settingsFile}; source kept at ${ctx.paths.sourceDir}`);
  return { actions, code };
}
