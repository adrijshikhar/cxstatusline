/**
 * What a release for a tag currently is, and whether this run's bytes may go into it.
 *
 * Split out of `publish.ts` so `detect` can ask the same questions before a 1-3 hour build starts
 * without importing the upload flow. Everything here either reads or classifies; nothing here
 * creates, edits, uploads or deletes.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateManifest, type ExpectedRelease, type Platform, type ReleaseManifest } from "../../src/distribution";
import { ghText, type GhRunner } from "./gh";
import { parseChecksums, sha256File } from "./pack";
import { redact } from "./redact";

/** Asset names are our own, but they still index into a filesystem and a `--pattern`. */
export const SAFE_ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
const DEFAULT_REPOSITORY = process.env.GITHUB_REPOSITORY ?? "adrijshikhar/cxstatusline";

/**
 * A state only the owner can resolve. Exit code 3 is the pipeline's "blocked, not broken" signal
 * (the same code `detect` uses for uncovered upstream), so a blocked publish is reported as a
 * tracking issue rather than looking like a flaky build.
 */
export class BlockedError extends Error {
  override readonly name = "BlockedError";
  readonly exitCode = 3;
  constructor(
    readonly title: string,
    message: string,
  ) {
    super(message);
  }
}

export interface ReleaseAsset {
  readonly name: string;
  readonly size: number;
}

export type ReleaseState = "absent" | "draft" | "published" | "published-partial";

export interface ReleaseView {
  readonly state: ReleaseState;
  readonly url: string;
  readonly body: string;
  readonly title?: string;
  readonly id?: number;
  readonly isPrerelease?: boolean;
  readonly assets: readonly ReleaseAsset[];
}

export interface VerifiedSet {
  readonly manifest: ReleaseManifest;
  readonly archive: string;
  readonly archives: readonly string[];
  readonly manifestSha256: string;
  readonly assets: readonly ReleaseAsset[];
}

export type ExpectedReleaseInput = {
  readonly cxVersion?: string;
  readonly codexVersion: string;
  readonly platforms?: readonly Platform[];
  readonly platform?: Platform;
};

export interface ExpectedIdentity {
  readonly sourceCommit: string;
  readonly patchSha256: string;
  readonly patchVersion?: number;
}

// ---- pure helpers ----

/**
 * Verify the downloaded workflow artifact before anything is uploaded: exactly the three release
 * files, a manifest the *installer's own* validator accepts, and a `SHA256SUMS` that agrees with
 * both the archive and the manifest's own bytes.
 */
export async function verifyReleaseDir(dir: string, expected: ExpectedReleaseInput): Promise<VerifiedSet> {
  const platforms = expected.platforms ?? (expected.platform ? [expected.platform] : ["darwin-arm64"]);
  const expectedCount = platforms.length + 2;
  const entries = readdirSync(dir).sort();
  if (entries.length !== expectedCount) {
    if (platforms.length === 1) {
      throw new Error(`release directory must hold exactly three files, found ${entries.length}: ${entries.join(", ")}`);
    }
    throw new Error(`release directory must hold exactly ${expectedCount} files, found ${entries.length}: ${entries.join(", ")}`);
  }
  const manifestFile = join(dir, "manifest.json");
  if (!existsSync(manifestFile)) throw new Error(`manifest.json is missing from ${dir}`);
  const raw = JSON.parse(readFileSync(manifestFile, "utf8"));
  let manifest!: ReleaseManifest;
  for (const platform of platforms) {
    manifest = validateManifest(raw, {
      cxVersion: expected.cxVersion,
      codexVersion: expected.codexVersion,
      platform,
    });
  }

  const sums = parseChecksums(readFileSync(join(dir, "SHA256SUMS"), "utf8"));
  const manifestDigest = await sha256File(manifestFile);
  if (sums["manifest.json"] !== manifestDigest.sha256) {
    throw new Error("SHA256SUMS does not match manifest.json's own bytes");
  }

  const archives: string[] = [];
  const assets: ReleaseAsset[] = [];
  for (const platform of platforms) {
    const artifact = manifest.artifacts.find((a) => a.platform === platform);
    if (artifact === undefined) throw new Error(`manifest.json has no ${platform} artifact`);
    if (!SAFE_ASSET_NAME.test(artifact.filename)) throw new Error(`unusable release asset name ${JSON.stringify(artifact.filename)}`);
    if (!entries.includes(artifact.filename)) throw new Error(`${artifact.filename} is missing from ${dir}`);

    const archive = await sha256File(join(dir, artifact.filename));
    if (archive.sha256 !== artifact.sha256 || archive.size !== artifact.size) {
      throw new Error(`${artifact.filename} sha256/size does not match manifest.json`);
    }
    if (sums[artifact.filename] !== artifact.sha256) throw new Error("SHA256SUMS disagrees with manifest.json");

    archives.push(artifact.filename);
    assets.push({ name: artifact.filename, size: archive.size });
  }

  const sumsDigest = await sha256File(join(dir, "SHA256SUMS"));
  assets.push({ name: "manifest.json", size: manifestDigest.size });
  assets.push({ name: "SHA256SUMS", size: sumsDigest.size });

  return {
    manifest,
    archive: archives[0]!,
    archives,
    manifestSha256: manifestDigest.sha256,
    assets,
  };
}

/**
 * Re-upload every draft asset: size alone cannot establish byte identity. Archives go first,
 * checksums next and the manifest last so an interrupted draft never advertises a mixed manifest.
 */
export function planUploads(
  existing: readonly ReleaseAsset[],
  local: readonly ReleaseAsset[],
): { readonly upload: readonly string[]; readonly skip: readonly string[] } {
  const upload: string[] = [];
  const skip: string[] = [];
  for (const asset of local) {
    const attached = existing.find((a) => a.name === asset.name);
    upload.push(asset.name);
  }
  const order = (name: string): number => name === "manifest.json" ? 2 : name === "SHA256SUMS" ? 1 : 0;
  upload.sort((a, b) => order(a) - order(b));
  return { upload, skip };
}

/** Whether a manifest was built from the commit and patch this run would build. */
export function compareIdentity(
  manifest: ReleaseManifest,
  expected: ExpectedIdentity,
): { readonly identical: boolean; readonly detail: string } {
  const problems: string[] = [];
  if (manifest.patchVersion !== expected.patchVersion) {
    problems.push(`patchVersion ${manifest.patchVersion ?? "legacy"} (published) vs ${expected.patchVersion ?? "legacy"} (this run)`);
  }
  if (manifest.sourceCommit !== expected.sourceCommit) {
    problems.push(`sourceCommit ${manifest.sourceCommit} (published) vs ${expected.sourceCommit} (this run)`);
  }
  if (manifest.patchSha256 !== expected.patchSha256) {
    problems.push(`patchSha256 ${manifest.patchSha256} (published) vs ${expected.patchSha256} (this run)`);
  }
  return { identical: problems.length === 0, detail: problems.join("; ") };
}

// ---- gh-backed helpers ----

/** `gh release view`, with "no such release" separated from every other failure. */
export function inspectRelease(run: GhRunner, tag: string, repo = DEFAULT_REPOSITORY): ReleaseView {
  const args = ["release", "view", tag, "--repo", repo, "--json", "isDraft,isPrerelease,url,name,body,assets"];
  const result = run(args);
  if (result.status !== 0) {
    if (/release not found|not found|HTTP 404/i.test(result.stderr)) {
      return { state: "absent", url: "", body: "", assets: [] };
    }
    // gh's stderr can carry a token or a presigned URL, and this message reaches a step summary
    // and an issue body.
    throw new Error(`gh release view ${tag} failed (exit ${result.status}): ${redact(result.stderr.trim())}`);
  }
  const raw = JSON.parse(result.stdout) as {
    isDraft?: unknown;
    url?: unknown;
    body?: unknown;
    name?: unknown;
    id?: unknown;
    isPrerelease?: unknown;
    assets?: readonly { name?: unknown; size?: unknown }[];
  };
  const assets = (raw.assets ?? [])
    .filter((a) => typeof a.name === "string" && typeof a.size === "number")
    .map((a) => ({ name: a.name as string, size: a.size as number }));
  return {
    state: raw.isDraft === true ? "draft" : "published",
    url: typeof raw.url === "string" ? raw.url : "",
    body: typeof raw.body === "string" ? raw.body : "",
    title: typeof raw.name === "string" ? raw.name : undefined,
    id: typeof raw.id === "number" ? raw.id : undefined,
    isPrerelease: raw.isPrerelease === true,
    assets,
  };
}

/** Download one named asset into `dir`, refusing a name that is not one of ours. */
export function downloadAsset(run: GhRunner, tag: string, name: string, dir: string, repo = DEFAULT_REPOSITORY): string {
  if (!SAFE_ASSET_NAME.test(name)) throw new Error(`refusing to download unusable asset name ${JSON.stringify(name)}`);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  if (existsSync(file)) rmSync(file, { force: true });
  ghText(run, ["release", "download", tag, "--pattern", name, "--dir", dir, "--repo", repo]);
  if (!existsSync(file)) throw new Error(`gh release download ${tag} did not produce ${name}`);
  return file;
}

export type ExistingVerdict =
  | { readonly state: "absent"; readonly view: ReleaseView }
  | { readonly state: "draft"; readonly view: ReleaseView }
  | { readonly state: "published"; readonly view: ReleaseView; readonly identical: boolean; readonly detail: string }
  | { readonly state: "published-partial"; readonly view: ReleaseView; readonly missing: readonly string[] };

export interface ExistingCheck {
  readonly run: GhRunner;
  readonly tag: string;
  readonly expected: ExpectedIdentity;
  readonly release: ExpectedReleaseInput;
  readonly assetNames: readonly string[];
  readonly tmpRoot: string;
  readonly repo?: string;
}

export interface ReleaseBackup {
  readonly schema: 1;
  readonly state: "absent" | "draft" | "published";
  readonly tag: string;
  readonly view?: ReleaseView;
  readonly manifestSha256?: string;
}

function releaseSnapshot(view: ReleaseView): string {
  return JSON.stringify({
    id: view.id ?? null,
    title: view.title ?? "",
    body: view.body,
    isPrerelease: view.isPrerelease === true,
    assets: [...view.assets].sort((a, b) => a.name.localeCompare(b.name)),
  });
}

/** Download and verify the whole currently published generation before replacement. */
export async function backupPublishedRelease(run: GhRunner, tag: string, codexVersion: string, dir: string, repo = DEFAULT_REPOSITORY): Promise<ReleaseBackup> {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const view = inspectRelease(run, tag, repo);
  if (view.state !== "published") {
    const backup: ReleaseBackup = { schema: 1, state: view.state === "draft" ? "draft" : "absent", tag, view };
    writeFileSync(join(dir, "backup.json"), `${JSON.stringify(backup, null, 2)}\n`);
    return backup;
  }
  const assetsDir = join(dir, "assets");
  const manifestFile = downloadAsset(run, tag, "manifest.json", assetsDir, repo);
  const raw = JSON.parse(readFileSync(manifestFile, "utf8")) as { artifacts?: { platform?: unknown }[] };
  const validPlatforms = ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64"];
  const platforms = raw.artifacts?.map((artifact) => artifact.platform)
    .filter((platform): platform is Platform => typeof platform === "string" && validPlatforms.includes(platform)) ?? [];
  if (platforms.length === 0 || platforms.length !== (raw.artifacts?.length ?? 0)) throw new Error(`release ${tag} has no valid platform manifest`);
  let releaseManifest!: ReleaseManifest;
  for (const platform of platforms) releaseManifest = validateManifest(raw, { codexVersion, platform });
  const names = [...releaseManifest.artifacts.map((artifact) => artifact.filename), "manifest.json", "SHA256SUMS"].sort();
  const publishedNames = view.assets.map((asset) => asset.name).sort();
  if (JSON.stringify(names) !== JSON.stringify(publishedNames)) throw new Error(`release ${tag} contains assets outside its verified manifest`);
  for (const name of names) if (name !== "manifest.json") downloadAsset(run, tag, name, assetsDir, repo);
  const verified = await verifyReleaseDir(assetsDir, { codexVersion, platforms });
  const backup: ReleaseBackup = { schema: 1, state: "published", tag, view, manifestSha256: verified.manifestSha256 };
  writeFileSync(join(dir, "backup.json"), `${JSON.stringify(backup, null, 2)}\n`);
  return backup;
}

/** Verify the saved bytes and ensure GitHub still holds the identity saved before mutation. */
export async function verifyReleaseBackup(run: GhRunner, tag: string, dir: string, repo = DEFAULT_REPOSITORY): Promise<ReleaseBackup> {
  const backup = JSON.parse(readFileSync(join(dir, "backup.json"), "utf8")) as ReleaseBackup;
  if (backup.schema !== 1 || backup.tag !== tag) throw new Error("release backup tag or schema does not match");
  if (backup.state === "published") {
    const raw = JSON.parse(readFileSync(join(dir, "assets", "manifest.json"), "utf8")) as {
      codexVersion?: unknown; artifacts?: { platform?: unknown }[];
    };
    if (typeof raw.codexVersion !== "string") throw new Error("backup manifest has no Codex version");
    const platforms = raw.artifacts?.map((artifact) => artifact.platform).filter((p): p is Platform => typeof p === "string") ?? [];
    const verified = await verifyReleaseDir(join(dir, "assets"), { codexVersion: raw.codexVersion, platforms });
    if (verified.manifestSha256 !== backup.manifestSha256) throw new Error("release backup manifest digest changed");
    const current = inspectRelease(run, tag, repo);
    if (!backup.view || current.state !== "published" || releaseSnapshot(current) !== releaseSnapshot(backup.view)) {
      throw new Error(`release ${tag} changed after backup; refusing replacement`);
    }
    const currentDir = join(dir, "current-check");
    rmSync(currentDir, { recursive: true, force: true });
    for (const asset of current.assets) downloadAsset(run, tag, asset.name, currentDir, repo);
    const currentSet = await verifyReleaseDir(currentDir, { codexVersion: raw.codexVersion, platforms });
    if (currentSet.manifestSha256 !== backup.manifestSha256) throw new Error(`release ${tag} asset bytes changed after backup; refusing replacement`);
  } else {
    const current = inspectRelease(run, tag, repo);
    if (backup.state === "absent" && current.state !== "absent") throw new Error(`release ${tag} appeared after backup; refusing publication`);
    if (backup.state === "draft" && (current.state !== "draft" || !backup.view || releaseSnapshot(current) !== releaseSnapshot(backup.view))) {
      throw new Error(`draft ${tag} changed after backup; refusing publication`);
    }
  }
  return backup;
}

/**
 * Classify the release that exists for this tag right now. `detect` runs this before the build and
 * `publish` runs it again immediately before uploading, because a 1-3 hour build is long enough
 * for the state to have changed.
 */
export async function checkExistingRelease(c: ExistingCheck): Promise<ExistingVerdict> {
  const view = inspectRelease(c.run, c.tag, c.repo);
  if (view.state !== "published") return { state: view.state, view } as ExistingVerdict;

  const attached = new Map(view.assets.map((a) => [a.name, a.size]));
  const missing = c.assetNames.filter((n) => !attached.has(n));
  
  if (attached.has("manifest.json")) {
    const file = downloadAsset(c.run, c.tag, "manifest.json", join(c.tmpRoot, "published"), c.repo);
    const raw = JSON.parse(readFileSync(file, "utf8"));
    
    if (missing.length > 0) {
      if (raw.patchSha256 === c.expected.patchSha256 && raw.patchVersion === c.expected.patchVersion) {
        return { state: "published-partial", view, missing };
      }
      return { state: "published", view, identical: false, detail: `published release is missing ${missing.join(", ")}` };
    }

    const platforms = c.release.platforms ?? (c.release.platform ? [c.release.platform] : ["darwin-arm64"]);
    let manifest!: ReleaseManifest;
    let valid = true;
    for (const platform of platforms) {
      try {
        manifest = validateManifest(raw, {
          cxVersion: c.release.cxVersion,
          codexVersion: c.release.codexVersion,
          platform,
        });
      } catch (e) {
        valid = false;
        break;
      }
    }
    
    if (!valid) {
      if (raw.patchSha256 === c.expected.patchSha256 && raw.patchVersion === c.expected.patchVersion) {
        return { state: "published-partial", view, missing };
      }
      return { state: "published", view, identical: false, detail: "published release manifest is invalid for requested platforms" };
    }

    for (const artifact of manifest.artifacts) {
      const size = attached.get(artifact.filename);
      if (size === undefined || size !== artifact.size) {
        return {
          state: "published",
          view,
          identical: false,
          detail: `asset ${artifact.filename} is missing or size differs (${size} vs ${artifact.size})`,
        };
      }
    }
    const comparison = compareIdentity(manifest, c.expected);
    return { state: "published", view, identical: comparison.identical, detail: comparison.detail };
  }

  if (missing.length > 0) {
    return { state: "published", view, identical: false, detail: `published release is missing ${missing.join(", ")}` };
  }

  return { state: "published", view, identical: false, detail: "published release is missing manifest.json" };
}

/** The message a published-but-different release earns. Shared by `detect` and `publish`. */
export function immutabilityMessage(tag: string, detail: string): string {
  return (
    `Release ${tag} must be rebuilt from different inputs (${detail}). A complete verified backup is required `
    + `before its release assets can be replaced.`
  );
}
