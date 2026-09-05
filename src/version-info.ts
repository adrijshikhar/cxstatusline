declare const CXSTATUSLINE_VERSION: string | undefined;

/** Stamped by `scripts/build.ts` via Bun's `define`; source runs use this release's version. */
export const VERSION: string = typeof CXSTATUSLINE_VERSION === "string" ? CXSTATUSLINE_VERSION : "0.1.0";
