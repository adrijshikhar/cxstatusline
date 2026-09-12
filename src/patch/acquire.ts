import { rmSync } from "node:fs";
import type { Context } from "../context";
import { acquireLock } from "../lock";
import { describeLookup, preserveLauncherRestore, readUpstreamVersion, resolveUpstream } from "../codex/upstream";
import { platformFor, preparePrebuilt, type ExpectedRelease, type PreparedPair } from "../distribution";
import { ReleaseUnavailableError, sanitize, type TransportOptions } from "../distribution/transport";
import { readState, writeState, RELEASE_UNAVAILABLE, type State } from "../state";
import { needsRepatch, parseSemver, type SemVer } from "../version";
import { VERSION } from "../version-info";
import { prepareCompiled } from "./compile";
import { ManifestError, loadManifest, resolvePatch } from "./manifest";
import { prebuiltPreflight, preflight } from "./preflight";
import { activatePair, assertLauncherReplaceable, ensureWrapper, isOurWrapper } from "./wrapper";

/** Where a pair comes from. `prebuilt` is the default; `compiled` is always asked for explicitly. */
export type AcquisitionSource = "prebuilt" | "compiled";

export type PatchOutcome =
  | { kind: "installed"; version: string; source: AcquisitionSource; reused: boolean }
  | { kind: "held"; upstream: string; patched: string }
  | { kind: "refused"; reason: string }
  /** No published release for this exact (cxstatusline, Codex, platform) triple. */
  | { kind: "unavailable"; version: string; reason: string }
  | { kind: "locked" }
  | { kind: "failed"; reason: string };

export interface AcquisitionOptions {
  readonly source: AcquisitionSource;
  readonly force: boolean;
}

export function loadState(ctx: Context): State {
  const { state, corrupt } = readState(ctx.paths.stateFile);
  if (corrupt) {
    ctx.say(`state.json was corrupt; recovered what could be read from ${ctx.paths.stateFile}.bak (${ctx.paths.stateFile})`);
  }
  return state;
}

function recordFailure(ctx: Context, state: State, version: string, reason: string): void {
  writeState(ctx.paths.stateFile, { ...state, last_attempt: { at: ctx.now().toISOString(), ok: false, version, reason } });
}

function recordSuccess(ctx: Context, state: State, version: string): void {
  writeState(ctx.paths.stateFile, {
    ...state,
    patched_from: version,
    last_attempt: { at: ctx.now().toISOString(), ok: true, version },
  });
}

const reasonOf = (e: unknown): string => (e instanceof Error ? e.message : `unexpected: ${String(e)}`);

interface Located {
  readonly state: State;
  readonly bin: string;
}

/** Current external launcher/PATH wins; the saved release is only a last resort. */
export function upstreamFor(ctx: Context, state: State): Located | { reason: string } {
  const found = resolveUpstream(ctx.paths, ctx.env, isOurWrapper, state.upstream_bin);
  if (found.kind !== "found") return { reason: describeLookup(found) };
  const launcher_restore = preserveLauncherRestore(state.launcher_restore, found.launcher_restore);
  return { state: { ...state, upstream_bin: found.bin, launcher_restore }, bin: found.bin };
}

/**
 * One acquisition: lock, resolve upstream, apply the policy, prepare a pair from `opts.source`,
 * activate it, and record the result. Both sources converge here, so the launcher refusal, the
 * state bookkeeping and the staging cleanup exist exactly once.
 *
 * `transport` is the test seam for the prebuilt path only; production callers omit it.
 */
export async function runAcquisition(
  ctx: Context,
  opts: AcquisitionOptions,
  transport: TransportOptions = {},
): Promise<PatchOutcome> {
  const release = acquireLock(ctx.paths.lockFile);
  if (!release) return { kind: "locked" };
  try {
    return await acquireLocked(ctx, loadState(ctx), opts, transport);
  } finally {
    release();
  }
}

async function acquireLocked(
  ctx: Context,
  initial: State,
  opts: AcquisitionOptions,
  transport: TransportOptions,
): Promise<PatchOutcome> {
  const located = upstreamFor(ctx, initial);
  if ("reason" in located) {
    recordFailure(ctx, initial, "unknown", located.reason);
    return { kind: "refused", reason: located.reason };
  }
  const state = located.state;
  // Persist the resolved upstream_bin/launcher_restore immediately - before the `held` check and
  // long before anything replaces the launcher. If the final bookkeeping write later fails, this
  // earlier one is what lets `revert` still find its way back to upstream.
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
  // Before any download or build: if the launcher is not ours to replace, nothing else is worth
  // spending minutes and gigabytes on.
  try {
    assertLauncherReplaceable(ctx.paths);
  } catch (e) {
    const reason = reasonOf(e);
    recordFailure(ctx, state, upstream.raw, reason);
    return { kind: "refused", reason };
  }
  return opts.source === "compiled"
    ? compiledAcquisition(ctx, state, upstream, transport.onStatus)
    : prebuiltAcquisition(ctx, state, upstream, transport);
}

/** Activate a staged pair and record it, removing the staging directory whatever happens. */
function install(
  ctx: Context,
  state: State,
  upstream: SemVer,
  source: AcquisitionSource,
  pair: PreparedPair,
): PatchOutcome {
  try {
    activatePair(pair, ctx);
    recordSuccess(ctx, state, upstream.raw);
    return { kind: "installed", version: upstream.raw, source, reused: false };
  } catch (e) {
    const reason = reasonOf(e);
    recordFailure(ctx, state, upstream.raw, reason);
    return { kind: "failed", reason };
  } finally {
    rmSync(pair.directory, { recursive: true, force: true });
  }
}

function compiledAcquisition(
  ctx: Context,
  state: State,
  upstream: SemVer,
  onStatus?: (phase: string, message: string) => void,
): PatchOutcome {
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
  let pair: PreparedPair;
  try {
    pair = prepareCompiled(ctx, upstream, ref, onStatus);
  } catch (e) {
    const reason = reasonOf(e);
    recordFailure(ctx, state, upstream.raw, reason);
    return { kind: "failed", reason };
  }
  return install(ctx, state, upstream, "compiled", pair);
}

/** The release identity this build of cxstatusline may install for `upstream`. */
function expectedRelease(upstream: SemVer): ExpectedRelease {
  return {
    cxVersion: VERSION,
    codexVersion: upstream.raw,
    platform: platformFor(process.platform, process.arch),
  };
}

function unavailable(ctx: Context, state: State, upstream: SemVer, reason: string): PatchOutcome {
  // A distinct token, not the prose: the hook bounds its retries on this exact reason.
  recordFailure(ctx, state, upstream.raw, RELEASE_UNAVAILABLE);
  return { kind: "unavailable", version: upstream.raw, reason };
}

async function prebuiltAcquisition(
  ctx: Context,
  state: State,
  upstream: SemVer,
  transport: TransportOptions,
): Promise<PatchOutcome> {
  const pf = prebuiltPreflight({ freeBytes: ctx.freeBytes }, ctx.paths);
  if (!pf.ok) {
    const reason = `${pf.reason}. Fix: ${pf.fix}`;
    recordFailure(ctx, state, upstream.raw, reason);
    return { kind: "refused", reason };
  }
  let expected: ExpectedRelease;
  try {
    expected = expectedRelease(upstream);
  } catch {
    // Unsupported platform, or a version no release can be named for: decided locally, before
    // a single byte goes over the network.
    return unavailable(ctx, state, upstream,
      `no prebuilt Codex ${upstream.raw} pair is published for ${process.platform}-${process.arch}`);
  }
  let prepared;
  try {
    prepared = await preparePrebuilt(ctx, expected, transport);
  } catch (e) {
    // Only a genuine "no such release/asset" gets the "unavailable" treatment (24h backoff, "not
    // published yet" wording). Everything else - a digest mismatch, a truncated download, an HTTP
    // 5xx, gh missing or not logged in - is a real problem: keep the real reason in last_attempt
    // and let the hook retry on the next drift check like any other failure.
    if (e instanceof ReleaseUnavailableError) {
      return unavailable(ctx, state, upstream, e.message);
    }
    const reason = sanitize(reasonOf(e));
    ctx.log(`prebuilt acquisition for Codex ${upstream.raw} failed: ${reasonOf(e)}`);
    recordFailure(ctx, state, upstream.raw, reason);
    return { kind: "failed", reason };
  }
  if (prepared.kind === "unchanged") {
    // The active generation already *is* this pair; its directory is live and must not be removed.
    // The launcher can still have been taken back by upstream's installer, so check that much.
    const w = ensureWrapper(ctx.paths, ctx.cxBin, false);
    if (w.kind === "refused") {
      recordFailure(ctx, state, upstream.raw, w.reason);
      return { kind: "refused", reason: w.reason };
    }
    recordSuccess(ctx, state, upstream.raw);
    return { kind: "installed", version: upstream.raw, source: "prebuilt", reused: true };
  }
  return install(ctx, state, upstream, "prebuilt", prepared.pair);
}

/** Named `describeOutcome`, not `describe`, so test files can import it next to bun:test's `describe`. */
export function describeOutcome(o: PatchOutcome): string {
  switch (o.kind) {
    case "installed":
      return o.reused
        ? `Codex ${o.version} (${o.source}) was already installed; reused the existing generation. Open a new session to use it.`
        : `Codex ${o.version} installed from ${o.source === "prebuilt" ? "the prebuilt release" : "source"}. Open a new session to use it.`;
    case "held": return `holding: upstream ${o.upstream}, patched from ${o.patched} (policy). Use --force to install anyway.`;
    case "refused": return `refused: ${o.reason}`;
    case "unavailable": return `no prebuilt Codex ${o.version} pair is available: ${o.reason}`;
    case "locked": return "another cxstatusline install is already running";
    case "failed": return `installation failed: ${o.reason}`;
  }
}
