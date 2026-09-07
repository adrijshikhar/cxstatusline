/**
 * The five-file release allowlist, and nothing else.
 *
 * This module is a leaf on purpose: it imports nothing, so the archive validator, the prebuilt
 * preparer, the generation layout, the manifest schema and the CI packager can all name the same
 * five files without importing each other. Before this existed the list was spelled out five
 * times, and `src/distribution/prebuilt.ts` carried a comment explaining that it could not compose
 * the list from `src/patch/generation.ts` because the two modules import each other.
 */

/** Every basename a release archive, manifest or generation directory may contain. */
export type ArtifactFile = "codex" | "codex-code-mode-host" | "LICENSE" | "NOTICE" | "THIRD_PARTY_NOTICES.md";

/** The two executables that must always appear or disappear together. */
export const GENERATION_EXECUTABLES = ["codex", "codex-code-mode-host"] as const;

/** Shipped with prebuilt pairs; absent from locally compiled ones. */
export const GENERATION_LEGAL_FILES = ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md"] as const;

/**
 * The allowlist in the release's fixed entry order: executables first, legal files after.
 * The packager's tar entry order and the archive validator's membership test are both this list.
 */
export const ARTIFACT_FILES: readonly ArtifactFile[] = [...GENERATION_EXECUTABLES, ...GENERATION_LEGAL_FILES];
