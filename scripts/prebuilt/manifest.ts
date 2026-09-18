/**
 * Release manifest generation. The schema lives in `src/distribution.ts` and is validated by the
 * installer's own `validateManifest`; this module only assembles the values, so there is never a
 * second copy of the schema to drift.
 */
import type { ArtifactFile, FileDigest, Platform, ReleaseManifest } from "../../src/distribution";
import { archiveFilename } from "./pack";

export interface ManifestInput {
  readonly cxVersion?: string;
  readonly codexVersion: string;
  readonly platform: Platform;
  /** `git rev-parse HEAD` of the patched upstream checkout. */
  readonly upstreamCommit: string;
  readonly patchSha256: string;
  /** The frozen commit the build was checked out at - never `GITHUB_SHA`. See `sourceCommit`. */
  readonly sourceCommit: string;
  readonly workflowUrl: string;
  readonly createdAt: string;
  readonly archive: FileDigest;
  readonly files: Record<ArtifactFile, FileDigest>;
}

/**
 * Build the manifest for a single-platform release. `upstreamTag`, `patchFile` and the archive
 * filename are derived, never passed in: the installer's validator requires them to agree with
 * `codexVersion`, and deriving them is the only way that cannot be got wrong.
 */
export function buildManifest(input: ManifestInput): ReleaseManifest {
  return {
    schema: 1,
    cxVersion: input.cxVersion,
    codexVersion: input.codexVersion,
    upstreamTag: `rust-v${input.codexVersion}`,
    upstreamCommit: input.upstreamCommit,
    patchFile: `codex-${input.codexVersion}.patch`,
    patchSha256: input.patchSha256,
    sourceCommit: input.sourceCommit,
    workflowUrl: input.workflowUrl,
    createdAt: input.createdAt,
    artifacts: [
      {
        platform: input.platform,
        filename: archiveFilename(input.codexVersion, input.platform),
        sha256: input.archive.sha256,
        size: input.archive.size,
        files: input.files,
      },
    ],
  };
}

/** The run URL recorded in the manifest, from the ambient workflow environment. */
export function workflowUrlFromEnv(env: NodeJS.ProcessEnv): string | null {
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = env;
  if (!GITHUB_SERVER_URL || !GITHUB_REPOSITORY || !GITHUB_RUN_ID) return null;
  return `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`;
}
