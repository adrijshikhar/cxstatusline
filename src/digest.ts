/**
 * The one place a file is hashed. Leaf module (imports nothing of ours) so the installer, the
 * generation layout, the builder and doctor can all agree on what a digest is without importing
 * each other.
 */
import { createHash } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";

export interface FileDigest {
  sha256: string;
  size: number;
}

/** Whole-file sync digest. Fine for anything that already fits in memory (every archive member does). */
export function digestOf(file: string): FileDigest {
  const buf = readFileSync(file);
  return { sha256: createHash("sha256").update(buf).digest("hex"), size: buf.length };
}

/** Streamed digest, for archives and binaries that must not be held whole in memory. */
export async function sha256File(file: string): Promise<FileDigest> {
  const digest = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(file)) {
    digest.update(chunk as Buffer);
    size += (chunk as Buffer).length;
  }
  return { sha256: digest.digest("hex"), size };
}

export function sameDigest(a: FileDigest, b: FileDigest): boolean {
  return a.sha256 === b.sha256 && a.size === b.size;
}
