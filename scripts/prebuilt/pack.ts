/**
 * Deterministic packaging of the five-file release archive.
 *
 * "Deterministic" here means exactly one thing: identical staged inputs produce identical archive
 * bytes. It is not a claim that the Rust build itself is bit-reproducible.
 */
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import { create } from "tar";
import type { ArtifactFile, FileDigest, Platform } from "../../src/distribution";

/** Fixed entry order. The installer's validator requires exactly these five basenames. */
export const ARCHIVE_ENTRIES: readonly ArtifactFile[] = [
  "codex",
  "codex-code-mode-host",
  "LICENSE",
  "NOTICE",
  "THIRD_PARTY_NOTICES.md",
];

const EXECUTABLES: readonly ArtifactFile[] = ["codex", "codex-code-mode-host"];
const EXECUTABLE_MODE = 0o755;
const LEGAL_MODE = 0o644;

/**
 * A fixed archive timestamp. Real mtimes are build-machine noise that would make two packs of the
 * same bytes differ; the true provenance lives in `manifest.json`, not in tar headers.
 */
export const ARCHIVE_MTIME = new Date("2000-01-01T00:00:00.000Z");

export function archiveFilename(codexVersion: string, platform: Platform): string {
  return `cxstatusline-codex-${codexVersion}-${platform}.tar.gz`;
}

export function sha256File(file: string): FileDigest {
  const bytes = readFileSync(file);
  return { sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
}

function isExecutable(name: ArtifactFile): boolean {
  return EXECUTABLES.includes(name);
}

/** Every member must exist as a non-empty regular file before anything is packed. */
function normalizeStaging(stagingDir: string): void {
  for (const name of ARCHIVE_ENTRIES) {
    const file = join(stagingDir, name);
    const stat = lstatSync(file);
    if (!stat.isFile()) throw new Error(`staged ${name} is not a regular file`);
    if (stat.size === 0) throw new Error(`staged ${name} is empty`);
    chmodSync(file, isExecutable(name) ? EXECUTABLE_MODE : LEGAL_MODE);
  }
}

/**
 * Pack `stagingDir`'s five members into `outPath` and return the archive's own digest.
 *
 * Determinism comes from four things: an explicit file list in fixed order (never `.`, which would
 * add the `./` entry the installer rejects), `portable: true` to drop uid/gid/uname/atime/ctime,
 * a fixed `mtime`, and modes forced to 0755/0644. gzip is applied separately with node's zlib,
 * whose gzip header carries no timestamp.
 */
export async function packArchive(stagingDir: string, outPath: string): Promise<FileDigest> {
  normalizeStaging(stagingDir);
  mkdirSync(dirname(outPath), { recursive: true });
  const tarPath = `${outPath}.tar`;
  try {
    await create(
      { cwd: stagingDir, file: tarPath, gzip: false, portable: true, mtime: ARCHIVE_MTIME, follow: false, sync: true },
      [...ARCHIVE_ENTRIES],
    );
    writeFileSync(outPath, gzipSync(readFileSync(tarPath), { level: 9 }));
  } finally {
    rmSync(tarPath, { force: true });
  }
  return sha256File(outPath);
}

export function fileDigests(stagingDir: string): Record<ArtifactFile, FileDigest> {
  const out: Record<string, FileDigest> = {};
  for (const name of ARCHIVE_ENTRIES) out[name] = sha256File(join(stagingDir, name));
  return out as Record<ArtifactFile, FileDigest>;
}

/**
 * `shasum -a 256` format, so the published list can be checked with the stock macOS tool.
 * Names are basenames only; the caller passes the files it actually wrote.
 */
export function writeChecksums(outDir: string, filenames: readonly string[]): string {
  const lines = filenames.map((name) => {
    if (name !== basename(name)) throw new Error(`checksum entry ${JSON.stringify(name)} must be a basename`);
    return `${sha256File(join(outDir, name)).sha256}  ${name}`;
  });
  const body = `${lines.join("\n")}\n`;
  writeFileSync(join(outDir, "SHA256SUMS"), body);
  return body;
}

/** Parse a SHA256SUMS body into name -> digest. Rejects anything that is not the exact format. */
export function parseChecksums(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of body.trimEnd().split("\n")) {
    const match = /^([0-9a-f]{64})\s{2}([^\s/\\][^/\\]*)$/.exec(line);
    if (match === null) throw new Error(`SHA256SUMS line is malformed: ${JSON.stringify(line.slice(0, 120))}`);
    out[match[2]!] = match[1]!;
  }
  return out;
}

export interface AssembleInput {
  /** The patched upstream Codex checkout, source of the executables and upstream legal files. */
  readonly upstreamDir: string;
  /** This repository's root, source of `THIRD_PARTY_NOTICES.md`. */
  readonly repoRoot: string;
  readonly stagingDir: string;
}

/** Copy the five release members into a clean staging directory with the release's modes. */
export function assembleStaging(input: AssembleInput): void {
  const release = join(input.upstreamDir, "codex-rs", "target", "release");
  const sources: Record<ArtifactFile, string> = {
    "codex": join(release, "codex"),
    "codex-code-mode-host": join(release, "codex-code-mode-host"),
    "LICENSE": join(input.upstreamDir, "LICENSE"),
    "NOTICE": join(input.upstreamDir, "NOTICE"),
    "THIRD_PARTY_NOTICES.md": join(input.repoRoot, "THIRD_PARTY_NOTICES.md"),
  };
  mkdirSync(input.stagingDir, { recursive: true });
  for (const name of ARCHIVE_ENTRIES) {
    copyFileSync(sources[name], join(input.stagingDir, name));
    chmodSync(join(input.stagingDir, name), isExecutable(name) ? EXECUTABLE_MODE : LEGAL_MODE);
  }
}
