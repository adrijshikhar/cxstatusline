/**
 * Atomic release publication.
 *
 * The contract this module exists to keep: a published release is immutable, an unfinished draft
 * is never silently thrown away, and no byte reaches a release asset that has not been verified
 * both before upload and after download. Every branch that cannot be made safe automatically
 * raises `BlockedError` with restart instructions for the owner instead of guessing.
 *
 * Release *classification* lives in `release.ts`; this module is the part that writes.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ExpectedRelease, type Platform } from "../../src/distribution";
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
  verifyReleaseDir,
  type ExpectedIdentity,
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
  readonly cxVersion: string;
  readonly platform?: Platform;
  readonly platforms?: readonly Platform[];
  readonly event: string;
  readonly tmpRoot: string;
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
  // re-verified. No --clobber anywhere in this module, deliberately.
  return ghText(o.run, [
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
  ]).trim();
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
    const file = downloadAsset(o.run, o.tag, asset.name, dir);
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
  const expected: ExpectedIdentity = { sourceCommit: o.sourceCommit, patchSha256: set.manifest.patchSha256 };
  const assetNames = set.assets.map((a) => a.name);
  const verdict = await checkExistingRelease({
    run: o.run,
    tag: o.tag,
    expected,
    release,
    assetNames,
    tmpRoot: o.tmpRoot,
  });

  if (verdict.state === "published") {
    if (!verdict.identical) throw immutabilityBlock(o.tag, o.codexVersion, verdict.detail);
    o.summary([`## Prebuilt ${o.tag}`, "", `Already published, identical: ${verdict.view.url}`, "", "Nothing to do."]);
    return { kind: "skipped-identical", url: verdict.view.url };
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
  } else if (verdict.state === "published-partial") {
    // published-partial: we don't need provenance checks because the manifest identity already matched
  }

  const existing = verdict.state === "absent" ? [] : verdict.view.assets;
  const plan = planUploads(existing, set.assets);
  for (const name of plan.upload) ghText(o.run, ["release", "upload", o.tag, join(o.dir, name), "--clobber"]);
  await reverifyUploaded(o, set);
  
  if (verdict.state !== "published-partial") {
    ghText(o.run, ["release", "edit", o.tag, "--draft=false", "--latest=false"]);
  }
  
  if (url === "") url = inspectRelease(o.run, o.tag).url;

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
