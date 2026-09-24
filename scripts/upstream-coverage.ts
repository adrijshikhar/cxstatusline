import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { DEFAULT_PREBUILT_PLATFORMS, validateManifest, type Platform, type ReleaseManifest } from "../src/distribution";
import { resolvePatch, type Manifest } from "../src/patch/manifest";
import { compareSemver, parseSemver } from "../src/version";
import { listStableVersions } from "./prebuilt/detect";
import { execGh, ghJson, ghText, type GhRunner } from "./prebuilt/gh";
import { patchesDir as defaultPatchesDir, repoSlug } from "./prebuilt/env";
import { loadManifest } from "../src/patch/manifest";

export type CoverageStatus = "unsupported" | "missing-prebuilt" | "invalid-prebuilt" | "ready";
export interface CoverageRow {
  readonly version: string;
  readonly status: CoverageStatus;
  readonly detail: string;
  readonly patchVersion?: number;
}
export interface CoverageReport {
  readonly checkedAt: string;
  readonly floor: string;
  readonly rows: readonly CoverageRow[];
  readonly gapCount: number;
}
export interface CoverageRelease {
  readonly tag_name: string;
  readonly draft?: boolean;
  readonly prerelease?: boolean;
  readonly assets: readonly { readonly id?: number; readonly name: string; readonly size: number }[];
}

/** Reads every page; any failed page rejects the complete audit. */
export async function fetchAllReleasePages(
  fetchPage: (page: number) => Promise<unknown>,
): Promise<unknown[]> {
  const all: unknown[] = [];
  for (let page = 1; ; page += 1) {
    const result = await fetchPage(page);
    if (!Array.isArray(result)) throw new Error(`release listing page ${page} was not a JSON list`);
    all.push(...result);
    if (result.length < 100) return all;
  }
}

export function stableUpstreamVersions(releases: unknown, floor: string): string[] {
  const minimum = parseSemver(floor);
  if (!minimum || minimum.pre !== null) throw new Error(`invalid coverage floor ${floor}`);
  return listStableVersions(releases).filter((version) => compareSemver(parseSemver(version)!, minimum) >= 0);
}

function fail(version: string, detail: string, patchVersion?: number): CoverageRow {
  return { version, status: "invalid-prebuilt", detail, ...(patchVersion === undefined ? {} : { patchVersion }) };
}

export function classifyCoverage(
  manifest: Manifest,
  versions: readonly string[],
  releases: readonly CoverageRelease[],
  metadataByVersion: ReadonlyMap<string, unknown>,
  patchesDir: string,
  platforms: readonly Platform[] = DEFAULT_PREBUILT_PLATFORMS,
): CoverageRow[] {
  const floor = manifest.patches.map((p) => p.min).sort((a, b) => compareSemver(parseSemver(a)!, parseSemver(b)!))[0];
  if (!floor) throw new Error("compatibility manifest has no support floor");
  const sorted = [...new Set(versions)].filter((v) => compareSemver(parseSemver(v)!, parseSemver(floor)!) >= 0)
    .sort((a, b) => compareSemver(parseSemver(a)!, parseSemver(b)!));
  return sorted.map((version): CoverageRow => {
    const patch = resolvePatch(manifest, parseSemver(version)!);
    if (!patch) return { version, status: "unsupported", detail: "No compatibility entry" };
    const tag = `codex-v${version}`;
    const matches = releases.filter((release) => release.tag_name === tag && release.draft !== true);
    const release = matches.at(-1);
    if (!release) return { version, status: "missing-prebuilt", detail: "No published matching release" };
    const raw = metadataByVersion.get(version);
    if (raw === undefined) return fail(version, "Release manifest is missing", patch.patchVersion);
    let releaseManifest: ReleaseManifest | undefined;
    try {
      for (const platform of platforms) {
        releaseManifest = validateManifest(raw, { codexVersion: version, platform });
      }
    } catch (error) {
      return fail(version, `Release manifest is invalid: ${error instanceof Error ? error.message : String(error)}`, patch.patchVersion);
    }
    if (!releaseManifest) return fail(version, "No required platforms were configured", patch.patchVersion);
    const selectedBytes = readFileSync(join(patchesDir, patch.file));
    const selectedSha = createHash("sha256").update(selectedBytes).digest("hex");
    if (releaseManifest.patchSha256 !== selectedSha) return fail(version, "Release patch digest differs from selected patch", patch.patchVersion);
    if (releaseManifest.schema === 2 && releaseManifest.patchVersion !== patch.patchVersion) {
      return fail(version, `Release patchVersion ${releaseManifest.patchVersion} differs from selected ${patch.patchVersion}`, patch.patchVersion);
    }
    const assets = new Map(release.assets.map((asset) => [asset.name, asset.size]));
    const required = [
      ...releaseManifest.artifacts.map((artifact) => [artifact.filename, artifact.size] as const),
      ["manifest.json", 1] as const,
      ["SHA256SUMS", 1] as const,
    ];
    for (const [name, size] of required) {
      const actual = assets.get(name);
      if (actual === undefined || actual < 1 || (name !== "manifest.json" && name !== "SHA256SUMS" && actual !== size)) {
        return fail(version, `Release asset ${name} is missing or has an invalid size`, patch.patchVersion);
      }
    }
    return {
      version,
      status: "ready",
      detail: releaseManifest.schema === 1 ? `Ready; legacy manifest digest matches, Rust revision unknown` : `Ready; Rust patch v${patch.patchVersion}`,
      ...(patch.patchVersion === undefined ? {} : { patchVersion: patch.patchVersion }),
    };
  });
}

export function makeCoverageReport(rows: readonly CoverageRow[], floor: string, checkedAt = new Date().toISOString()): CoverageReport {
  return { checkedAt, floor, rows, gapCount: rows.filter((row) => row.status !== "ready").length };
}

async function fetchUpstreamPages(): Promise<unknown[]> {
  const headers: Record<string, string> = { accept: "application/vnd.github+json", "user-agent": "cxstatusline-coverage-audit" };
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;
  return fetchAllReleasePages(async (page) => {
    const response = await fetch(`https://api.github.com/repos/openai/codex/releases?per_page=100&page=${page}`, {
      headers, signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`upstream release listing page ${page} failed with HTTP ${response.status}`);
    return response.json();
  });
}

async function fetchOwnReleases(run: GhRunner, repo: string): Promise<CoverageRelease[]> {
  return fetchAllReleasePages(async (page) => ghJson<unknown>(run, ["api", `repos/${repo}/releases?per_page=100&page=${page}`])) as Promise<CoverageRelease[]>;
}

export async function runCoverageAudit(options: {
  readonly run?: GhRunner;
  readonly repo?: string;
  readonly patchesDirectory?: string;
  readonly upstream?: unknown;
  readonly releases?: readonly CoverageRelease[];
  readonly readManifest?: (version: string, release: CoverageRelease) => unknown;
} = {}): Promise<CoverageReport> {
  const run = options.run ?? execGh;
  const repo = options.repo ?? "adrijshikhar/cxstatusline";
  const manifest = loadManifest(options.patchesDirectory ?? defaultPatchesDir());
  const upstream = options.upstream ?? await fetchUpstreamPages();
  const versions = stableUpstreamVersions(upstream, manifest.patches.map((p) => p.min)
    .sort((a, b) => compareSemver(parseSemver(a)!, parseSemver(b)!))[0]!);
  const releases = options.releases ?? await fetchOwnReleases(run, repo);
  const metadata = new Map<string, unknown>();
  for (const version of versions) {
    const release = releases.find((r) => r.tag_name === `codex-v${version}` && r.draft !== true);
    if (!release || options.readManifest === undefined && !release.assets.some((a) => a.name === "manifest.json")) continue;
    if (options.readManifest) metadata.set(version, options.readManifest(version, release));
    else {
      const asset = release.assets.find((a) => a.name === "manifest.json");
      if (!asset?.id) continue;
      const raw = ghText(run, ["api", "-H", "Accept: application/octet-stream", `repos/${repo}/releases/assets/${asset.id}`]);
      try { metadata.set(version, JSON.parse(raw)); }
      catch { metadata.set(version, null); }
    }
  }
  const floor = manifest.patches.map((p) => p.min)
    .sort((a, b) => compareSemver(parseSemver(a)!, parseSemver(b)!))[0]!;
  return makeCoverageReport(classifyCoverage(manifest, versions, releases, metadata, options.patchesDirectory ?? defaultPatchesDir()), floor);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const jsonIndex = args.indexOf("--json");
  const jsonPath = jsonIndex < 0 ? null : args[jsonIndex + 1];
  const repoIndex = args.indexOf("--repo");
  const repo = repoIndex < 0 ? repoSlug({}) : repoSlug({ repo: args[repoIndex + 1] ?? "" });
  runCoverageAudit({ repo }).then((report) => {
    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (jsonPath) {
      mkdirSync(dirname(jsonPath), { recursive: true });
      writeFileSync(jsonPath, json);
    }
    console.log(json);
  }).catch((error) => {
    console.error(`coverage audit failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
