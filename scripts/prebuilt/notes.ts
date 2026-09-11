/**
 * Release notes and the provenance marker they carry.
 *
 * The notes are deterministic: for identical inputs they are byte-identical, so a resumed publish
 * can compare a draft's recorded provenance against the current build instead of guessing. Nothing
 * here reads the clock or the environment.
 */
import type { Platform } from "../../src/distribution";

/** Machine-readable build identity hidden in the release body. Parsed on a resumed publish. */
export interface Provenance {
  readonly runId: string;
  readonly manifestSha256: string;
}

const PROVENANCE_RE = /<!-- cxstatusline-prebuilt-build run=([0-9A-Za-z._-]{1,64}) manifest_sha=([0-9a-f]{64}) -->/;

export function provenanceMarker(p: Provenance): string {
  if (!/^[0-9A-Za-z._-]{1,64}$/.test(p.runId)) throw new Error(`unusable run id ${JSON.stringify(p.runId)}`);
  if (!/^[0-9a-f]{64}$/.test(p.manifestSha256)) throw new Error("manifest sha256 must be 64 lowercase hex chars");
  return `<!-- cxstatusline-prebuilt-build run=${p.runId} manifest_sha=${p.manifestSha256} -->`;
}

/** The provenance recorded in a release body, or null when the body has none. */
export function parseProvenance(body: string): Provenance | null {
  const match = PROVENANCE_RE.exec(body);
  return match === null ? null : { runId: match[1]!, manifestSha256: match[2]! };
}

/** Which trigger produced this build. Recorded verbatim so a release is never mis-attributed. */
export type BuildIdentity =
  | { readonly kind: "dispatch"; readonly sha: string }
  | { readonly kind: "schedule"; readonly cxVersion: string };

export interface NotesInput {
  readonly cxVersion: string;
  readonly codexVersion: string;
  readonly platform: Platform;
  readonly sourceCommit: string;
  readonly upstreamTag: string;
  readonly upstreamCommit: string;
  readonly patchFile: string;
  readonly patchSha256: string;
  readonly runId: string;
  readonly runUrl: string;
  readonly manifestSha256: string;
  readonly identity: BuildIdentity;
}

export function releaseTitle(i: Pick<NotesInput, "cxVersion" | "codexVersion" | "platform">): string {
  return `cxstatusline v${i.cxVersion} · Codex ${i.codexVersion} (${i.platform}, private)`;
}

function identityLine(i: NotesInput): string {
  const trigger = i.identity.kind === "dispatch"
    ? `manual dispatch of commit ${i.identity.sha}`
    : `scheduled build of source release v${i.identity.cxVersion}`;
  return `Workflow run ${i.runUrl} (${trigger})`;
}

/**
 * The published release body. Everything a person needs in order to decide whether to trust these
 * bytes: what they were built from, what they will and will not run on, what is unproven, and the
 * escape hatch if they would rather not use a prebuilt binary at all.
 */
export function releaseNotes(i: NotesInput): string {
  return [
    `# ${releaseTitle(i)}`,
    "",
    `Built from cxstatusline commit ${i.sourceCommit} (package version ${i.cxVersion}) and `
      + `openai/codex ${i.upstreamTag} (${i.upstreamCommit}) with patch ${i.patchFile} `
      + `sha256 ${i.patchSha256}.`,
    "",
    "## Architectures",
    "",
    `${i.platform} only (Apple Silicon); Intel is not built in this release.`,
    "",
    "## Signing",
    "",
    "Unsigned, not notarized; macOS Gatekeeper warnings are expected; do not disable Gatekeeper "
      + "globally. Clear the quarantine attribute for these two files only, or build from source "
      + "with the compile fallback below.",
    "",
    "## Licenses",
    "",
    "The bundled `codex` and `codex-code-mode-host` derive from openai/codex, licensed "
      + "Apache-2.0; cxstatusline's own code is MIT. The archive carries upstream's `LICENSE` and "
      + "`NOTICE` plus this repository's `THIRD_PARTY_NOTICES.md`; read those, not this summary.",
    "",
    "- Dependency licenses: `cargo deny check licenses` passed against upstream's policy and the "
      + "generated notices are appended to the archive's `THIRD_PARTY_NOTICES.md`.",
    "",
    "## Compile fallback",
    "",
    "You never have to use these binaries. For a supported Codex version, "
      + "`cxstatusline install --compile` builds the same pair from source on your own machine.",
    "",
    "## Known gaps",
    "",
    "- No acceptance run on a clean macOS 14 machine or VM. macOS 14 support is evidenced only by "
      + "`MACOSX_DEPLOYMENT_TARGET=14.0`, `vtool` `minos` and system-only `otool -L` linkage.",
    "",
    "## Build identity",
    "",
    identityLine(i),
    "",
    provenanceMarker({ runId: i.runId, manifestSha256: i.manifestSha256 }),
    "",
  ].join("\n");
}
