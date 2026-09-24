/**
 * Atomic release publication.
 *
 * A replacement is a complete verified release generation. Published assets are backed up before
 * mutation, and failed publication attempts restore that verified set.
 *
 * Release *classification* lives in `release.ts`; this module is the part that writes.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ExpectedRelease, type Platform, type ReleaseManifest } from "../../src/distribution";
import { blockedIssueTitle } from "./detect";
import { ghText, type GhRunner } from "./gh";
import { parseProvenance, releaseNotes, releaseTitle, type BuildIdentity } from "./notes";
import { parseChecksums, sha256File } from "./pack";
import {
  BlockedError,
  checkExistingRelease,
  downloadAsset,
  immutabilityMessage,
  inspectRelease,
  planUploads,
  verifyReleaseBackup,
  verifyReleaseDir,
  type ExpectedIdentity,
  type ReleaseBackup,
  type VerifiedSet,
} from "./release";

export interface PublishOptions {
  readonly run: GhRunner;
  readonly tag: string;
  /** The downloaded `release-<tag>` workflow artifact directory. */
  readonly dir: string;
  readonly runId: string;
  readonly runUrl: string;
  readonly sourceCommit: string;
  readonly codexVersion: string;
  readonly cxVersion?: string;
  readonly platform?: Platform;
  readonly platforms?: readonly Platform[];
  readonly event: string;
  readonly tmpRoot: string;
  readonly backupDir?: string;
  readonly repo?: string;
  readonly summary: (lines: readonly string[]) => void;
}

export interface PublishOutcome {
  readonly kind: "published" | "skipped-identical";
  readonly url: string;
}

function immutabilityBlock(tag: string, codexVersion: string, detail: string): BlockedError {
  return new BlockedError(blockedIssueTitle(codexVersion), immutabilityMessage(tag, detail));
}

function draftBlock(tag: string, codexVersion: string, recorded: string): BlockedError {
  return new BlockedError(
    blockedIssueTitle(codexVersion),
    `An unpublished draft release ${tag} already exists, but it records ${recorded}, which is not this build's `
      + `manifest. That is a conflicting build set, not a transient upload failure, so this run will not touch it. `
      + `Restart options (owner action, both manual and deliberate): delete the unpublished draft ${tag} in the `
      + `GitHub Releases UI and re-run this workflow, or bump the cxstatusline version to publish under a new tag. `
      + `Nothing was deleted, uploaded or overwritten by this run.`,
  );
}

function buildIdentity(o: PublishOptions): BuildIdentity {
  return o.event === "schedule"
    ? { kind: "schedule", cxVersion: o.cxVersion }
    : { kind: "dispatch", sha: o.sourceCommit };
}

function repository(o: PublishOptions): string {
  return o.repo ?? process.env.GITHUB_REPOSITORY ?? "adrijshikhar/cxstatusline";
}

function createDraft(o: PublishOptions, set: VerifiedSet): string {
  const m = set.manifest;
  const platforms = o.platforms ?? (o.platform ? [o.platform] : ["darwin-arm64"]);
  const notes = releaseNotes({
    cxVersion: o.cxVersion,
    codexVersion: o.codexVersion,
    platforms,
    sourceCommit: m.sourceCommit,
    upstreamTag: m.upstreamTag,
    upstreamCommit: m.upstreamCommit,
    patchFile: m.patchFile,
    patchVersion: m.patchVersion,
    patchSha256: m.patchSha256,
    runId: o.runId,
    runUrl: o.runUrl,
    manifestSha256: set.manifestSha256,
    identity: buildIdentity(o),
  });
  mkdirSync(o.tmpRoot, { recursive: true });
  const notesFile = join(o.tmpRoot, "release-notes.md");
  writeFileSync(notesFile, notes);
  const title = releaseTitle({ cxVersion: o.cxVersion, codexVersion: o.codexVersion, platforms });
  // --draft: nothing is visible as a release until every asset has been downloaded back and
  // re-verified before it becomes visible.
  const url = ghText(o.run, [
    "release",
    "create",
    o.tag,
    "--draft",
    "--target",
    m.sourceCommit,
    "--title",
    title,
    "--notes-file",
    notesFile,
    "--repo",
    repository(o),
  ]).trim();
  if (!url) throw new Error(`gh release create ${o.tag} succeeded without a release URL`);
  return url;
}

async function restorePublishedBackup(o: PublishOptions, backup: ReleaseBackup): Promise<void> {
  if (backup.state !== "published" || !backup.view) throw new Error("no published release backup is available for restoration");
  const backupAssets = join(o.backupDir!, "assets");
  const manifest = JSON.parse(readFileSync(join(backupAssets, "manifest.json"), "utf8")) as ReleaseManifest;
  const platforms = manifest.artifacts.map((artifact) => artifact.platform);
  const verified = await verifyReleaseDir(backupAssets, { codexVersion: o.codexVersion, platforms });
  const current = inspectRelease(o.run, o.tag);
  if (current.state !== "absent") ghText(o.run, ["release", "delete", o.tag, "--yes", "--repo", repository(o)]);
  const notesFile = join(o.tmpRoot, "restore-release-notes.md");
  writeFileSync(notesFile, backup.view.body);
  ghText(o.run, [
    "release", "create", o.tag, "--draft", "--target", manifest.sourceCommit,
    "--title", backup.view.title ?? `[Prebuilt] Codex ${o.codexVersion}`,
    "--notes-file", notesFile,
    "--repo", repository(o),
  ]);
  const names = [
    ...manifest.artifacts.map((artifact) => artifact.filename),
    "SHA256SUMS",
    "manifest.json",
  ];
  for (const name of names) ghText(o.run, ["release", "upload", o.tag, join(backupAssets, name), "--clobber", "--repo", repository(o)]);
  const checkDir = join(o.tmpRoot, "restored-release-check");
  for (const name of names) downloadAsset(o.run, o.tag, name, checkDir, repository(o));
  const checked = await verifyReleaseDir(checkDir, { codexVersion: o.codexVersion, platforms });
  if (checked.manifestSha256 !== verified.manifestSha256) throw new Error("restored release manifest did not verify");
  const publishArgs = ["release", "edit", o.tag, "--draft=false", "--repo", repository(o)];
  if (backup.view.isPrerelease) publishArgs.push("--prerelease");
  ghText(o.run, publishArgs);
}

export async function restoreReleaseBackup(o: PublishOptions): Promise<void> {
  if (!o.backupDir) throw new Error("--backup-dir is required for release restoration");
  const backup = JSON.parse(readFileSync(join(o.backupDir, "backup.json"), "utf8")) as ReleaseBackup;
  if (backup.schema !== 1 || backup.tag !== o.tag || backup.state !== "published") {
    throw new Error("backup does not contain a published release matching the requested tag");
  }
  const manifest = JSON.parse(readFileSync(join(o.backupDir, "assets", "manifest.json"), "utf8")) as ReleaseManifest;
  const verified = await verifyReleaseDir(join(o.backupDir, "assets"), {
    codexVersion: o.codexVersion,
    platforms: manifest.artifacts.map((artifact) => artifact.platform),
  });
  if (verified.manifestSha256 !== backup.manifestSha256) throw new Error("backup manifest digest does not match backup metadata");
  await restorePublishedBackup(o, backup);
  o.summary([`## Restored ${o.tag}`, "", `Previous complete release set restored and verified from ${o.backupDir}.`]);
}

async function replacePublished(o: PublishOptions, set: VerifiedSet, backup: ReleaseBackup): Promise<PublishOutcome> {
  if (backup.state !== "published" || !o.backupDir) throw new Error("a complete published-release backup is required before replacement");
  try {
    ghText(o.run, ["release", "delete", o.tag, "--yes", "--repo", repository(o)]);
    const url = createDraft(o, set);
    const order = [...set.assets].sort((a, b) =>
      (a.name === "manifest.json" ? 2 : a.name === "SHA256SUMS" ? 1 : 0)
      - (b.name === "manifest.json" ? 2 : b.name === "SHA256SUMS" ? 1 : 0));
    for (const asset of order) ghText(o.run, ["release", "upload", o.tag, join(o.dir, asset.name), "--repo", repository(o)]);
    await reverifyUploaded(o, set);
    ghText(o.run, ["release", "edit", o.tag, "--draft=false", "--latest=false", "--prerelease", "--repo", repository(o)]);
    o.summary([
      `## Prebuilt ${o.tag}`, "", `Replaced and verified: ${url}`, "",
      "The release was temporarily unavailable while its complete asset set was replaced.",
      `Verified backup: ${o.backupDir}`,
    ]);
    return { kind: "published", url };
  } catch (error) {
    try {
      await restorePublishedBackup(o, backup);
    } catch (restoreError) {
      throw new Error(
        `replacement failed (${error instanceof Error ? error.message : String(error)}); `
        + `automatic restoration also failed (${restoreError instanceof Error ? restoreError.message : String(restoreError)}). `
        + `Keep workflow backup artifact and restore from ${o.backupDir}.`,
      );
    }
    throw new Error(`replacement failed; the verified previous release was restored: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Download every uploaded asset back and prove the bytes GitHub holds are the bytes we built. */
async function reverifyUploaded(o: PublishOptions, set: VerifiedSet): Promise<void> {
  const dir = join(o.tmpRoot, "recheck");
  const sums = parseChecksums(readFileSync(join(o.dir, "SHA256SUMS"), "utf8"));
  const expected: Record<string, string> = {
    ...sums,
    "SHA256SUMS": (await sha256File(join(o.dir, "SHA256SUMS"))).sha256,
  };
  for (const asset of set.assets) {
    const file = downloadAsset(o.run, o.tag, asset.name, dir, repository(o));
    const actual = await sha256File(file);
    if (actual.sha256 !== expected[asset.name]) {
      throw new Error(
        `post-upload re-verification failed: downloaded ${asset.name} does not match the manifest and SHA256SUMS `
          + `(${actual.sha256} vs ${expected[asset.name]}); the release was left as a draft and not published`,
      );
    }
  }
}

/**
 * Publish `release-<tag>` at release level: verify, create-or-resume a draft, upload only the
 * missing assets, download all three back and re-verify, then flip the draft to published.
 *
 * Returns `skipped-identical` (success, nothing changed) when the release is already published
 * from the same inputs. Raises `BlockedError` for anything only the owner can resolve, and a plain
 * error - leaving the draft untouched and unpublished - for a verification failure.
 */
export async function publishRelease(o: PublishOptions): Promise<PublishOutcome> {
  const platforms = o.platforms ?? (o.platform ? [o.platform] : ["darwin-arm64"]);
  const release = { cxVersion: o.cxVersion, codexVersion: o.codexVersion, platforms };
  const set = await verifyReleaseDir(o.dir, release);
  if (set.manifest.sourceCommit !== o.sourceCommit) {
    throw new Error(
      `the downloaded artifact was built from ${set.manifest.sourceCommit} but this run resolved `
        + `${o.sourceCommit}; refusing to publish a mismatched build set`,
    );
  }
  const expected: ExpectedIdentity = { sourceCommit: o.sourceCommit, patchSha256: set.manifest.patchSha256, patchVersion: set.manifest.patchVersion };
  const assetNames = set.assets.map((a) => a.name);
  const verdict = await checkExistingRelease({
    run: o.run,
    tag: o.tag,
    expected,
    release,
    assetNames,
    tmpRoot: o.tmpRoot,
    repo: repository(o),
  });

  if (verdict.state === "published") {
    if (verdict.identical) {
      o.summary([`## Prebuilt ${o.tag}`, "", `Already published, identical: ${verdict.view.url}`, "", "Nothing to do."]);
      return { kind: "skipped-identical", url: verdict.view.url };
    }
    if (!o.backupDir) throw immutabilityBlock(o.tag, o.codexVersion, verdict.detail);
    const backup = await verifyReleaseBackup(o.run, o.tag, o.backupDir);
    return await replacePublished(o, set, backup);
  }
  if (verdict.state === "published-partial") {
    const previousFile = downloadAsset(o.run, o.tag, "manifest.json", join(o.tmpRoot, "published-platforms"), repository(o));
    const previous = JSON.parse(readFileSync(previousFile, "utf8")) as ReleaseManifest;
    const built = new Set(set.manifest.artifacts.map((artifact) => artifact.platform));
    const omitted = previous.artifacts.map((artifact) => artifact.platform).filter((platform) => !built.has(platform));
    if (omitted.length > 0) {
      throw new BlockedError(
        blockedIssueTitle(o.codexVersion),
        `replacement build omits already-published platform(s) ${omitted.join(", ")}; include the complete existing platform set before publication`,
      );
    }
    if (!o.backupDir) throw immutabilityBlock(o.tag, o.codexVersion, "complete replacement backup is required");
    return await replacePublished(o, set, await verifyReleaseBackup(o.run, o.tag, o.backupDir, repository(o)));
  }

  let url = verdict.view.url;
  if (verdict.state === "absent") {
    url = createDraft(o, set) || url;
  } else if (verdict.state === "draft") {
    const provenance = parseProvenance(verdict.view.body);
    if (provenance === null || provenance.manifestSha256 !== set.manifestSha256) {
      throw draftBlock(
        o.tag,
        o.codexVersion,
        provenance === null ? "no build provenance" : `manifest_sha=${provenance.manifestSha256}`,
      );
    }
  }

  const existing = verdict.state === "absent" ? [] : verdict.view.assets;
  const plan = planUploads(existing, set.assets);
  for (const name of plan.upload) {
    const isOverwriting = existing.some((a) => a.name === name);
    const args = ["release", "upload", o.tag, join(o.dir, name), "--repo", repository(o)];
    if (isOverwriting) args.push("--clobber");
    ghText(o.run, args);
  }
  await reverifyUploaded(o, set);
  
  ghText(o.run, ["release", "edit", o.tag, "--draft=false", "--latest=false", "--prerelease", "--repo", repository(o)]);
  
  if (url === "") url = inspectRelease(o.run, o.tag, repository(o)).url;

  o.summary([
    `## Prebuilt ${o.tag}`,
    "",
    `Published: ${url}`,
    `Uploaded: ${plan.upload.length === 0 ? "none" : plan.upload.join(", ")}`,
    `Already attached, skipped: ${plan.skip.length === 0 ? "none" : plan.skip.join(", ")}`,
    `Build run: ${o.runUrl}`,
  ]);
  return { kind: "published", url };
}
