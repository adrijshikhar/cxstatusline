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
export { execGh, ghJson, ghText, GhError, type GhResult, type GhRunner } from "./gh";
export { buildManifest, workflowUrlFromEnv, type ManifestInput } from "./manifest";
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
export { publishRelease, type PublishOptions, type PublishOutcome } from "./publish";
export { errorExcerpt, redact } from "./redact";
export {
  BlockedError,
  checkExistingRelease,
  compareIdentity,
  downloadAsset,
  immutabilityMessage,
  inspectRelease,
  planUploads,
  verifyReleaseDir,
  type ExpectedIdentity,
  type ReleaseAsset,
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
export { validateMinos, verifyOutput } from "./verify";
