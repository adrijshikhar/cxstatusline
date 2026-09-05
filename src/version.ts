export interface SemVer {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly pre: string | null;
  readonly raw: string;
}

export type Policy = "every" | "stable-minors" | "manual";
export const POLICIES: readonly Policy[] = ["every", "stable-minors", "manual"];

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function parseSemver(s: string): SemVer | null {
  const m = SEMVER.exec(s.trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    pre: m[4] ?? null,
    raw: s.trim(),
  };
}

/** `codex --version` prints `codex-cli 0.152.1`. */
export function parseCodexVersionOutput(out: string): SemVer | null {
  const m = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(out);
  return m?.[1] ? parseSemver(m[1]) : null;
}

export function compareSemver(a: SemVer, b: SemVer): -1 | 0 | 1 {
  for (const k of ["major", "minor", "patch"] as const) {
    if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1;
  }
  if (a.pre === b.pre) return 0;
  if (a.pre === null) return 1;
  if (b.pre === null) return -1;
  return a.pre < b.pre ? -1 : 1;
}

/** Should the hook rebuild for `upstream`, given what we last built from and the policy? */
export function needsRepatch(upstream: SemVer, patched: SemVer | null, policy: Policy): boolean {
  if (policy === "manual") return false;
  if (policy === "every") return patched === null || compareSemver(upstream, patched) !== 0;
  if (upstream.pre !== null) return false;
  if (patched === null) return true;
  const minorOf = (v: SemVer): number => v.major * 100_000 + v.minor;
  return minorOf(upstream) > minorOf(patched);
}

/** Held by stable-minors but upstream moved within the minor - surfaced by `doctor`. */
export function behindWithinMinor(upstream: SemVer, patched: SemVer): boolean {
  return upstream.major === patched.major && upstream.minor === patched.minor && upstream.pre === null
    && compareSemver(upstream, patched) === 1;
}
