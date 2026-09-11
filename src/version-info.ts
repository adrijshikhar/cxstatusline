declare const CXSTATUSLINE_VERSION: string | undefined;
declare const CXSTATUSLINE_SOURCE_COMMIT: string | null | undefined;
declare const CXSTATUSLINE_SOURCE_DIRTY: boolean | undefined;

/** Stamped by `scripts/build.ts` via Bun's `define`; source runs use this release's version. */
export const VERSION: string = typeof CXSTATUSLINE_VERSION === "string" ? CXSTATUSLINE_VERSION : "0.1.1";

/**
 * The commit of the cxstatusline checkout this bundle was built from, or null.
 * Why the `typeof` guards: outside a bundle these identifiers do not exist at all, and a bare
 * reference would be a ReferenceError. Null is the honest answer for a source run - a compiled
 * pair's provenance must never claim a commit nobody stamped.
 */
export const SOURCE_COMMIT: string | null =
  typeof CXSTATUSLINE_SOURCE_COMMIT === "string" && /^[0-9a-f]{40}$/.test(CXSTATUSLINE_SOURCE_COMMIT)
    ? CXSTATUSLINE_SOURCE_COMMIT
    : null;

/** True when the checkout that produced this bundle had uncommitted changes. */
export const SOURCE_DIRTY: boolean = typeof CXSTATUSLINE_SOURCE_DIRTY === "boolean" && CXSTATUSLINE_SOURCE_DIRTY;
