import { appendFileSync, closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname } from "node:path";
import type { Context } from "../context";
import { acquireLock } from "../lock";
import { describeLookup, preserveLauncherRestore, readUpstreamVersion, resolveUpstream } from "../codex/upstream";
import { ensureWrapper, isOurWrapper, readInstallation } from "../patch/wrapper";
import { probeRemoteCandidate, type RemoteCandidate } from "../patch/run";
import { readState, writeState, RELEASE_RETRY_AFTER_MS, RELEASE_UNAVAILABLE, type State } from "../state";
import { needsRepatch, parseSemver, type SemVer } from "../version";

export interface HookInput {
  readonly source?: string;
}

/** Spec L252-254: act only on these; anything else (notably `compact`) exits 0 in silence. */
export const HOOK_SOURCES: readonly string[] = ["startup", "resume", "clear"];

export function parseHookInput(stdin: string): HookInput {
  try {
    const raw = JSON.parse(stdin) as { source?: unknown };
    return typeof raw?.source === "string" ? { source: raw.source } : {};
  } catch {
    return {};
  }
}

export interface HookDeps {
  spawnDetached(cxBin: string, args: string[], logFile: string): void;
  probeRemote?: (targetVersion?: string) => Promise<RemoteCandidate | null>;
}

interface Located {
  readonly state: State;
  readonly upstream: SemVer;
}

function locateUpstream(ctx: Context, state: State): Located | string {
  const found = resolveUpstream(ctx.paths, ctx.env, isOurWrapper, state.upstream_bin);
  if (found.kind !== "found") return `${describeLookup(found)}; run \`cxstatusline doctor\``;
  const v = readUpstreamVersion(found.bin, ctx.run);
  if (!v) return `upstream Codex at ${found.bin} did not report a version; run \`cxstatusline doctor\``;
  const launcher_restore = preserveLauncherRestore(state.launcher_restore, found.launcher_restore);
  let next = { ...state, upstream_bin: found.bin, launcher_restore };
  if (state.upstream_bin === found.bin && JSON.stringify(state.launcher_restore) === JSON.stringify(launcher_restore)) {
    return { state, upstream: v };
  }
  // The hook must never block (10s budget), so this is acquire-or-skip, not acquire-or-wait: if a
  // detached build (src/patch/run.ts) holds the lock and is mid-write, writing here could clobber
  // its fresher patched_from/last_attempt with stale data. On contention, skip the write and just
  // use `next` in memory for the rest of this invocation - resolution is still correct, only
  // persisting it to disk is what must wait.
  const release = acquireLock(ctx.paths.lockFile);
  if (release) {
    try {
      const latest = readState(ctx.paths.stateFile).state;
      next = { ...latest, upstream_bin: found.bin, launcher_restore: preserveLauncherRestore(latest.launcher_restore, found.launcher_restore) };
      writeState(ctx.paths.stateFile, next);
    } finally {
      release();
    }
  }
  return { state: next, upstream: v };
}

/**
 * Re-place the wrapper only when the patched binary still satisfies the update policy AND is
 * actually on disk (spec L222-224, L330-331).
 * Why both conditions: re-placing during a drift window silently downgrades the user to the old
 * patched binary for the whole rebuild, and re-placing with no patched binary writes a wrapper
 * whose `exec` target does not exist, which stops `codex` from starting at all.
 */
function maintainWrapper(ctx: Context, messages: string[]): void {
  // An active generation carries both executables by construction (installation.json is written
  // last), so the flat-layout files are only worth checking when there is no generation at all -
  // otherwise every healthy generation install would be reported as a broken one.
  if (readInstallation(ctx.paths) === null) {
    if (!existsSync(ctx.paths.patchedBin)) {
      messages.push(`cxstatusline: the patched binary ${ctx.paths.patchedBin} is missing; Codex is running unpatched. Run \`cxstatusline install\`.`);
      return;
    }
    if (!existsSync(ctx.paths.patchedCodeModeHost)) {
      messages.push(`cxstatusline: the required Code Mode host ${ctx.paths.patchedCodeModeHost} is missing; run \`cxstatusline install\` to restore it.`);
      return;
    }
  }
  const w = ensureWrapper(ctx.paths, ctx.cxBin, true);
  if (w.kind === "replaced") {
    messages.push("cxstatusline: restored the cxstatusline wrapper (upstream's installer had replaced it).");
  } else if (w.kind === "refused") {
    messages.push(`cxstatusline: ${w.reason}`);
  }
}

/**
 * Should this SessionStart stay its hand because the last attempt for this exact version failed?
 *
 * A missing release is the one failure that fixes itself: CI publishes the pair a while after
 * upstream ships, so it is retried after `RELEASE_RETRY_AFTER_MS` rather than suppressed forever.
 * Every other failure is a machine-local problem that a retry would only repeat, so it is reported
 * once and left to the user. An explicit `cxstatusline install` ignores all of this.
 */
function suppressed(ctx: Context, state: State, upstream: SemVer, messages: string[]): boolean {
  const attempt = state.last_attempt;
  if (!attempt || attempt.ok || attempt.version !== upstream.raw) return false;
  if (attempt.reason !== RELEASE_UNAVAILABLE) {
    messages.push(`cxstatusline: last install attempt for ${upstream.raw} failed: ${attempt.reason ?? "unknown"}. Fix the cause, then run \`cxstatusline install\`.`);
    return true;
  }
  const at = Date.parse(attempt.at);
  if (!Number.isFinite(at) || ctx.now().getTime() - at >= RELEASE_RETRY_AFTER_MS) return false;
  messages.push(`cxstatusline: no prebuilt Codex ${upstream.raw} pair is published yet; will retry in a day. Run \`cxstatusline install\` to try now.`);
  return true;
}

/** SessionStart handler. Never throws, never blocks, never builds inline. */
export async function runHook(ctx: Context, stdin: string, deps: HookDeps): Promise<{ stdout: string; messages: string[] }> {
  const messages: string[] = [];
  const done = (): { stdout: string; messages: string[] } => ({
    stdout: messages.length ? JSON.stringify({ systemMessage: messages.join("\n") }) : "",
    messages,
  });

  const source = parseHookInput(stdin).source;
  if (source !== undefined && !HOOK_SOURCES.includes(source)) return done();

  const { state: read, corrupt } = readState(ctx.paths.stateFile);
  if (corrupt) {
    messages.push("cxstatusline: state.json was corrupt; recovered what was in state.json.bak. Run `cxstatusline doctor`.");
  }
  const activeGeneration = readInstallation(ctx.paths)?.codexVersion;
  if ((activeGeneration ?? read.patched_from) === null) return done();

  // Upstream first: the wrapper decision below needs its version, and calling ensureWrapper before
  // this point would replace upstream's symlink - the only thing resolveUpstream can re-resolve from.
  const located = locateUpstream(ctx, read);
  if (typeof located === "string") {
    messages.push(`cxstatusline: ${located}`);
    return done();
  }
  let { state, upstream } = located;
  const effectiveInstalled = activeGeneration ?? state.patched_from;
  if (effectiveInstalled === null) return done();
  const patched = parseSemver(effectiveInstalled);
  const drift = needsRepatch(upstream, patched, state.policy);

  if (!drift) maintainWrapper(ctx, messages);

  if (drift) {
    const release = acquireLock(ctx.paths.lockFile);
    if (!release) {
      messages.push(`cxstatusline: the install for Codex ${upstream.raw} is already in progress; reopen Codex after it finishes.`);
      return done();
    }
    release();

    const attempt = state.last_attempt;
    const isUnavailable = attempt && !attempt.ok && attempt.version === upstream.raw && attempt.reason === RELEASE_UNAVAILABLE;
    if (isUnavailable && deps.probeRemote) {
      try {
        const probe = await deps.probeRemote(upstream.raw);
        if (probe?.available) {
          state = { ...state, last_attempt: null };
        }
      } catch {
        // Fail closed & silent to existing state
      }
    }
  }

  if (suppressed(ctx, state, upstream, messages)) return done();

  if (drift) {
    deps.spawnDetached(ctx.cxBin, ["hook", "acquire"], ctx.paths.patchLog);
    messages.push(`cxstatusline: Codex updated to ${upstream.raw} (installed pair is from ${effectiveInstalled}). Installing the new pair in the background - reopen Codex in a few minutes. Log: ${ctx.paths.patchLog}`);
  }
  return done();
}

export function realHookDeps(): HookDeps {
  return {
    spawnDetached(cxBin, args, logFile) {
      let fd: number | undefined;
      try {
        mkdirSync(dirname(logFile), { recursive: true });
        fd = openSync(logFile, "a");
        const child = spawn(cxBin, args, { detached: true, stdio: ["ignore", fd, fd], env: process.env });
        // Why this listener is mandatory: spawn reports ENOENT asynchronously on 'error'. With no
        // listener Node raises "Unhandled 'error' event" AFTER the hook has already printed its
        // JSON, and main()'s synchronous try/catch cannot catch it - the hook exits 1. Reproduced
        // on Node v26.7.0. `cxBin` dangles whenever dist/ is cleaned, so this is a real path.
        // Why appendFileSync(logFile, ...) and not the `fd` above: the `finally` below closes `fd`
        // synchronously right after spawn() returns, but this 'error' event fires on a later tick
        // (after the fd is already closed) - writing through the closed fd would throw. Without
        // this, a permanently dangling cxBin leaves the promised log file empty forever and
        // last_attempt in state.json never reflects the failure, so every SessionStart repeats the
        // same "rebuilding" message with zero diagnostic information anywhere.
        child.on("error", (err) => {
          try {
            appendFileSync(logFile, `${new Date().toISOString()} spawn failed: ${String(err)}\n`);
          } catch {
            /* best effort */
          }
        });
        child.unref();
      } catch {
        /* a failed spawn must never fail the session; the systemMessage is already queued */
      } finally {
        // The child dup'd the fd already; not closing it leaks a descriptor per hook run.
        if (fd !== undefined) {
          try {
            closeSync(fd);
          } catch {
            /* ignore */
          }
        }
      }
    },
    probeRemote: (targetVersion) => probeRemoteCandidate(targetVersion),
  };
}
