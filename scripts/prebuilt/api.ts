/**
 * The tested surface of the prebuilt pipeline, in one place.
 *
 * `scripts/prebuilt.ts` re-exports this barrel so the tests have a single import path while the
 * CLI file itself stays small enough to read.
 */
export {
  blockedIssueTitle,
  resolveDetection,
  selectStableVersion,
  UncoveredUpstreamError,
  UNCOVERED_EXIT_CODE,
  type Detection,
} from "./detect";
export { buildMatrix, unionReleasePlatforms, type MatrixEntry } from "./cli-detect";
export { execGh, ghJson, ghText, GhError, type GhResult, type GhRunner } from "./gh";
export { buildManifest, workflowUrlFromEnv, type ManifestInput } from "./manifest";
export { mergeManifests } from "./merge";
export {
  parseProvenance,
  provenanceMarker,
  releaseNotes,
  releaseTitle,
  type BuildIdentity,
  type NotesInput,
  type Provenance,
} from "./notes";
export {
  ARCHIVE_ENTRIES,
  ARCHIVE_MTIME,
  archiveFilename,
  assembleStaging,
  fileDigests,
  packArchive,
  parseChecksums,
  sha256File,
  writeChecksums,
} from "./pack";
export { publishRelease, restoreReleaseBackup, type PublishOptions, type PublishOutcome } from "./publish";
export { errorExcerpt, redact } from "./redact";
export {
  BlockedError,
  backupPublishedRelease,
  checkExistingRelease,
  compareIdentity,
  downloadAsset,
  immutabilityMessage,
  inspectRelease,
  planUploads,
  verifyReleaseDir,
  verifyReleaseBackup,
  type ExpectedIdentity,
  type ReleaseAsset,
  type ReleaseBackup,
  type ReleaseState,
  type ReleaseView,
  type VerifiedSet,
} from "./release";
export {
  excerptFromFile,
  failingStage,
  reportBody,
  REPORT_MARKER,
  runReport,
  stageLogExcerpt,
  type JobResults,
  type ReportInput,
  type RunReportOptions,
  type Stage,
  type StageContext,
} from "./report";
export {
  listSourceReleases,
  resolveTagCommit,
  selectSourceRelease,
  type SourceRelease,
} from "./source";
export { commitPatches, workingTreePatches, type PatchTree } from "./patch-tree";
export { validateMinos, verifyOutput } from "./verify";
