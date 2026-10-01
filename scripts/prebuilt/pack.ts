/**
 * Deterministic packaging of a release archive: upstream's package directory (built by upstream's
 * own `scripts/build_codex_package.py` from our patched binaries) plus our three legal files.
 *
 * "Deterministic" here means exactly one thing: identical staged inputs produce identical archive
 * bytes. It is not a claim that the Rust build itself is bit-reproducible.
 */
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { create } from "tar";
import { sha256File, type FileDigest } from "../../src/digest";
import { modeFor, type Platform } from "../../src/distribution";
import { packageFiles } from "../../src/patch/generation";
import { appendRustNotices, appendToolNotices } from "./rust-licenses";

export { sha256File };

/** The three files this repository adds at the package root. Everything else is upstream's. */
export const LEGAL_FILES = ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md"] as const;

/** Top-level names a staged package may contain; the reset guard in `assemble` checks this. */
export const STAGING_TOP_LEVEL: readonly string[] = ["bin", "codex-path", "codex-resources", "codex-package.json", ...LEGAL_FILES];

/**
 * A fixed archive timestamp. Real mtimes are build-machine noise that would make two packs of the
 * same bytes differ; the true provenance lives in `manifest.json`, not in tar headers.
 */
export const ARCHIVE_MTIME = new Date("2000-01-01T00:00:00.000Z");

export function archiveFilename(codexVersion: string, platform: Platform): string {
  return `cxstatusline-codex-${codexVersion}-${platform}.tar.gz`;
}

/**
 * Every member must be a non-empty regular file; modes are forced to the one rule (`modeFor`)
 * before packing so the archive never depends on the umask of the machine that built it.
 */
function normalizeStaging(stagingDir: string): string[] {
  const members = Object.keys(packageFiles(stagingDir)).sort();
  if (members.length === 0) throw new Error(`${stagingDir} holds no files to pack`);
  for (const name of members) {
    const file = join(stagingDir, name);
    if (lstatSync(file).size === 0) throw new Error(`staged ${name} is empty`);
    chmodSync(file, modeFor(name));
  }
  return members;
}

/**
 * Pack the staged package directly into the gzipped `outPath` and return the archive's own digest,
 * without ever holding the archive in memory (staged binaries are hundreds of megabytes).
 *
 * node-tar streams entry bytes straight into its own gzip stream and that stream straight into a
 * file descriptor (`file` + `sync: true`), so nothing here reads the archive back into memory
 * before it is hashed; `sha256File` streams the written file instead.
 *
 * Determinism comes from: an explicit, sorted file list (never `.`, which would add the `./` entry
 * the installer rejects; never a directory entry), `portable: true` (drops uid/gid/uname/atime/
 * ctime from the tar headers and zeroes the gzip header's mtime/OS byte), a fixed tar `mtime`,
 * `follow: false`, and modes forced by `modeFor`.
 */
export async function packArchive(stagingDir: string, outPath: string): Promise<FileDigest> {
  const members = normalizeStaging(stagingDir);
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
    members,
  );
  return sha256File(outPath);
}

/** The manifest's `files` map for a staged package: every member path with its digest. */
export function fileDigests(stagingDir: string): Record<string, FileDigest> {
  return packageFiles(stagingDir);
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
  /** The package directory upstream's `build_codex_package.py` wrote (`bin/`, `codex-path/`, ...). */
  readonly packageDir: string;
  /** The patched upstream Codex checkout, source of upstream's LICENSE and NOTICE and the vendored bubblewrap COPYING. */
  readonly upstreamDir: string;
  /** This repository's root, source of `THIRD_PARTY_NOTICES.md`. */
  readonly repoRoot: string;
  readonly rustNotices?: string;
}

/**
 * Add this repository's three legal files to an upstream package directory, then the generated
 * Rust dependency notices and the verbatim licences of the tools upstream bundled. Must run
 * after `build_codex_package.py`, which wipes its `--package-dir` on `--force`.
 */
export function assembleStaging(input: AssembleInput): void {
  if (!existsSync(join(input.packageDir, "bin", "codex")) || !existsSync(join(input.packageDir, "codex-package.json"))) {
    throw new Error(`${input.packageDir} is not a Codex package directory (no bin/codex or codex-package.json); run assemble first`);
  }
  const sources: Record<(typeof LEGAL_FILES)[number], string> = {
    "LICENSE": join(input.upstreamDir, "LICENSE"),
    "NOTICE": join(input.upstreamDir, "NOTICE"),
    "THIRD_PARTY_NOTICES.md": join(input.repoRoot, "THIRD_PARTY_NOTICES.md"),
  };
  for (const name of LEGAL_FILES) {
    copyFileSync(sources[name], join(input.packageDir, name));
    chmodSync(join(input.packageDir, name), modeFor(name));
  }
  if (input.rustNotices !== undefined) appendRustNotices(input.packageDir, input.rustNotices);
  appendToolNotices(input.packageDir, input.upstreamDir);
}
