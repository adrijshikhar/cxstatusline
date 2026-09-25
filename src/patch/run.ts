import { appendFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "../context";
import { acquireLock } from "../lock";
import type { FetchLike, TransportOptions } from "../distribution/transport";
import { platformFor, releaseTag, type ExpectedRelease } from "../distribution";
import { installHook } from "../hook/install";
import { writeState } from "../state";
import { readInstallation } from "./generation";
import { compareSemver, parseSemver } from "../version";
import { fetchPublishedPrebuiltVersions, preparePrebuilt } from "../distribution/prebuilt";
import { promptUpdate, type UpdateAction, type UpdatePickerOptions } from "../ui/UpdatePicker";
import { loadState, runAcquisition, type PatchOutcome } from "./acquire";
import { ManifestError, loadManifest, resolvePatch, supportedCodexVersions, isCodexVersionSupported } from "./manifest";
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

import { createInstallProgressTracker } from "../ui/progress";

export function runPatch(ctx: Context, opts: { force: boolean }, transport: TransportOptions = {}): Promise<PatchOutcome> {
  ctx.say(renderInstallHeader(true));
  const progress = createInstallProgressTracker({
    isTTY: process.stdout?.isTTY,
    stdout: process.stdout,
    say: (l) => ctx.say(l),
  }, transport);
  return runAcquisition(ctx, { source: "compiled", force: opts.force }, progress.transport).finally(() => {
    progress.finish();
  });
}

export interface InstallOptions {
  readonly compile: boolean;
  readonly codexVersion?: string;
}

/**
 * `cxstatusline install [--compile] [--codex-version <v>]`: acquire a pair, then merge the SessionStart hook.
 * Why the hook write is caught: the pair is already active at that point, so a hand-broken
 * hooks.json must not make `install` look like it did nothing.
 */
export async function runInstall(ctx: Context, opts: InstallOptions, transport: TransportOptions = {}): Promise<number> {
  ctx.say(renderInstallHeader(opts.compile));
  const progress = createInstallProgressTracker({
    isTTY: process.stdout?.isTTY,
    stdout: process.stdout,
    say: (l) => ctx.say(l),
  }, transport);

  let outcome: PatchOutcome;
  try {
    outcome = await runAcquisition(
      ctx,
      {
        source: opts.compile ? "compiled" : "prebuilt",
        force: true,
        targetVersion: opts.codexVersion,
      },
      progress.transport,
    );
  } finally {
    progress.finish();
  }
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
  readonly isTTY?: boolean;
  readonly promptUpdate?: (options: UpdatePickerOptions) => Promise<UpdateAction>;
  readonly force?: boolean;
  readonly compile?: boolean;
  readonly fetchPrebuilts?: (fetchFn?: FetchLike, repo?: string) => Promise<string[]>;
}

export async function probeUpstreamLatest(fetchFn: FetchLike): Promise<string | null> {
  try {
    const headers: Record<string, string> = { accept: "application/vnd.github+json", "user-agent": "cxstatusline" };
    if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const res = await fetchFn("https://api.github.com/repos/openai/codex/releases/latest", {
      headers,
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

export interface RemoteCandidate {
  readonly version: string;
  readonly available: boolean;
}

export async function probeRemoteCandidate(
  targetCodexVersion?: string,
  fetchFnOrBaseUrl?: FetchLike | string,
  baseUrl?: string,
): Promise<RemoteCandidate | null> {
  const fetchFn: FetchLike =
    typeof fetchFnOrBaseUrl === "function"
      ? fetchFnOrBaseUrl
      : (globalThis.fetch as unknown as FetchLike);
  const resolvedBaseUrl: string | undefined =
    typeof fetchFnOrBaseUrl === "string" ? fetchFnOrBaseUrl : baseUrl;

  try {
    const target = targetCodexVersion ?? (await probeUpstreamLatest(fetchFn));
    if (!target) return null;
    const tag = releaseTag(target);
    const url = resolvedBaseUrl
      ? `${resolvedBaseUrl}/${tag}/manifest.json`
      : `https://github.com/adrijshikhar/cxstatusline/releases/download/${tag}/manifest.json`;
    const res = await fetchFn(url, { method: "HEAD", signal: AbortSignal.timeout(5000) });
    const available = res.ok || res.status === 302 || res.status === 301;
    return { version: target, available };
  } catch {
    return null;
  }
}

/** Install the latest supported pair directly; upstream is only retained for revert. */
export async function runUpdate(
  ctx: Context,
  opts: UpdateOptions = {},
  transport: TransportOptions = {},
): Promise<number> {
  const manifest = loadManifest(ctx.patchesDir);
  const versions = opts.compile
    ? supportedCodexVersions(manifest)
    : await (opts.fetchPrebuilts ?? fetchPublishedPrebuiltVersions)(transport.fetch);
  const target = versions
    .filter((version) => isCodexVersionSupported(manifest, version))
    .sort((a, b) => compareSemver(parseSemver(b)!, parseSemver(a)!))[0];
  if (!target) {
    ctx.say(opts.compile
      ? "No supported source patch is available. Update the cxstatusline package and retry."
      : "No supported prebuilt release could be found. Check your connection or update the cxstatusline package and retry. Your installation is unchanged.");
    return 1;
  }

  const installed = readInstallation(ctx.paths)?.codexVersion ?? loadState(ctx).patched_from;
  const current = installed ? parseSemver(installed) : null;
  const targetSemver = parseSemver(target)!;

  if (current && compareSemver(current, targetSemver) > 0) {
    ctx.say(`Installed Codex ${installed} is newer than the latest supported ${opts.compile ? "patch" : "prebuilt"} (${target}); leaving it unchanged.`);
    return 0;
  }

  if (current && compareSemver(current, targetSemver) === 0 && !opts.force) {
    const record = readInstallation(ctx.paths);
    if (!opts.compile && record && record.provenance.source === "prebuilt") {
      try {
        const expected: ExpectedRelease = {
          codexVersion: target,
          platform: platformFor(process.platform, process.arch),
        };
        const prepared = await preparePrebuilt(ctx, expected, transport);
        if (prepared.kind === "unchanged") {
          ctx.say(`Codex is already up to date (${installed}).`);
          return 0;
        }
        rmSync(prepared.pair.directory, { recursive: true, force: true });
      } catch {
        // Fall through to runInstall to let standard failure handling report errors.
      }
    } else if (opts.compile && record && record.provenance.source === "compiled") {
      const patchRef = resolvePatch(manifest, targetSemver);
      const currentPatch = record.provenance.patchVersion ?? 1;
      const targetPatch = patchRef?.patchVersion ?? 1;
      if (currentPatch >= targetPatch) {
        ctx.say(`Codex is already up to date (${installed}).`);
        return 0;
      }
    }
  }

  if (opts.isTTY && !opts.force && !opts.compile && (!current || compareSemver(current, targetSemver) < 0)) {
    const action = await (opts.promptUpdate ?? promptUpdate)({ latest: target, highestAvailable: target });
    if (action === "cancel") {
      ctx.say("Update cancelled.");
      return 0;
    }
    if (action === "compile") return runInstall(ctx, { compile: true, codexVersion: target }, transport);
  }
  // Re-check even the same version: a release may contain a newer statusline patch.
  return runInstall(ctx, { compile: opts.compile ?? false, codexVersion: target }, transport);
}

export function appendLog(file: string, line: string): void {
  mkdirSync(join(file, ".."), { recursive: true });
  appendFileSync(file, `${new Date().toISOString()} ${line}\n`);
}
