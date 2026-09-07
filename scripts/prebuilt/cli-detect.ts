/**
 * `detect`: resolve every release input once, and decide whether there is anything to build.
 *
 * Two questions no later job re-asks: which cxstatusline commit and Codex version this run is
 * about, and what release already exists for the tag they imply.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Platform } from "../../src/distribution";
import { loadManifest } from "../../src/patch/manifest";
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
  patchesDir,
  releasePlatform,
  repoSlug,
  runnerTmp,
  sourceCommit,
  summary,
} from "./env";
import { execGh, type GhRunner } from "./gh";
import { archiveFilename, sha256File } from "./pack";
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
}

/**
 * A scheduled run builds the highest stable owner-published `v<CX>` source release, pinned to the
 * commit its tag points at - never whatever happens to be on the default branch. A manual dispatch
 * builds the dispatched commit. Null means "nothing to build", which is a success, not a failure.
 */
function resolveSource(flags: Record<string, string>, run: GhRunner, event: string): SourceSelection | null {
  if (event !== "schedule") {
    return { cxVersion: cxVersion(), sourceCommit: sourceCommit(), sourceTag: null };
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
  };
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
  platform: Platform,
): Promise<{ state: ReleaseState; identical: boolean; detail: string; url: string }> {
  const verdict = await checkExistingRelease({
    run,
    tag: detection.tag,
    expected,
    release: { cxVersion: detection.cxVersion, codexVersion: detection.codexVersion, platform },
    assetNames: [archiveFilename(detection.codexVersion, platform), "manifest.json", "SHA256SUMS"],
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
 * Resolve the release inputs. `--codex-version` (anything but `auto`) pins the version; otherwise
 * the highest stable upstream release is chosen and must be covered by `patches/manifest.json`.
 *
 * Exit codes are deliberately narrow: only an uncovered upstream or a release already published
 * from different inputs is "blocked, not broken" (`UNCOVERED_EXIT_CODE` with the blocked-issue
 * summary the `report` job keys its issue upsert on). A malformed `patches/manifest.json` or a
 * non-stable `--codex-version` is a plain infrastructure/input error: exit 1, no blocked summary,
 * so it is never mistaken for upstream-uncovered.
 */
export async function runDetect(flags: Record<string, string>): Promise<void> {
  const event = flags["event"] ?? process.env.GITHUB_EVENT_NAME ?? "workflow_dispatch";
  // Validated before anything reaches the network, so bad input fails fast and cheaply.
  const platform = releasePlatform(flags);
  const source = resolveSource(flags, execGh, event);
  if (source === null) {
    summary([
      "## Prebuilt release: nothing to build",
      "",
      "no v<CX> source release published; nothing to build",
      "",
      "Scheduled runs build the highest stable owner-published `v<CX>` source release. Publish one,",
      "or dispatch this workflow manually to build a specific commit.",
    ]);
    emit({ should_build: "false", release_state: "absent", skip_reason: "no-source-release" });
    return;
  }

  const requested = flags["codex-version"];
  const pinned = requested !== undefined && requested !== "auto" && requested !== "true";
  const releases = flags["releases-file"] !== undefined
    ? (JSON.parse(readFileSync(flags["releases-file"], "utf8")) as unknown)
    : null;
  const codexVersion = pinned ? requested! : selectStableVersion(releases ?? (await fetchUpstreamReleases()));
  const manifest = loadManifest(patchesDir());
  let detection: Detection;
  try {
    detection = resolveDetection(manifest, codexVersion, source.cxVersion);
  } catch (e) {
    if (!(e instanceof UncoveredUpstreamError)) throw e;
    summary([`## ${blockedIssueTitle(codexVersion)}`, "", e.message]);
    process.exit(UNCOVERED_EXIT_CODE);
  }
  const patch = join(patchesDir(), detection.patchFile);
  if (!existsSync(patch)) {
    throw new Error(`patches/${detection.patchFile} is referenced by the manifest but missing from the checkout`);
  }
  const patchSha256 = (await sha256File(patch)).sha256;

  const existing = await releaseState(execGh, detection, { sourceCommit: source.sourceCommit, patchSha256 }, platform);
  if (existing.state === "published" && !existing.identical) {
    // Immutability: the tag is taken by different bytes. Only a CX version bump resolves it.
    summary([
      `## ${blockedIssueTitle(detection.codexVersion)}`,
      "",
      immutabilityMessage(detection.tag, existing.detail),
    ]);
    process.exit(UNCOVERED_EXIT_CODE);
  }
  const shouldBuild = !(existing.state === "published" && existing.identical);
  if (!shouldBuild) {
    summary([
      `## Prebuilt ${detection.tag}`,
      "",
      `already published, identical: ${existing.url}`,
      "",
      "Nothing to do.",
    ]);
  }

  emit({
    codex_version: detection.codexVersion,
    cx_version: detection.cxVersion,
    tag: detection.tag,
    upstream_tag: detection.upstreamTag,
    patch_file: detection.patchFile,
    patch_sha256: patchSha256,
    source: pinned ? "dispatch" : "auto",
    source_commit: source.sourceCommit,
    source_tag: source.sourceTag ?? "",
    release_state: existing.state,
    release_url: existing.url,
    should_build: shouldBuild ? "true" : "false",
  });
}

