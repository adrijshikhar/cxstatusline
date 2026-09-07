/**
 * The source provenance stamped into the bundle at build time.
 *
 * Why it is resolved here and not at runtime: the shipped CLI runs from `dist/cxstatusline.js`,
 * anywhere on the user's disk. Asking git at runtime would answer about whatever checkout the user
 * happens to be standing in, which is not the code that is running.
 */
export interface SourceProvenance {
  /** 40 lowercase hex, or null when the build checkout had no usable git metadata. */
  readonly commit: string | null;
  readonly dirty: boolean;
}

/** A `git` invocation. Injected so the release gate is testable without a fixture repository. */
export type GitProbe = (args: readonly string[]) => { status: number | null; stdout: string };

const HEX40 = /^[0-9a-f]{40}$/;

/**
 * Resolve the build checkout's commit and worktree cleanliness.
 * Anything unknown is `null`/`false` - never a guess. A tarball build, a vendored copy or a
 * checkout without `git` all land here, and recording an invented hash would make an
 * unreproducible binary claim to be reproducible.
 */
export function sourceProvenance(git: GitProbe): SourceProvenance {
  try {
    const head = git(["rev-parse", "HEAD"]);
    const commit = head.stdout.trim();
    if (head.status !== 0 || !HEX40.test(commit)) return { commit: null, dirty: false };
    const status = git(["status", "--porcelain"]);
    if (status.status !== 0) return { commit: null, dirty: false };
    return { commit, dirty: status.stdout.trim().length > 0 };
  } catch {
    return { commit: null, dirty: false };
  }
}

/** Release packaging is exact or it does not happen. Throws with the reason it cannot proceed. */
export function assertReleaseProvenance(p: SourceProvenance): void {
  if (p.commit === null) {
    throw new Error("CXSTATUSLINE_RELEASE_BUILD=1: the build checkout has no usable git commit; a release must record an exact source commit");
  }
  if (p.dirty) {
    throw new Error("CXSTATUSLINE_RELEASE_BUILD=1: the build checkout is dirty; commit or stash every change before packaging a release");
  }
}
