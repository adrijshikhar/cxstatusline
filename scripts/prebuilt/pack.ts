/**
 * Deterministic packaging of the five-file release archive.
 *
 * "Deterministic" here means exactly one thing: identical staged inputs produce identical archive
 * bytes. It is not a claim that the Rust build itself is bit-reproducible.
 */
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, createReadStream, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { create } from "tar";
import type { ArtifactFile, FileDigest, Platform } from "../../src/distribution";
import { ARTIFACT_FILES, GENERATION_EXECUTABLES } from "../../src/distribution/files";

/** Fixed entry order. The installer's validator requires exactly these five basenames. */
export const ARCHIVE_ENTRIES: readonly ArtifactFile[] = ARTIFACT_FILES;

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

/**
 * Streamed sha256 + size, so a several-hundred-megabyte binary or archive is never held whole in
 * memory - the same pattern `scripts/ci-prebuilt.ts` uses.
 */
export async function sha256File(file: string): Promise<FileDigest> {
  const digest = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(file)) {
    digest.update(chunk as Buffer);
    size += (chunk as Buffer).length;
  }
  return { sha256: digest.digest("hex"), size };
}

function isExecutable(name: ArtifactFile): boolean {
  return (GENERATION_EXECUTABLES as readonly string[]).includes(name);
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
 * Pack `stagingDir`'s five members directly into the gzipped `outPath` and return the archive's
 * own digest, without ever holding the archive (staged binaries can be hundreds of megabytes, and
 * a ~1 GB tar would otherwise need the whole input buffer plus a whole zlib output buffer in one
 * process).
 *
 * node-tar streams entry bytes straight into its own gzip stream and that stream straight into a
 * file descriptor (`file` + `sync: true` uses `PackSync` piped to a `WriteStreamSync`, chunk by
 * chunk - see `node_modules/tar/dist/commonjs/create.js`), so nothing here reads the archive back
 * into memory before it is hashed; `sha256File` streams the written file instead.
 *
 * Determinism comes from: an explicit file list in fixed order (never `.`, which would add the
 * `./` entry the installer rejects), `portable: true` (drops uid/gid/uname/atime/ctime from the
 * tar headers *and* zeroes the gzip header's mtime/OS byte - `portable` is threaded into the gzip
 * config by node-tar itself), a fixed tar `mtime`, and modes forced to 0755/0644.
 */
export async function packArchive(stagingDir: string, outPath: string): Promise<FileDigest> {
  normalizeStaging(stagingDir);
  mkdirSync(dirname(outPath), { recursive: true });
  await create(
    {
      cwd: stagingDir,
      file: outPath,
      gzip: { level: 9 },
      portable: true,
      mtime: ARCHIVE_MTIME,
      follow: false,
      sync: true,
    },
    [...ARCHIVE_ENTRIES],
  );
  return sha256File(outPath);
}

export async function fileDigests(stagingDir: string): Promise<Record<ArtifactFile, FileDigest>> {
  const out: Record<string, FileDigest> = {};
  for (const name of ARCHIVE_ENTRIES) out[name] = await sha256File(join(stagingDir, name));
  return out as Record<ArtifactFile, FileDigest>;
}

/**
 * `shasum -a 256` format, so the published list can be checked with the stock macOS tool.
 * Names are basenames only; the caller passes the files it actually wrote.
 */
export async function writeChecksums(outDir: string, filenames: readonly string[]): Promise<string> {
  const lines: string[] = [];
  for (const name of filenames) {
    if (name !== basename(name)) throw new Error(`checksum entry ${JSON.stringify(name)} must be a basename`);
    lines.push(`${(await sha256File(join(outDir, name))).sha256}  ${name}`);
  }
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
