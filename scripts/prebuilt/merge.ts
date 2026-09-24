/**
 * Merges single-platform release manifests into a single multi-platform release manifest.
 */
import type { ReleaseManifest } from "../../src/distribution";

const MUST_AGREE = [
  "schema",
  "cxVersion",
  "codexVersion",
  "upstreamTag",
  "upstreamCommit",
  "patchFile",
  "patchVersion",
  "patchSha256",
  "sourceCommit",
] as const;

export function mergeManifests(parts: readonly ReleaseManifest[]): ReleaseManifest {
  if (parts.length === 0) throw new Error("mergeManifests: no manifests given");
  const [first] = parts;
  for (const part of parts) {
    for (const key of MUST_AGREE) {
      if (part[key] !== first![key]) {
        throw new Error(`mergeManifests: ${key} differs between parts (${String(first![key])} vs ${String(part[key])})`);
      }
    }
  }
  const artifacts = parts.flatMap((p) => p.artifacts).sort((a, b) => a.platform.localeCompare(b.platform));
  const platforms = new Set(artifacts.map((a) => a.platform));
  if (platforms.size !== artifacts.length) throw new Error("mergeManifests: duplicate platform across parts");
  const createdAt = parts.map((p) => p.createdAt).sort()[0]!;
  return { ...first!, createdAt, artifacts };
}
