/**
 * Release-input selection: which upstream Codex version this repository would build, and the
 * release identity that follows from it. Everything here is pure so `test/prebuilt.test.ts` can
 * cover the ordering and exclusion rules without touching the network.
 */
import { releaseTag } from "../../src/distribution";
import { resolvePatch, type Manifest } from "../../src/patch/manifest";
import { compareSemver, parseSemver, type SemVer } from "../../src/version";

/** Upstream Codex releases are tagged `rust-v<X.Y.Z>`; nothing else is a build input. */
const UPSTREAM_TAG_PREFIX = "rust-v";

/** Exit code the `detect` CLI uses when upstream has moved past every supported patch. */
export const UNCOVERED_EXIT_CODE = 3;

/**
 * Thrown by `resolveDetection` for exactly one reason: the highest stable upstream version is not
 * covered by `patches/manifest.json`. This is the *only* failure the `detect` CLI treats as
 * "blocked, not broken" (exit `UNCOVERED_EXIT_CODE` with the blocked-issue summary) - a malformed
 * manifest or a non-stable input version is a plain error (exit 1), not a coverage gap, so it must
 * not be mistaken for one downstream (Task 7's blocked-issue upsert keys off exit 3).
 */
export class UncoveredUpstreamError extends Error {
  override readonly name = "UncoveredUpstreamError";
}

export interface Detection {
  readonly codexVersion: string;
  readonly cxVersion: string;
  readonly tag: string;
  readonly upstreamTag: string;
  readonly patchFile: string;
}

/** A stable version string, or null for anything we must not build from. */
function stableTagVersion(entry: unknown): SemVer | null {
  if (typeof entry !== "object" || entry === null) return null;
  const r = entry as Record<string, unknown>;
  if (r.draft === true || r.prerelease === true) return null;
  if (typeof r.tag_name !== "string" || !r.tag_name.startsWith(UPSTREAM_TAG_PREFIX)) return null;
  const parsed = parseSemver(r.tag_name.slice(UPSTREAM_TAG_PREFIX.length));
  return parsed !== null && parsed.pre === null ? parsed : null;
}

/**
 * The highest stable `rust-v*` release in a GitHub releases payload.
 *
 * Compared with `compareSemver`, never as strings: GitHub returns releases newest-first by
 * publish date and `"0.99.0" > "0.153.0"` lexicographically, so both shortcuts pick the wrong
 * upstream. Drafts, prereleases and tags that are not `rust-v<stable semver>` are dropped.
 */
export function selectStableVersion(releases: unknown): string {
  if (!Array.isArray(releases)) throw new Error("upstream detection expected a JSON list of releases");
  const stable = releases.map(stableTagVersion).filter((v): v is SemVer => v !== null);
  if (stable.length === 0) throw new Error("upstream detection found no stable rust-v* Codex release");
  const highest = stable.reduce((best, v) => (compareSemver(v, best) > 0 ? v : best));
  return highest.raw;
}

/** The title of the single tracking issue for a blocked prebuilt run. */
export function blockedIssueTitle(version: string | null): string {
  return version === null ? "Prebuilt blocked: upstream detection" : `Prebuilt blocked: Codex ${version}`;
}

function requireStable(label: string, version: string): SemVer {
  const parsed = parseSemver(version);
  if (parsed === null || parsed.pre !== null) {
    throw new Error(`${label} must be an exact stable three-part version, got ${JSON.stringify(version)}`);
  }
  return parsed;
}

/**
 * Turn a chosen upstream version plus this checkout's CX version into the full release identity.
 * Fails closed when `patches/manifest.json` does not explicitly cover the version: naming both the
 * uncovered upstream version and the supported candidate is what makes the blocked issue actionable.
 */
export function resolveDetection(m: Manifest, codexVersion: string, cxVersion: string): Detection {
  const parsed = requireStable("upstream Codex version", codexVersion);
  requireStable("cxstatusline version", cxVersion);
  const patch = resolvePatch(m, parsed);
  if (patch === null) {
    const candidate = m.candidate ?? m.patches.at(-1)?.max ?? "none";
    throw new UncoveredUpstreamError(
      `upstream Codex ${codexVersion} is not covered by patches/manifest.json; `
        + `the newest explicitly supported candidate is ${candidate}. `
        + `Add and test patches/codex-${codexVersion}.patch before releasing that version.`,
    );
  }
  return {
    codexVersion,
    cxVersion,
    tag: releaseTag(cxVersion, codexVersion),
    upstreamTag: patch.tag,
    patchFile: patch.file,
  };
}
