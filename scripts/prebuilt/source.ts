/**
 * Which cxstatusline commit a scheduled run builds.
 *
 * Prebuilt detection builds directly from `main` (`GITHUB_SHA` or working tree checkout),
 * decoupled from npm source releases (`v<CX>`).
 *
 * Functions in this file are retained as deprecated utilities for backward compatibility
 * with tests and API exports.
 */
import { compareSemver, parseSemver, type SemVer } from "../../src/version";
import { ghJson, type GhRunner } from "./gh";

/** Source releases are tagged `v<X.Y.Z>`; `CX` is the `package.json` version at that commit. */
const SOURCE_TAG_PREFIX = "v";
const REPO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\/[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
const SOURCE_TAG = /^v\d+\.\d+\.\d+$/;
const HEX40 = /^[0-9a-f]{40}$/;

export interface SourceRelease {
  /** `0.1.0` - the CX version. */
  readonly version: string;
  /** `v0.1.0` - the git tag. */
  readonly tag: string;
}

function stableSourceVersion(entry: unknown): SemVer | null {
  if (typeof entry !== "object" || entry === null) return null;
  const r = entry as Record<string, unknown>;
  if (r.draft === true || r.prerelease === true) return null;
  if (typeof r.tag_name !== "string" || !SOURCE_TAG.test(r.tag_name)) return null;
  const parsed = parseSemver(r.tag_name.slice(SOURCE_TAG_PREFIX.length));
  return parsed !== null && parsed.pre === null ? parsed : null;
}

/**
 * @deprecated Scheduled runs now build directly from checkout HEAD rather than crawling v<CX> releases.
 * The highest stable `v<X.Y.Z>` source release in a GitHub releases payload, or null when the
 * owner has published none. Semver comparison, not lexicographic and not publish order: GitHub
 * returns newest-first by date and `"0.9.0" > "0.11.0"` as strings.
 */
export function selectSourceRelease(releases: unknown): SourceRelease | null {
  if (!Array.isArray(releases)) throw new Error("source release lookup expected a JSON list of releases");
  const stable = releases.map(stableSourceVersion).filter((v): v is SemVer => v !== null);
  if (stable.length === 0) return null;
  const highest = stable.reduce((best, v) => (compareSemver(v, best) > 0 ? v : best));
  return { version: highest.raw, tag: `${SOURCE_TAG_PREFIX}${highest.raw}` };
}

function requireRepo(repo: string): string {
  if (!REPO.test(repo)) throw new Error(`unusable repository ${JSON.stringify(repo)}`);
  return repo;
}

/**
 * @deprecated Scheduled runs now build directly from checkout HEAD rather than crawling v<CX> releases.
 * List the repository's own releases. Argument array only; the repo name is validated first.
 */
export function listSourceReleases(run: GhRunner, repo: string): unknown {
  return ghJson<unknown>(run, ["api", "--paginate", `repos/${requireRepo(repo)}/releases?per_page=100`]);
}

/**
 * @deprecated Scheduled runs now build directly from checkout HEAD rather than crawling v<CX> releases.
 * Resolve a source release tag to the commit it points at, so the build is pinned to that commit.
 */
export function resolveTagCommit(run: GhRunner, repo: string, tag: string): string {
  requireRepo(repo);
  if (!SOURCE_TAG.test(tag)) throw new Error(`unusable source release tag ${JSON.stringify(tag)}`);
  const commit = ghJson<{ sha?: unknown }>(run, ["api", `repos/${repo}/commits/${tag}`]).sha;
  if (typeof commit !== "string" || !HEX40.test(commit)) {
    throw new Error(`could not resolve ${tag} in ${repo} to a commit`);
  }
  return commit;
}
