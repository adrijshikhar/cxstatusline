import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "../context";
import { acquireLock } from "../lock";
import { describeLookup, preserveLauncherRestore, readUpstreamVersion, resolveUpstream } from "../codex/upstream";
import { readState, writeState, type State } from "../state";
import { needsRepatch, parseSemver, type SemVer } from "../version";
import { BuildError, buildPatched } from "./build";
import { ManifestError, loadManifest, resolvePatch } from "./manifest";
import { preflight } from "./preflight";
import { installPatchedBinary, installWrapper, isOurWrapper } from "./wrapper";
import { installHook } from "../hook/install";

export type PatchOutcome =
  | { kind: "built"; version: string }
  | { kind: "held"; upstream: string; patched: string }
  | { kind: "refused"; reason: string }
  | { kind: "locked" }
  | { kind: "failed"; reason: string };

function loadState(ctx: Context): State {
  const { state, corrupt } = readState(ctx.paths.stateFile);
  if (corrupt) {
    ctx.say(`state.json was corrupt; recovered what could be read from ${ctx.paths.stateFile}.bak (${ctx.paths.stateFile})`);
  }
  return state;
}

function recordFailure(ctx: Context, state: State, version: string, reason: string): void {
  writeState(ctx.paths.stateFile, { ...state, last_attempt: { at: ctx.now().toISOString(), ok: false, version, reason } });
}

interface Located {
  readonly state: State;
  readonly bin: string;
}

/** Current external launcher/PATH wins; the saved release is only a last resort. */
function upstreamFor(ctx: Context, state: State): Located | { reason: string } {
  const found = resolveUpstream(ctx.paths, ctx.env, isOurWrapper, state.upstream_bin);
  if (found.kind !== "found") return { reason: describeLookup(found) };
  const launcher_restore = preserveLauncherRestore(state.launcher_restore, found.launcher_restore);
  return { state: { ...state, upstream_bin: found.bin, launcher_restore }, bin: found.bin };
}

/**
 * Everything that can write `state.json` runs under the lock.
 * Why the lock is taken first: `recordFailure` used to run outside it while the success write ran
 * inside, so two concurrent `patch` runs could interleave their `last_attempt` records.
 */
export function runPatch(ctx: Context, opts: { force: boolean }): PatchOutcome {
  const release = acquireLock(ctx.paths.lockFile);
  if (!release) return { kind: "locked" };
  try {
    return runPatchLocked(ctx, loadState(ctx), opts);
  } finally {
    release();
  }
}

function runPatchLocked(ctx: Context, initial: State, opts: { force: boolean }): PatchOutcome {
  const located = upstreamFor(ctx, initial);
  if ("reason" in located) {
    recordFailure(ctx, initial, "unknown", located.reason);
    return { kind: "refused", reason: located.reason };
  }
  const state = located.state;
  // Persist the resolved upstream_bin/launcher_restore immediately - before the `held` check and
  // long before build()'s wrapper/binary mutation. If build()'s own final writeState later fails
  // (e.g. a full XDG_STATE_HOME right after a multi-GB cargo build), this earlier write is what
  // lets `revert` still find its way back to upstream.
  writeState(ctx.paths.stateFile, state);
  const upstream = readUpstreamVersion(located.bin, ctx.run);
  if (!upstream) {
    const reason = `could not read a version from ${located.bin} --version`;
    recordFailure(ctx, state, "unknown", reason);
    return { kind: "refused", reason };
  }
  const patched = state.patched_from ? parseSemver(state.patched_from) : null;
  if (!opts.force && !needsRepatch(upstream, patched, state.policy)) {
    return { kind: "held", upstream: upstream.raw, patched: state.patched_from ?? "never" };
  }
  // Why the try: `loadManifest` throws on a missing or malformed manifest, and "patch resolution
  // fails closed" means a refusal the caller can print, not an uncaught stack trace.
  let ref: { file: string; tag: string } | null;
  try {
    ref = resolvePatch(loadManifest(ctx.patchesDir), upstream);
  } catch (e) {
    const reason = e instanceof ManifestError ? e.message : `patches/manifest.json could not be read: ${String(e)}`;
    recordFailure(ctx, state, upstream.raw, reason);
    return { kind: "refused", reason };
  }
  if (!ref) {
    const reason = `Codex ${upstream.raw} is outside every supported range in patches/manifest.json; refusing to patch`;
    recordFailure(ctx, state, upstream.raw, reason);
    return { kind: "refused", reason };
  }
  const pf = preflight({ which: ctx.which, run: ctx.run, freeBytes: ctx.freeBytes }, ctx.paths.shareDir);
  if (!pf.ok) {
    const reason = `${pf.reason}. Fix: ${pf.fix}`;
    recordFailure(ctx, state, upstream.raw, reason);
    return { kind: "refused", reason };
  }
  return build(ctx, state, located.bin, upstream, ref);
}

function build(ctx: Context, state: State, upstreamBin: string, upstream: SemVer, ref: { file: string; tag: string }): PatchOutcome {
  try {
    const bin = buildPatched(
      { tag: ref.tag, sourceDir: ctx.paths.sourceDir, patchFile: join(ctx.patchesDir, ref.file) },
      ctx.run,
      ctx.log,
    );
    installPatchedBinary(bin, upstreamBin, ctx.paths);
    const placed = installWrapper(ctx.paths, ctx.cxBin);
    if (placed.kind === "refused") {
      recordFailure(ctx, state, upstream.raw, placed.reason);
      return { kind: "refused", reason: placed.reason };
    }
    writeState(ctx.paths.stateFile, {
      ...state,
      patched_from: upstream.raw,
      last_attempt: { at: ctx.now().toISOString(), ok: true, version: upstream.raw },
    });
    return { kind: "built", version: upstream.raw };
  } catch (e) {
    const reason = e instanceof BuildError ? e.message : `unexpected: ${String(e)}`;
    recordFailure(ctx, state, upstream.raw, reason);
    return { kind: "failed", reason };
  }
}

/** Pretend we were patched from `version` so the next SessionStart sees drift. Nothing else changes. */
export function simulateDrift(ctx: Context, version: string): string {
  if (!parseSemver(version)) throw new Error(`--simulate-drift needs a semver like 0.151.0, not "${version}"`);
  const release = acquireLock(ctx.paths.lockFile);
  if (!release) throw new Error("another cxstatusline patch is already running; try again in a moment");
  try {
    const state = loadState(ctx);
    writeState(ctx.paths.stateFile, { ...state, patched_from: version });
    return `state.json now claims the patched binary was built from ${version}. Start a Codex session: the hook should detect drift, rebuild detached, and the session after that should run the new binary.`;
  } finally {
    release();
  }
}

/** `codex update` -> upstream's own updater, then repatch. */
export function runUpdate(ctx: Context): number {
  const state = loadState(ctx);
  const located = upstreamFor(ctx, state);
  if ("reason" in located) {
    ctx.say(`no upstream Codex to update: ${located.reason}`);
    return 1;
  }
  ctx.say(`running upstream updater: ${located.bin} update`);
  // Why interactive: upstream's Standalone updater prompts. stdio is inherited, so r.stderr is
  // always "" in this mode - never interpolate it into a message.
  const r = ctx.run(located.bin, ["update"], { interactive: true });
  if (r.status !== 0) {
    ctx.say(`upstream updater exited ${String(r.status)}; see its output above. Not repatching.`);
    return 1;
  }
  const outcome = runPatch(ctx, { force: true });
  ctx.say(describeOutcome(outcome));
  return outcome.kind === "built" ? 0 : 1;
}

/** Named `describeOutcome`, not `describe`, so test files can import it next to bun:test's `describe`. */
export function describeOutcome(o: PatchOutcome): string {
  switch (o.kind) {
    case "built": return `patched Codex ${o.version} installed`;
    case "held": return `holding: upstream ${o.upstream}, patched from ${o.patched} (policy). Use --force to rebuild anyway.`;
    case "refused": return `refused: ${o.reason}`;
    case "locked": return "another cxstatusline patch is already running";
    case "failed": return `build failed: ${o.reason}`;
  }
}

/**
 * `cxstatusline install`: force a patch, then merge the SessionStart hook.
 * Why the hook write is caught: the patched binary is already installed at that point, so a
 * hand-broken hooks.json must not make `install` look like it did nothing.
 */
export function runInstall(ctx: Context): number {
  const outcome = runPatch(ctx, { force: true });
  ctx.say(describeOutcome(outcome));
  if (outcome.kind !== "built") return 1;
  try {
    const r = installHook(ctx.paths.hooksFile, ctx.cxBin);
    ctx.say(`hook ${r} in ${ctx.paths.hooksFile}`);
    if (r === "added") ctx.say("Start Codex once and accept the cxstatusline hook when prompted.");
    return 0;
  } catch (e) {
    ctx.say(`the patched binary is installed, but the SessionStart hook could not be written: ${String(e)}`);
    ctx.say(`Fix ${ctx.paths.hooksFile} by hand, then run \`cxstatusline hook install\`.`);
    return 1;
  }
}

export function appendLog(file: string, line: string): void {
  mkdirSync(join(file, ".."), { recursive: true });
  appendFileSync(file, `${new Date().toISOString()} ${line}\n`);
}

/** True when a patched binary is on disk - the proof `ensureWrapper` requires. */
export function patchedBinPresent(ctx: Context): boolean {
  return existsSync(ctx.paths.patchedBin) && existsSync(ctx.paths.patchedCodeModeHost);
}
