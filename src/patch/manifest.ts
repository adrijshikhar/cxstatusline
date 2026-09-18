import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compareSemver, parseSemver, type SemVer } from "../version";

export interface PatchRange {
  readonly min: string;
  readonly max: string;
  readonly file: string;
}

export interface Manifest {
  readonly version: 1;
  readonly tag_prefix: string;
  /**
   * The newest explicitly supported Codex version, named so release CI can say which version it
   * would have built when upstream has moved ahead. Optional and purely informational: it never
   * widens `patches`, and `resolvePatch` ignores it.
   */
  readonly candidate?: string;
  readonly patches: readonly PatchRange[];
}

/** Thrown for every unreadable / malformed manifest. `runPatch` turns it into a refusal. */
export class ManifestError extends Error {
  override readonly name = "ManifestError";
}

const isRange = (p: unknown): p is PatchRange => {
  if (typeof p !== "object" || p === null) return false;
  const r = p as Record<string, unknown>;
  return typeof r.min === "string" && parseSemver(r.min) !== null
    && typeof r.max === "string" && parseSemver(r.max) !== null
    && typeof r.file === "string" && r.file.length > 0;
};

/** Absent, or an exact stable version. A prerelease or garbage candidate is a malformed manifest. */
const isCandidate = (c: unknown): boolean => {
  if (c === undefined) return true;
  if (typeof c !== "string") return false;
  const parsed = parseSemver(c);
  return parsed !== null && parsed.pre === null;
};

/**
 * Load `<patchesDir>/manifest.json`. Throws `ManifestError` and nothing else.
 * Why the validation is inside the try with `typeof` guards: `{"patches":[{}]}` used to reach
 * `parseSemver(undefined)` and escape as a raw `TypeError`, so the fail-closed path (spec L161)
 * crashed instead of returning a refusal.
 */
export function loadManifest(patchesDir: string): Manifest {
  const file = join(patchesDir, "manifest.json");
  try {
    const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
    const m = raw as Partial<Manifest>;
    const ok = typeof m === "object" && m !== null
      && m.version === 1
      && typeof m.tag_prefix === "string"
      && Array.isArray(m.patches)
      && m.patches.every(isRange)
      && isCandidate(m.candidate);
    if (!ok) throw new ManifestError(`${file}: manifest is malformed`);
    return m as Manifest;
  } catch (e) {
    if (e instanceof ManifestError) throw e;
    throw new ManifestError(`${file}: manifest is unreadable or malformed (${String(e)})`);
  }
}

/** Exact inclusive-range match or null. Prereleases never match. Fails closed on purpose (D3). */
export function resolvePatch(m: Manifest, v: SemVer): { file: string; tag: string } | null {
  if (v.pre !== null) return null;
  const hit = m.patches.find((p) => {
    const min = parseSemver(p.min);
    const max = parseSemver(p.max);
    return min && max && compareSemver(v, min) >= 0 && compareSemver(v, max) <= 0;
  });
  return hit ? { file: hit.file, tag: `${m.tag_prefix}${v.raw}` } : null;
}

/**
 * Returns all discrete versions named in the manifest (candidate plus min/max of each range),
 * sorted descending by semver (newest first).
 */
export function supportedCodexVersions(m: Manifest): string[] {
  const versions = new Set<string>();
  if (m.candidate) versions.add(m.candidate);
  for (const p of m.patches) {
    versions.add(p.min);
    versions.add(p.max);
  }
  return Array.from(versions).sort((a, b) => {
    const semA = parseSemver(a);
    const semB = parseSemver(b);
    if (!semA || !semB) return b.localeCompare(a);
    return compareSemver(semB, semA);
  });
}

/** Check whether a version is covered by any patch range in the manifest. */
export function isCodexVersionSupported(m: Manifest, version: string): boolean {
  const parsed = parseSemver(version);
  return parsed !== null && resolvePatch(m, parsed) !== null;
}
