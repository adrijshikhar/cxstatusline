import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "../context";
import {
  releaseTag,
  validateManifest,
  type Artifact,
  type ArtifactFile,
  type ExpectedRelease,
  type FileDigest,
  type PreparedPair,
  type ReleaseManifest,
} from "../distribution";
import { activeGeneration, readInstallation } from "../patch/generation";
import { VERSION } from "../version-info";
import { extractArchive } from "./archive";
import { ARTIFACT_FILES } from "./files";
import { ARCHIVE_MAX_BYTES, MANIFEST_MAX_BYTES, downloadAsset, sanitize, type TransportOptions } from "./transport";

/** The release asset holding the manifest. The archive's name comes from the manifest itself. */
const MANIFEST_ASSET = "manifest.json";

/** The staged pair is the first freshly downloaded thing we execute; it does not get to hang. */
const PROBE_TIMEOUT_MS = 30_000;

/** Verified staged bytes, or the active generation when it already holds exactly this release. */
export type PrebuiltPreparation =
  | { kind: "staged"; pair: PreparedPair }
  | { kind: "unchanged"; pair: PreparedPair };

function digestOf(file: string): FileDigest {
  const bytes = readFileSync(file);
  return { sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
}

function sameDigest(a: FileDigest, b: FileDigest): boolean {
  return a.sha256 === b.sha256 && a.size === b.size;
}

/** A private directory on the same filesystem as the generations, so activation never copies across. */
function privateTemp(ctx: Context, prefix: string): string {
  mkdirSync(ctx.paths.libexecDir, { recursive: true });
  const dir = mkdtempSync(join(ctx.paths.libexecDir, prefix));
  chmodSync(dir, 0o700);
  return dir;
}

function artifactFor(manifest: ReleaseManifest, expected: ExpectedRelease): Artifact {
  const artifact = manifest.artifacts.find((a) => a.platform === expected.platform);
  // validateManifest already refuses a manifest without the expected platform; this keeps the
  // narrowing honest rather than asserting non-null.
  if (!artifact) throw new Error(`release manifest has no artifact for ${expected.platform}`);
  return artifact;
}

/**
 * Task 3's verified no-op, owned here: the installed pair only counts as unchanged when the record
 * describes *this* release and all five installed files still hash to the manifest's digests.
 * Anything less - a foreign pointer, a compiled pair, one tampered byte - means a full download.
 */
function unchangedPair(ctx: Context, manifest: ReleaseManifest, artifact: Artifact, tag: string): PreparedPair | null {
  const record = readInstallation(ctx.paths);
  if (record === null || record.provenance.source !== "prebuilt") return null;
  const release = record.provenance.release;
  if (!release || release.tag !== tag || release.archiveSha256 !== artifact.sha256) return null;

  const installed = release.manifest;
  const identical =
    record.codexVersion === manifest.codexVersion &&
    record.provenance.cxVersion === manifest.cxVersion &&
    record.provenance.platform === artifact.platform &&
    record.provenance.patchSha256 === manifest.patchSha256 &&
    record.provenance.upstreamCommit === manifest.upstreamCommit &&
    installed.cxVersion === manifest.cxVersion &&
    installed.codexVersion === manifest.codexVersion &&
    installed.patchSha256 === manifest.patchSha256 &&
    installed.upstreamCommit === manifest.upstreamCommit;
  if (!identical) return null;

  const directory = activeGeneration(ctx.paths);
  if (directory === null) return null;
  for (const name of ARTIFACT_FILES) {
    try {
      if (!sameDigest(digestOf(join(directory, name)), artifact.files[name])) return null;
    } catch {
      return null; // unreadable or missing: not the release we are being asked for
    }
  }
  return { directory, codexVersion: record.codexVersion, provenance: record.provenance };
}

/** Re-hash every extracted file against the manifest before anything may run it. */
function verifyStaged(staging: string, artifact: Artifact): Record<"codex" | "codex-code-mode-host", FileDigest> {
  const digests: Partial<Record<ArtifactFile, FileDigest>> = {};
  for (const name of ARTIFACT_FILES) {
    const got = digestOf(join(staging, name));
    if (!sameDigest(got, artifact.files[name])) {
      throw new Error(`staged ${name} does not match the release manifest sha256`);
    }
    digests[name] = got;
  }
  return {
    codex: digests.codex as FileDigest,
    "codex-code-mode-host": digests["codex-code-mode-host"] as FileDigest,
  };
}

/** The last gate: the staged binary must introduce itself as exactly the version we asked for. */
function probeVersion(ctx: Context, staging: string, codexVersion: string): void {
  const probe = ctx.run(join(staging, "codex"), ["--version"], { timeoutMs: PROBE_TIMEOUT_MS });
  const reported = sanitize((probe.stdout || probe.stderr).slice(0, 512));
  if (probe.status !== 0 || reported !== `codex-cli ${codexVersion}`) {
    throw new Error(`staged codex reported version "${reported}" instead of "codex-cli ${codexVersion}"`);
  }
}

function stagedPair(
  ctx: Context,
  staging: string,
  manifest: ReleaseManifest,
  artifact: Artifact,
  tag: string,
): PreparedPair {
  const executables = verifyStaged(staging, artifact);
  probeVersion(ctx, staging, manifest.codexVersion);
  return {
    directory: staging,
    codexVersion: manifest.codexVersion,
    provenance: {
      source: "prebuilt",
      cxVersion: manifest.cxVersion ?? VERSION,
      platform: artifact.platform,
      patchSha256: manifest.patchSha256,
      upstreamCommit: manifest.upstreamCommit,
      sourceCommit: manifest.sourceCommit,
      sourceDirty: false,
      installedAt: ctx.now().toISOString(),
      executables,
      release: { tag, archiveSha256: artifact.sha256, manifest },
    },
  };
}

async function stageArchive(
  ctx: Context,
  download: string,
  manifest: ReleaseManifest,
  artifact: Artifact,
  tag: string,
  opts: TransportOptions,
): Promise<PreparedPair> {
  const archive = join(download, artifact.filename);
  opts.onStatus?.("download", `Downloading prebuilt archive (${artifact.filename})...`);
  const got = await downloadAsset(ctx, tag, artifact.filename, archive, ARCHIVE_MAX_BYTES, opts);
  if (got.sha256 !== artifact.sha256 || got.size !== artifact.size) {
    throw new Error(`${artifact.filename} does not match the release manifest sha256`);
  }
  opts.onStatus?.("download-done", `Downloaded ${artifact.filename}`);
  const staging = privateTemp(ctx, "staging-");
  try {
    opts.onStatus?.("extract", "Extracting and verifying executables...");
    await extractArchive(archive, staging);
    const pair = stagedPair(ctx, staging, manifest, artifact, tag);
    opts.onStatus?.("extract-done", "Verified executables (codex, codex-code-mode-host)");
    return pair;
  } catch (e) {
    rmSync(staging, { recursive: true, force: true });
    throw e;
  }
}

/**
 * Download, verify and stage the prebuilt pair for `expected`, or report that the active generation
 * already is that pair. Nothing outside the temporary directories is written: generations, the
 * `current` pointer, the wrapper, state and hooks are all untouched, and every failure path removes
 * the directories it created. The caller owns removing a successful **staged** directory; an
 * **unchanged** pair's directory is the live generation and must never be removed.
 */
export async function preparePrebuilt(
  ctx: Context,
  expected: ExpectedRelease,
  opts: TransportOptions = {},
): Promise<PrebuiltPreparation> {
  const tag = releaseTag(expected.codexVersion);
  opts.onStatus?.("manifest", `Checking release ${tag} for ${expected.platform}...`);
  const download = privateTemp(ctx, "download-");
  try {
    const manifestFile = join(download, MANIFEST_ASSET);
    await downloadAsset(ctx, tag, MANIFEST_ASSET, manifestFile, MANIFEST_MAX_BYTES, opts);
    const manifest = validateManifest(JSON.parse(readFileSync(manifestFile, "utf8")), expected);
    const artifact = artifactFor(manifest, expected);
    opts.onStatus?.("manifest-done", `Found release for Codex ${manifest.codexVersion} (${artifact.platform})`);

    const unchanged = unchangedPair(ctx, manifest, artifact, tag);
    if (unchanged !== null) return { kind: "unchanged", pair: unchanged };

    return { kind: "staged", pair: await stageArchive(ctx, download, manifest, artifact, tag, opts) };
  } finally {
    rmSync(download, { recursive: true, force: true });
  }
}
