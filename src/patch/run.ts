import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "../context";
import { acquireLock } from "../lock";
import type { TransportOptions } from "../distribution/transport";
import { installHook } from "../hook/install";
import { writeState } from "../state";
import { parseSemver } from "../version";
import { describeOutcome, loadState, runAcquisition, upstreamFor, type PatchOutcome } from "./acquire";
import { ManifestError, loadManifest, resolvePatch } from "./manifest";

export {
  describeOutcome,
  runAcquisition,
  type AcquisitionOptions,
  type AcquisitionSource,
  type PatchOutcome,
} from "./acquire";

/** The repository the fallback advice points at, and the only one its issue lookup ever queries. */
const REPO = "adrijshikhar/cxstatusline";

/** Pretend we were patched from `version` so the next SessionStart sees drift. Nothing else changes. */
export function simulateDrift(ctx: Context, version: string): string {
  if (!parseSemver(version)) throw new Error(`--simulate-drift needs a semver like 0.151.0, not "${version}"`);
  const release = acquireLock(ctx.paths.lockFile);
  if (!release) throw new Error("another cxstatusline patch is already running; try again in a moment");
  try {
    const state = loadState(ctx);
    writeState(ctx.paths.stateFile, { ...state, patched_from: version });
    return `state.json now claims the installed pair came from ${version}. Start a Codex session: the hook should detect drift, install in the background, and the session after that should run the new pair.`;
  } finally {
    release();
  }
}

/** True when `patches/manifest.json` covers this exact version, so `--compile` is real advice. */
function manifestCovers(ctx: Context, version: string): boolean {
  const parsed = parseSemver(version);
  if (!parsed) return false;
  try {
    return resolvePatch(loadManifest(ctx.patchesDir), parsed) !== null;
  } catch (e) {
    if (e instanceof ManifestError) return false;
    throw e;
  }
}

/**
 * The one tracking issue for this blocked version, if it exists.
 * Deliberately silent when `gh` is missing or unhappy: a broken lookup is not news, and a link we
 * cannot confirm exists is worse than no link.
 */
function blockedIssueUrl(ctx: Context, version: string): string | null {
  if (!ctx.which("gh")) return null;
  const title = `Prebuilt blocked: Codex ${version}`;
  const r = ctx.run("gh", ["issue", "list", "--repo", REPO, "--search", title, "--state", "all", "--json", "title,url", "--limit", "30"]);
  if (r.status !== 0) return null;
  try {
    const rows = JSON.parse(r.stdout) as unknown;
    if (!Array.isArray(rows)) return null;
    const hit = rows.find((row): row is { title: string; url: string } =>
      typeof row === "object" && row !== null
      && (row as { title?: unknown }).title === title
      && typeof (row as { url?: unknown }).url === "string");
    return hit ? hit.url : null;
  } catch {
    return null;
  }
}

/** What a user can actually do after `unavailable`. Never suggests a build that cannot work. */
export function fallbackAdvice(ctx: Context, version: string): string[] {
  if (manifestCovers(ctx, version)) {
    return [`Run \`cxstatusline install --compile\` to build Codex ${version} from source instead.`];
  }
  const lines = [`Neither a prebuilt release nor a local patch is available for Codex ${version}; the pair you already have is untouched.`];
  const url = blockedIssueUrl(ctx, version);
  if (url) lines.push(`Tracking issue: ${url}`);
  return lines;
}

function report(ctx: Context, outcome: PatchOutcome): void {
  ctx.say(describeOutcome(outcome));
  if (outcome.kind === "unavailable") for (const line of fallbackAdvice(ctx, outcome.version)) ctx.say(line);
}

/** `cxstatusline patch [--force]`: the explicit compile-from-source path. */
export function runPatch(ctx: Context, opts: { force: boolean }): Promise<PatchOutcome> {
  return runAcquisition(ctx, { source: "compiled", force: opts.force });
}

/**
 * `cxstatusline install [--compile]`: acquire a pair, then merge the SessionStart hook.
 * Why the hook write is caught: the pair is already active at that point, so a hand-broken
 * hooks.json must not make `install` look like it did nothing.
 */
export async function runInstall(ctx: Context, opts: { compile: boolean }, transport: TransportOptions = {}): Promise<number> {
  const outcome = await runAcquisition(ctx, { source: opts.compile ? "compiled" : "prebuilt", force: true }, transport);
  report(ctx, outcome);
  if (outcome.kind !== "installed") return 1;
  try {
    const r = installHook(ctx.paths.hooksFile, ctx.cxBin);
    ctx.say(`hook ${r} in ${ctx.paths.hooksFile}`);
    if (r === "added") ctx.say("Start Codex once and accept the cxstatusline hook when prompted.");
    return 0;
  } catch (e) {
    ctx.say(`Codex ${outcome.version} is installed, but the SessionStart hook could not be written: ${String(e)}`);
    ctx.say(`Fix ${ctx.paths.hooksFile} by hand, then run \`cxstatusline hook install\`.`);
    return 1;
  }
}

/**
 * `codex update` -> upstream's own updater, then the prebuilt pair for whatever it landed on.
 * Never falls back to compiling: an update that cannot find its release leaves the working pair
 * exactly where it is, and says so.
 */
export async function runUpdate(ctx: Context, transport: TransportOptions = {}): Promise<number> {
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
    ctx.say(`upstream updater exited ${String(r.status)}; see its output above. Not installing.`);
    return 1;
  }
  // Upstream just moved: runAcquisition re-resolves the launcher and re-reads its version rather
  // than trusting anything read before the updater ran.
  const outcome = await runAcquisition(ctx, { source: "prebuilt", force: true }, transport);
  report(ctx, outcome);
  return outcome.kind === "installed" ? 0 : 1;
}

export function appendLog(file: string, line: string): void {
  mkdirSync(join(file, ".."), { recursive: true });
  appendFileSync(file, `${new Date().toISOString()} ${line}\n`);
}
