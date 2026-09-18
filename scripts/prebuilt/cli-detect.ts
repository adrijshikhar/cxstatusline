/**
 * `detect`: resolve every release input once, and decide whether there is anything to build.
 *
 * Two questions no later job re-asks: which cxstatusline commit and Codex version this run is
 * about, and what release already exists for the tag they imply.
 */
import { readFileSync } from "node:fs";
import type { Platform } from "../../src/distribution";
import { loadManifest, type Manifest } from "../../src/patch/manifest";
import {
  blockedIssueTitle,
  resolveDetection,
  selectStableVersion,
  UncoveredUpstreamError,
  UNCOVERED_EXIT_CODE,
  type Detection,
} from "./detect";
import {
  cxVersion,
  emit,
  oneLine,
  releasePlatforms,
  repoSlug,
  runnerTmp,
  sourceCommit,
  summary,
} from "./env";
import { execGh, type GhRunner } from "./gh";
import { archiveFilename, sha256File } from "./pack";
import { commitPatches, workingTreePatches, type PatchTree } from "./patch-tree";
import { checkExistingRelease, immutabilityMessage, type ReleaseState } from "./release";
import { listSourceReleases, resolveTagCommit, selectSourceRelease } from "./source";

const RELEASES_URL = "https://api.github.com/repos/openai/codex/releases?per_page=100";

async function fetchUpstreamReleases(): Promise<unknown> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "cxstatusline-prebuilt",
  };
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(RELEASES_URL, { headers, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`upstream release listing failed with HTTP ${response.status}`);
  return response.json();
}

/** Where a scheduled run's CX source comes from. */
interface SourceSelection {
  readonly cxVersion: string;
  readonly sourceCommit: string;
  readonly sourceTag: string | null;
  /**
   * True when `sourceCommit` is an older commit than the one this job is checked out at, so
   * `patches/` must be read out of that commit rather than out of the working tree.
   */
  readonly frozen: boolean;
}

/**
 * A scheduled run builds the highest stable owner-published `v<CX>` source release, pinned to the
 * commit its tag points at - never whatever happens to be on the default branch. A manual dispatch
 * builds the dispatched commit. Null means "nothing to build", which is a success, not a failure.
 */
function resolveSource(flags: Record<string, string>, run: GhRunner, event: string): SourceSelection | null {
  if (event !== "schedule") {
    return { cxVersion: cxVersion(), sourceCommit: sourceCommit(), sourceTag: null, frozen: false };
  }
  const repo = repoSlug(flags);
  const payload = flags["source-releases-file"] !== undefined
    ? (JSON.parse(readFileSync(flags["source-releases-file"], "utf8")) as unknown)
    : listSourceReleases(run, repo);
  const selected = selectSourceRelease(payload);
  if (selected === null) return null;
  return {
    cxVersion: selected.version,
    sourceCommit: resolveTagCommit(run, repo, selected.tag),
    sourceTag: selected.tag,
    frozen: true,
  };
}

export interface MatrixEntry {
  readonly runner: string | readonly string[];
  readonly arch: "arm64" | "x64";
  readonly target: "aarch64-apple-darwin" | "x86_64-apple-darwin";
  readonly platform: Platform;
}

export function buildMatrix(platforms: readonly Platform[], selfHosted: boolean): readonly MatrixEntry[] {
  if (selfHosted) {
    return [{
      runner: ["self-hosted", "macOS", "ARM64", "m5-pro"],
      arch: "arm64",
      target: "aarch64-apple-darwin",
      platform: "darwin-arm64",
    }];
  }
  return platforms.map((platform) => {
    if (platform === "darwin-arm64") {
      return {
        runner: "macos-15",
        arch: "arm64",
        target: "aarch64-apple-darwin",
        platform: "darwin-arm64",
      };
    }
    if (platform === "darwin-x64") {
      return {
        runner: "macos-15-intel",
        arch: "x64",
        target: "x86_64-apple-darwin",
        platform: "darwin-x64",
      };
    }
    throw new Error(`unknown platform ${String(platform)}`);
  });
}

/**
 * Classify the release that already exists for this tag. `published` and identical means this run
 * has nothing to do (success, no build); `published` and different means the immutability rule has
 * been hit and only the owner can resolve it; `draft` means the publish job resumes it.
 */
async function releaseState(
  run: GhRunner,
  detection: Detection,
  expected: { readonly sourceCommit: string; readonly patchSha256: string },
  platforms: readonly Platform[],
): Promise<{ state: ReleaseState; identical: boolean; detail: string; url: string }> {
  const verdict = await checkExistingRelease({
    run,
    tag: detection.tag,
    expected,
    release: { cxVersion: detection.cxVersion, codexVersion: detection.codexVersion, platforms },
    assetNames: [...platforms.map((p) => archiveFilename(detection.codexVersion, p)), "manifest.json", "SHA256SUMS"],
    tmpRoot: runnerTmp("prebuilt-detect"),
  });
  return {
    state: verdict.state,
    identical: verdict.state === "published" && verdict.identical,
    detail: verdict.state === "published" ? verdict.detail : "",
    url: verdict.view.url,
  };
}

/**
 * The `patches/` tree this run must hash: the frozen source commit's for a scheduled run, the
 * working tree's for a manual dispatch (whose checkout *is* `github.sha`).
 */
function patchTreeFor(source: SourceSelection): PatchTree {
  return source.frozen
    ? commitPatches(source.sourceCommit, runnerTmp("prebuilt-patches"))
    : workingTreePatches();
}

/** The upstream version this run is about: pinned by `--codex-version`, or the highest stable. */
async function resolveCodexVersion(flags: Record<string, string>): Promise<{ version: string; pinned: boolean }> {
  const requested = flags["codex-version"];
  const pinned = requested !== undefined && requested !== "auto" && requested !== "true";
  if (pinned) return { version: requested!, pinned: true };
  const releases = flags["releases-file"] !== undefined
    ? (JSON.parse(readFileSync(flags["releases-file"], "utf8")) as unknown)
    : await fetchUpstreamReleases();
  return { version: selectStableVersion(releases), pinned: false };
}

/**
 * Exit 3 - blocked, not broken - with the outputs the `report` job needs to file the issue against
 * the right identity. Without them `needs.detect.outputs.codex_version` is empty and every block,
 * including an immutability block that knows its version exactly, is misfiled under the
 * "upstream detection" title.
 */
function blockedExit(outputs: Record<string, string>, title: string, message: string): never {
  emit({ ...outputs, should_build: "false", blocked_reason: oneLine(message) });
  summary([`## ${title}`, "", message]);
  process.exit(UNCOVERED_EXIT_CODE);
}

/** The deliberate, successful no-op: a cron run with no `v<CX>` source release to build. */
function skipNoSource(platforms: readonly Platform[], matrix: readonly MatrixEntry[]): void {
  summary([
    "## Prebuilt release: nothing to build",
    "",
    "no v<CX> source release published; nothing to build",
    "",
    "Scheduled runs build the highest stable owner-published `v<CX>` source release. Publish one,",
    "or dispatch this workflow manually to build a specific commit.",
  ]);
  emit({
    should_build: "false",
    release_state: "absent",
    skip_reason: "no-source-release",
    platforms: platforms.join(","),
    matrix: JSON.stringify(matrix),
  });
}

/** Resolve the release identity, or exit 3 attributed to the version that is not covered. */
function resolveOrBlock(
  manifest: Manifest,
  codexVersion: string,
  source: SourceSelection,
  platforms: readonly Platform[],
  matrix: readonly MatrixEntry[],
): Detection {
  try {
    return resolveDetection(manifest, codexVersion, source.cxVersion);
  } catch (e) {
    if (!(e instanceof UncoveredUpstreamError)) throw e;
    // The version *is* known here, so the issue belongs to it, not to "upstream detection".
    blockedExit(
      {
        codex_version: codexVersion,
        cx_version: source.cxVersion,
        tag: "",
        patch_sha256: "",
        release_state: "unknown",
        platforms: platforms.join(","),
        matrix: JSON.stringify(matrix),
      },
      blockedIssueTitle(codexVersion),
      e.message,
    );
  }
}

interface Resolved {
  readonly patchSha256: string;
  readonly pinned: boolean;
  readonly patchesFrom: string;
}

/** Freeze every release input as a step output - or exit 3 when the tag is taken by other bytes. */
function finish(
  detection: Detection,
  source: SourceSelection,
  existing: { state: ReleaseState; identical: boolean; detail: string; url: string },
  resolved: Resolved,
  platforms: readonly Platform[],
  matrix: readonly MatrixEntry[],
): void {
  const frozen = {
    codex_version: detection.codexVersion,
    cx_version: detection.cxVersion ?? "",
    tag: detection.tag,
    upstream_tag: detection.upstreamTag,
    patch_file: detection.patchFile,
    patch_sha256: resolved.patchSha256,
    source: resolved.pinned ? "dispatch" : "auto",
    source_commit: source.sourceCommit,
    source_tag: source.sourceTag ?? "",
    release_state: existing.state,
    release_url: existing.url,
    platforms: platforms.join(","),
    matrix: JSON.stringify(matrix),
  };
  if (existing.state === "published" && !existing.identical) {
    // Immutability: the tag is taken by different bytes. Only a CX version bump resolves it.
    blockedExit(frozen, blockedIssueTitle(detection.codexVersion), immutabilityMessage(detection.tag, existing.detail));
  }
  const shouldBuild = !(existing.state === "published" && existing.identical);
  if (!shouldBuild) {
    summary([`## Prebuilt ${detection.tag}`, "", `already published, identical: ${existing.url}`, "", "Nothing to do."]);
  }
  emit({ ...frozen, patches_from: resolved.patchesFrom, should_build: shouldBuild ? "true" : "false" });
}

/**
 * Resolve the release inputs. `--codex-version` (anything but `auto`) pins the version; otherwise
 * the highest stable upstream release is chosen and must be covered by `patches/manifest.json`.
 *
 * Exit codes are deliberately narrow: only an uncovered upstream or a release already published
 * from different inputs is "blocked, not broken" (`UNCOVERED_EXIT_CODE` with the blocked-issue
 * summary *and* the frozen outputs the `report` job keys its issue upsert on). A malformed
 * `patches/manifest.json` or a non-stable `--codex-version` is a plain infrastructure/input error:
 * exit 1, no blocked summary, so it is never mistaken for upstream-uncovered.
 */
export async function runDetect(flags: Record<string, string>): Promise<void> {
  const event = flags["event"] ?? process.env.GITHUB_EVENT_NAME ?? "workflow_dispatch";
  const selfHosted = flags["self-hosted"] === "true";
  const platforms = releasePlatforms(flags);
  if (selfHosted && platforms.includes("darwin-x64")) {
    throw new Error("self-hosted runner is arm64 only");
  }
  const matrix = buildMatrix(platforms, selfHosted);
  const source = resolveSource(flags, execGh, event);
  if (source === null) {
    skipNoSource(platforms, matrix);
    return;
  }
  const { version: codexVersion, pinned } = await resolveCodexVersion(flags);
  const patches = patchTreeFor(source);
  const detection = resolveOrBlock(loadManifest(patches.manifestDir), codexVersion, source, platforms, matrix);
  const patchSha256 = (await sha256File(patches.patchPath(detection.patchFile))).sha256;
  const expected = { sourceCommit: source.sourceCommit, patchSha256 };
  const existing = await releaseState(execGh, detection, expected, platforms);
  finish(detection, source, existing, { patchSha256, pinned, patchesFrom: patches.describe }, platforms, matrix);
}
