import { z } from "zod";
import type { FileDigest } from "./digest";
import { ARTIFACT_FILES, type ArtifactFile } from "./distribution/files";
import { parseSemver } from "./version";

// ---- Shared types (plan-defined; used verbatim by later tasks) ----

export type Platform = "darwin-arm64" | "darwin-x64" | "linux-x64" | "linux-arm64";

export type { ArtifactFile };
export type { FileDigest } from "./digest";

/** One archive member: its digest. Modes are a function of the path (`modeFor`), never stored. */
export type ArchiveEntry = FileDigest;

export interface Artifact {
  platform: Platform;
  filename: string;
  sha256: string;
  size: number;
  /**
   * Schema 3: every member path, relative to the package root (`bin/codex`, `codex-path/rg`, ...).
   * Schema 1/2: exactly the five flat basenames.
   */
  files: Record<ArtifactFile, ArchiveEntry> & Record<string, ArchiveEntry>;
}

export interface ReleaseManifest {
  schema: 1 | 2 | 3;
  patchVersion?: number;
  cxVersion?: string;
  codexVersion: string;
  upstreamTag: string;
  upstreamCommit: string;
  patchFile: string;
  patchSha256: string;
  sourceCommit: string;
  workflowUrl: string;
  createdAt: string;
  artifacts: Artifact[];
}

export interface ExpectedRelease {
  codexVersion: string;
  platform: Platform;
  cxVersion?: string;
}

export interface PreparedPair {
  directory: string;
  codexVersion: string;
  provenance: {
    source: "prebuilt" | "compiled";
    cxVersion: string;
    platform: string;
    patchVersion?: number;
    patchSha256: string;
    upstreamCommit: string;
    sourceCommit: string | null;
    sourceDirty: boolean;
    installedAt: string;
    /** The Rust triple `codex-package.json` records; what upstream's daemon compares against its own. */
    target: string;
    /** Every file of the package, relative path -> digest: what a generation *is*. */
    files: Record<string, FileDigest>;
    /** Written by cxstatusline <= 0.10.x records only; superseded by `files`. */
    executables?: Record<"codex" | "codex-code-mode-host", FileDigest>;
    release?: { tag: string; archiveSha256: string; manifest: ReleaseManifest };
  };
}

// ---- Constants ----

export const PLATFORMS: readonly Platform[] = [
  "darwin-arm64",
  "darwin-x64",
  "linux-x64",
  "linux-arm64",
];

/** Platforms every new scheduled prebuilt release must publish. */
export const DEFAULT_PREBUILT_PLATFORMS: readonly Platform[] = ["darwin-arm64", "linux-arm64"];

/** Spec archive name: `cxstatusline-codex-<codexVersion>-<platform>.tar.gz`. */
const ARCHIVE_PREFIX = "cxstatusline-codex";

// ---- Package layout (schema 3) ----

/**
 * The Rust target triple upstream's daemon compares `codex-package.json.target` against
 * (`codex-rs/app-server-daemon/src/prepare_install.rs`, `platform_target()`). Linux is gnu because
 * `scripts/build-prebuilt-docker.sh` builds gnu targets; upstream's own Linux default is musl.
 */
export function codexTarget(platform: Platform): string {
  switch (platform) {
    case "darwin-arm64": return "aarch64-apple-darwin";
    case "darwin-x64": return "x86_64-apple-darwin";
    case "linux-x64": return "x86_64-unknown-linux-gnu";
    case "linux-arm64": return "aarch64-unknown-linux-gnu";
  }
}

/** Nested member paths a package archive may carry: exactly the three upstream directories. */
export const PACKAGE_PATH = /^(bin|codex-path|codex-resources)(\/[A-Za-z0-9][A-Za-z0-9._+-]*){1,4}$/;
/** Root members a package archive may carry. */
export const PACKAGE_ROOT_FILES: readonly string[] = ["codex-package.json", "LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md"];
/** 8 keys on macOS and 9 on Linux today; the cap only bounds a hostile manifest. */
export const PACKAGE_MAX_FILES = 64;

/** Members every package archive must carry for `platform` (upstream's `validate_package` plus our legal texts). */
export function packageRequiredFiles(platform: Platform): readonly string[] {
  const base = ["codex-package.json", "bin/codex", "bin/codex-code-mode-host", "codex-path/rg", "LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md"];
  return platform.startsWith("linux-") ? [...base, "codex-resources/bwrap"] : base;
}

/**
 * The only mode rule anywhere: executables live under the three package directories (upstream sets
 * +x on every file it puts there); everything at the root is text. The two flat basenames are the
 * pre-package layout's executables.
 */
export function modeFor(path: string): 0o755 | 0o644 {
  if (/^(bin|codex-path|codex-resources)\//.test(path)) return 0o755;
  if (path === "codex" || path === "codex-code-mode-host") return 0o755;
  return 0o644;
}

const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const WORKFLOW_URL = /^https:\/\/github\.com\/adrijshikhar\/cxstatusline\/actions\/runs\/(\d+|local-docker)$/;

// ---- Version helpers ----

function isStableVersion(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const parsed = parseSemver(s);
  return parsed !== null && parsed.pre === null;
}

// ---- Public exact-selection helpers ----

export function releaseTag(codexVersion: string): string {
  if (!isStableVersion(codexVersion)) throw new Error("releaseTag: codexVersion must be a stable three-part semver");
  return `codex-v${codexVersion}`;
}

/**
 * Platform selection follows Node's own `process.arch`, not the physical CPU: an x64 Node running
 * under Rosetta on Apple Silicon reports `x64` and therefore selects the Intel asset. That is
 * deliberate - the pair has to match the runtime that will execute it.
 */
export function platformFor(os: string, arch: string): Platform {
  if (os === "darwin" && arch === "arm64") return "darwin-arm64";
  if (os === "darwin" && arch === "x64") return "darwin-x64";
  if (os === "linux" && arch === "x64") return "linux-x64";
  if (os === "linux" && arch === "arm64") return "linux-arm64";
  throw new Error(`platformFor: unsupported platform os=${os} arch=${arch}`);
}

// ---- Manifest schema (structural) ----

const safePositiveInt = (n: number): boolean => Number.isSafeInteger(n) && n > 0;

const FileDigestSchema = z
  .object({
    sha256: z.string().regex(HEX64, "sha256 must be 64 lowercase hex chars"),
    size: z.number().refine(safePositiveInt, "size must be a finite positive safe integer"),
  })
  .strict();

const FilesSchema = z.record(z.string(), FileDigestSchema);

const ArtifactSchema = z
  .object({
    platform: z.enum(["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64"]),
    filename: z.string(),
    sha256: z.string().regex(HEX64, "sha256 must be 64 lowercase hex chars"),
    size: z.number().refine(safePositiveInt, "size must be a finite positive safe integer"),
    files: FilesSchema,
  })
  .strict();

const ManifestShapeSchema = z
  .object({
    schema: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    patchVersion: z.number().refine(safePositiveInt).optional(),
    cxVersion: z.string().optional(),
    codexVersion: z.string(),
    upstreamTag: z.string(),
    upstreamCommit: z.string().regex(HEX40, "upstreamCommit must be 40 lowercase hex chars"),
    patchFile: z.string(),
    patchSha256: z.string().regex(HEX64, "patchSha256 must be 64 lowercase hex chars"),
    sourceCommit: z.string().regex(HEX40, "sourceCommit must be 40 lowercase hex chars"),
    workflowUrl: z.string().regex(WORKFLOW_URL, "workflowUrl must be a github actions run URL"),
    createdAt: z.string().regex(ISO_8601, "createdAt must be an ISO 8601 timestamp"),
    artifacts: z.array(ArtifactSchema).min(1).max(4),
  })
  .strict();

type ManifestShape = z.infer<typeof ManifestShapeSchema>;

// ---- Cross-field business rules ----
// Zod validates structure; these rules require `expected` and cross-field agreement
// (release identity), which is not expressible as static per-field schema alone.

/** Schema 1/2: exactly the five flat basenames. */
function checkFlatFiles(files: Record<string, unknown>): string | null {
  const keys = Object.keys(files);
  for (const name of ARTIFACT_FILES) if (!(name in files)) return `files is missing ${name}`;
  for (const key of keys) if (!(ARTIFACT_FILES as readonly string[]).includes(key)) return `files has unexpected member ${key}`;
  return null;
}

/**
 * Schema 3: every key is a package path, the required set for the artifact's own platform is
 * present, and no two keys can collide on disk (one a directory prefix of another, or two names
 * that differ only by case on a case-insensitive filesystem).
 */
function checkPackageFiles(platform: Platform, files: Record<string, unknown>): string | null {
  const keys = Object.keys(files);
  if (keys.length > PACKAGE_MAX_FILES) return `files lists more than ${PACKAGE_MAX_FILES} members`;
  for (const key of keys) {
    if (!PACKAGE_PATH.test(key) && !PACKAGE_ROOT_FILES.includes(key)) return `files has unexpected member ${key}`;
  }
  for (const name of packageRequiredFiles(platform)) if (!(name in files)) return `files is missing ${name}`;
  const lower = new Set<string>();
  for (const key of keys) {
    const folded = key.toLowerCase();
    if (lower.has(folded)) return `files has members that differ only by case: ${key}`;
    lower.add(folded);
    for (const other of keys) if (other !== key && other.startsWith(`${key}/`)) return `files member ${key} is also a directory of ${other}`;
  }
  return null;
}

function checkArtifacts(m: ManifestShape, expected: ExpectedRelease): string | null {
  const seen = new Set<Platform>();
  for (const artifact of m.artifacts) {
    if (seen.has(artifact.platform)) return "duplicate platform in artifacts";
    seen.add(artifact.platform);
    const files = m.schema === 3 ? checkPackageFiles(artifact.platform, artifact.files) : checkFlatFiles(artifact.files);
    if (files) return files;

    if (artifact.filename.includes("/") || artifact.filename.includes("\\") || artifact.filename.includes("..")) {
      return "artifact filename contains illegal path characters";
    }
    const expectedFilename = `${ARCHIVE_PREFIX}-${m.codexVersion}-${artifact.platform}.tar.gz`;
    if (artifact.filename !== expectedFilename) return "artifact filename does not match expected pattern";
  }
  if (!seen.has(expected.platform)) return "no artifact for expected platform";
  return null;
}

function checkBusinessRules(m: ManifestShape, expected: ExpectedRelease): string | null {
  if (m.schema >= 2 && m.patchVersion === undefined) return `patchVersion is required for schema ${m.schema}`;
  if (m.schema === 1 && m.patchVersion !== undefined) return "patchVersion requires schema 2 or later";
  if (m.cxVersion !== undefined && !isStableVersion(m.cxVersion)) {
    return "cxVersion is not a valid semver";
  }
  if (!isStableVersion(m.codexVersion) || m.codexVersion !== expected.codexVersion) {
    return "codexVersion does not match expected release";
  }
  if (m.upstreamTag !== `rust-v${m.codexVersion}`) return "upstreamTag does not match codexVersion";
  if (m.schema >= 2 && !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.patch$/.test(m.patchFile)) return "patchFile must be a patch basename";
  if (m.schema === 1 && m.patchFile !== `codex-${m.codexVersion}.patch`) return "patchFile does not match codexVersion";
  if (Number.isNaN(Date.parse(m.createdAt))) return "createdAt is not a valid timestamp";
  return checkArtifacts(m, expected);
}

// ---- Public validator ----

export function validateManifest(raw: unknown, expected: ExpectedRelease): ReleaseManifest {
  if (!isStableVersion(expected.codexVersion)) {
    throw new Error("validateManifest: expected release versions must be stable three-part semver");
  }
  if (expected.cxVersion !== undefined && !isStableVersion(expected.cxVersion)) {
    throw new Error("validateManifest: expected release versions must be stable three-part semver");
  }
  if (!PLATFORMS.includes(expected.platform)) {
    throw new Error("validateManifest: expected release platform is not supported");
  }

  // Decided before the strict parse, so the message names the fix instead of a zod path.
  const rawSchema = typeof raw === "object" && raw !== null ? (raw as { schema?: unknown }).schema : undefined;
  if (typeof rawSchema === "number" && rawSchema > 3) {
    throw new Error(`this release needs a newer cxstatusline (manifest schema ${rawSchema}); run npm i -g cxstatusline`);
  }

  const structural = ManifestShapeSchema.safeParse(raw);
  if (!structural.success) {
    const issue = structural.error.issues[0];
    const path = issue && issue.path.length > 0 ? issue.path.join(".") : "manifest";
    throw new Error(`invalid release manifest: ${path}: ${issue?.message ?? "malformed"}`);
  }

  const error = checkBusinessRules(structural.data, expected);
  if (error) throw new Error(`invalid release manifest: ${error}`);

  return structural.data as ReleaseManifest;
}

// ---- Prebuilt preparation (transport + archive live in ./distribution/*) ----

export { preparePrebuilt, type PrebuiltPreparation } from "./distribution/prebuilt";
