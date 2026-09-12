import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "../context";
import { acquireLock } from "../lock";
import type { FetchLike, TransportOptions } from "../distribution/transport";
import { releaseTag } from "../distribution";
import { VERSION } from "../version-info";
import { readUpstreamVersion } from "../codex/upstream";
import { installHook } from "../hook/install";
import { writeState } from "../state";
import { parseSemver } from "../version";
import { describeOutcome, loadState, runAcquisition, upstreamFor, type PatchOutcome } from "./acquire";
import { ManifestError, loadManifest, resolvePatch } from "./manifest";
import {
  renderInstallFailure,
  renderInstallHeader,
  renderInstallHookError,
  renderInstallSuccess,
} from "../ui/install-format";

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
  ctx.say(renderInstallHeader(opts.compile));
  const outcome = await runAcquisition(ctx, { source: opts.compile ? "compiled" : "prebuilt", force: true }, transport);
  if (outcome.kind !== "installed") {
    const advice = outcome.kind === "unavailable" ? fallbackAdvice(ctx, outcome.version) : [];
    ctx.say(renderInstallFailure(outcome, advice));
    return 1;
  }
  try {
    const r = installHook(ctx.paths.hooksFile, ctx.cxBin);
    ctx.say(renderInstallSuccess({
      version: outcome.version,
      source: outcome.source,
      reused: outcome.reused,
      hookAction: r,
      hookFile: ctx.paths.hooksFile,
    }));
    return 0;
  } catch (e) {
    ctx.say(renderInstallHookError({
      version: outcome.version,
      hookFile: ctx.paths.hooksFile,
      error: String(e),
    }));
    return 1;
  }
}

export interface UpdateOptions {
  readonly force?: boolean;
  readonly compile?: boolean;
}

export async function probeUpstreamLatest(fetchFn: FetchLike): Promise<string | null> {
  try {
    const res = await fetchFn("https://api.github.com/repos/openai/codex/releases/latest", {
      headers: { accept: "application/vnd.github+json", "user-agent": "cxstatusline" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { tag_name?: string };
    if (typeof data.tag_name !== "string") return null;
    return data.tag_name.replace(/^rust-v/, "");
  } catch {
    return null;
  }
}

export async function probePrebuiltExists(
  targetCodexVersion: string,
  cxVersion: string,
  fetchFn: FetchLike,
  baseUrl?: string,
): Promise<boolean> {
  try {
    const tag = releaseTag(cxVersion, targetCodexVersion);
    const url = baseUrl
      ? `${baseUrl}/${tag}/manifest.json`
      : `https://github.com/adrijshikhar/cxstatusline/releases/download/${tag}/manifest.json`;
    const res = await fetchFn(url, { method: "HEAD", signal: AbortSignal.timeout(5000) });
    return res.ok || res.status === 302 || res.status === 301;
  } catch {
    return false;
  }
}

/**
 * `codex update` -> upstream's own updater, then the prebuilt pair for whatever it landed on.
 * Performs a pre-flight probe: if upstream is moving to a version without a published prebuilt,
 * warns and stops before touching stock Codex unless --force or --compile is specified.
 */
export async function runUpdate(
  ctx: Context,
  optsOrTransport: UpdateOptions | TransportOptions = {},
  maybeTransport?: TransportOptions,
): Promise<number> {
  const opts: UpdateOptions =
    "compile" in optsOrTransport || "force" in optsOrTransport ? optsOrTransport : {};
  const transport: TransportOptions =
    "baseUrl" in optsOrTransport || "fetch" in optsOrTransport
      ? optsOrTransport
      : (maybeTransport ?? {});

  const state = loadState(ctx);
  const located = upstreamFor(ctx, state);
  if ("reason" in located) {
    ctx.say(`no upstream Codex to update: ${located.reason}`);
    return 1;
  }

  const current = readUpstreamVersion(located.bin, ctx.run);
  const fetchFn: FetchLike = transport.fetch ?? fetch;

  if (current && !opts.force && !opts.compile) {
    const latest = await probeUpstreamLatest(fetchFn);
    if (latest && latest !== current.raw) {
      const available = await probePrebuiltExists(latest, VERSION, fetchFn, transport.baseUrl);
      if (!available) {
        ctx.say(`Warning: Upstream Codex update available: ${current.raw} -> ${latest}.`);
        ctx.say(`However, cxstatusline has not yet published prebuilt binaries for Codex ${latest}.`);
        ctx.say("Updating now will replace your patched launcher with stock Codex.");
        ctx.say("");
        ctx.say("Options:");
        ctx.say("  - Wait until cxstatusline publishes prebuilt binaries for this version.");
        ctx.say("  - Update and compile from source: cxstatusline update --compile");
        ctx.say("  - Update to stock Codex anyway:   cxstatusline update --force");
        return 1;
      }
    } else if (latest && latest === current.raw) {
      ctx.say(`Codex is already at the latest version (${current.raw}).`);
      return 0;
    }
  }

  ctx.say(`running upstream updater: ${located.bin} update`);
  const r = ctx.run(located.bin, ["update"], { interactive: true });
  if (r.status !== 0) {
    ctx.say(`upstream updater exited ${String(r.status)}; see its output above. Not installing.`);
    return 1;
  }

  const source = opts.compile ? "compiled" : "prebuilt";
  const outcome = await runAcquisition(ctx, { source, force: true }, transport);
  report(ctx, outcome);
  return outcome.kind === "installed" ? 0 : 1;
}

export function appendLog(file: string, line: string): void {
  mkdirSync(join(file, ".."), { recursive: true });
  appendFileSync(file, `${new Date().toISOString()} ${line}\n`);
}
