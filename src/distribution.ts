import { z } from "zod";
import { ARTIFACT_FILES, type ArtifactFile } from "./distribution/files";
import { parseSemver } from "./version";

// ---- Shared types (plan-defined; used verbatim by later tasks) ----

export type Platform = "darwin-arm64" | "darwin-x64" | "linux-x64" | "linux-arm64";

export type { ArtifactFile };

export interface FileDigest {
  sha256: string;
  size: number;
}

export interface Artifact {
  platform: Platform;
  filename: string;
  sha256: string;
  size: number;
  files: Record<ArtifactFile, FileDigest>;
}

export interface ReleaseManifest {
  schema: 1 | 2;
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
    executables: Record<"codex" | "codex-code-mode-host", FileDigest>;
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

/** Spec archive name: `cxstatusline-codex-<codexVersion>-<platform>.tar.gz`. */
const ARCHIVE_PREFIX = "cxstatusline-codex";

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

const filesShape = Object.fromEntries(ARTIFACT_FILES.map((k) => [k, FileDigestSchema])) as Record<
  ArtifactFile,
  typeof FileDigestSchema
>;
const FilesSchema = z.object(filesShape).strict();

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
    schema: z.union([z.literal(1), z.literal(2)]),
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

function checkArtifacts(m: ManifestShape, expected: ExpectedRelease): string | null {
  const seen = new Set<Platform>();
  for (const artifact of m.artifacts) {
    if (seen.has(artifact.platform)) return "duplicate platform in artifacts";
    seen.add(artifact.platform);

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
  if (m.schema === 2 && m.patchVersion === undefined) return "patchVersion is required for schema 2";
  if (m.schema === 1 && m.patchVersion !== undefined) return "patchVersion requires schema 2";
  if (m.cxVersion !== undefined && !isStableVersion(m.cxVersion)) {
    return "cxVersion is not a valid semver";
  }
  if (!isStableVersion(m.codexVersion) || m.codexVersion !== expected.codexVersion) {
    return "codexVersion does not match expected release";
  }
  if (m.upstreamTag !== `rust-v${m.codexVersion}`) return "upstreamTag does not match codexVersion";
  if (m.schema === 2 && !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.patch$/.test(m.patchFile)) return "patchFile must be a patch basename";
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
