import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { z } from "zod";
import { type FileDigest, type Platform, type PreparedPair, validateManifest } from "../distribution";
import { GENERATION_EXECUTABLES, GENERATION_LEGAL_FILES } from "../distribution/files";
import type { Paths } from "../paths";
import { parseSemver } from "../version";

/** The metadata file that makes a generation self-describing - and authoritative over state.json. */
export const INSTALLATION_FILE = "installation.json";

// The allowlist itself lives in the leaf module `src/distribution/files.ts` (no imports, so no
// cycle); re-exported here because a generation's layout *is* that allowlist.
export { GENERATION_EXECUTABLES, GENERATION_LEGAL_FILES };

/** A `PreparedPair` without its temporary staging directory - exactly what a generation records. */
export type InstallationRecord = Omit<PreparedPair, "directory">;

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;

function digestOf(file: string): FileDigest {
  const buf = readFileSync(file);
  return { sha256: createHash("sha256").update(buf).digest("hex"), size: buf.length };
}

/**
 * Compact, sortable stamp for the generation name: `20260907T121314`.
 * Names only have to be unique and legible; the authoritative timestamp is in installation.json.
 */
function stamp(installedAt: string): string {
  const parsed = new Date(installedAt);
  const when = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  return when.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "");
}

/** Nearest existing ancestor of `p`, so a real path can be computed for a target that does not exist. */
function nearestExisting(p: string): string {
  let cur = p;
  for (;;) {
    try {
      statSync(cur);
      return cur;
    } catch {
      const parent = dirname(cur);
      if (parent === cur) return cur;
      cur = parent;
    }
  }
}

/**
 * `p` resolved through any real symlinks in its existing ancestors, keeping the (possibly
 * nonexistent) tail verbatim - so e.g. macOS's `/tmp` -> `/private/tmp` is resolved consistently
 * whether or not the leaf itself exists yet, which a bare `realpathSync` fallback to `resolve()`
 * is not: a nonexistent path would compare against an unresolved prefix and look "outside" a root
 * it is really inside.
 */
function realish(p: string): string {
  const near = nearestExisting(p);
  return realpathSync(near) + resolve(p).slice(resolve(near).length);
}

/**
 * True when `candidate` really lives under `paths.generationsDir`, comparing real paths
 * (e.g. macOS's `/tmp` vs `/private/tmp`) even when `candidate` itself does not exist.
 */
export function insideGenerationsRoot(paths: Paths, candidate: string): boolean {
  return realish(candidate).startsWith(`${realish(paths.generationsDir)}${sep}`);
}

/**
 * Validate the staging directory the caller prepared: both executables present and byte-identical
 * to the digests recorded in the provenance, plus the legal texts a prebuilt pair must carry.
 * Why here and not only at download time: this is the last gate before bytes become runnable.
 */
function validateStaging(pair: PreparedPair): void {
  if (!SAFE_SEGMENT.test(pair.codexVersion)) {
    throw new Error(`prepared pair has an unusable codexVersion "${pair.codexVersion}"`);
  }
  for (const name of GENERATION_EXECUTABLES) {
    const file = join(pair.directory, name);
    if (!existsSync(file)) throw new Error(`staged pair is missing ${name}`);
    const want = pair.provenance.executables[name];
    const got = digestOf(file);
    if (got.sha256 !== want.sha256 || got.size !== want.size) {
      throw new Error(`staged ${name} does not match its recorded digest; refusing to install it`);
    }
  }
  if (pair.provenance.source === "prebuilt") {
    for (const name of GENERATION_LEGAL_FILES) {
      if (!existsSync(join(pair.directory, name))) throw new Error(`prebuilt pair is missing ${name}`);
    }
  }
}

function installationRecord(pair: PreparedPair): InstallationRecord {
  const { directory: _staging, ...record } = pair;
  return record;
}

function copyInto(from: string, into: string, name: string, mode: number, expected?: FileDigest): void {
  const target = join(into, name);
  copyFileSync(join(from, name), target);
  chmodSync(target, mode);
  if (!expected) return;
  const got = digestOf(target);
  if (got.sha256 !== expected.sha256 || got.size !== expected.size) {
    throw new Error(`${name} did not survive the copy into the new generation intact`);
  }
}

function commitJson(file: string, value: unknown, rename: typeof renameSync): void {
  const tmp = join(dirname(file), `.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  try {
    writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
    rename(tmp, file);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

function freshDirectory(pair: PreparedPair, paths: Paths): string {
  mkdirSync(paths.generationsDir, { recursive: true });
  for (;;) {
    const dir = join(paths.generationsDir, `${pair.codexVersion}-${stamp(pair.provenance.installedAt)}-${randomBytes(3).toString("hex")}`);
    if (existsSync(dir)) continue; // names are never reused, not even after a revert
    mkdirSync(dir);
    return dir;
  }
}

/**
 * Build one complete, immutable generation and return its path. It is not active yet: only
 * `swapPointer` makes it observable, so an interrupted build leaves an unreferenced directory.
 */
export function createGeneration(pair: PreparedPair, paths: Paths, rename: typeof renameSync = renameSync): string {
  validateStaging(pair);
  const dir = freshDirectory(pair, paths);
  try {
    for (const name of GENERATION_EXECUTABLES) copyInto(pair.directory, dir, name, 0o755, pair.provenance.executables[name]);
    for (const name of GENERATION_LEGAL_FILES) {
      if (existsSync(join(pair.directory, name))) copyInto(pair.directory, dir, name, 0o644);
    }
    // Last, so a directory carrying installation.json is by definition complete.
    commitJson(join(dir, INSTALLATION_FILE), installationRecord(pair), rename);
  } catch (e) {
    // Safe: `current` has never pointed here, so no live process can be running out of it.
    // Committed generations are never removed during activation.
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  return dir;
}

/** True for a directory that holds a complete cxstatusline generation. Used by `revert`. */
export function isGenerationDir(dir: string): boolean {
  return existsSync(join(dir, INSTALLATION_FILE)) && existsSync(join(dir, "codex"));
}

export function listGenerations(paths: Paths): string[] {
  try {
    return readdirSync(paths.generationsDir).map((name) => join(paths.generationsDir, name)).sort();
  } catch {
    return [];
  }
}

/** The raw target `current` points at, or null when there is no pointer. */
export function readPointer(paths: Paths): string | null {
  try {
    return readlinkSync(paths.currentGeneration);
  } catch {
    return null;
  }
}

/**
 * Point `current` at `target` with one `rename(2)`.
 * Staged as a sibling symlink so the pointer is never absent for even an instant.
 */
export function swapPointer(paths: Paths, target: string, rename: typeof renameSync = renameSync): void {
  const staged = `${paths.currentGeneration}.${randomBytes(4).toString("hex")}`;
  symlinkSync(target, staged);
  try {
    rename(staged, paths.currentGeneration);
  } catch (e) {
    rmSync(staged, { force: true });
    throw e;
  }
}

/** Put the pointer back where it was. `previous === null` means there was no pointer at all. */
export function restorePointer(paths: Paths, previous: string | null, rename: typeof renameSync = renameSync): void {
  if (previous === null) {
    rmSync(paths.currentGeneration, { force: true });
    return;
  }
  swapPointer(paths, previous, rename);
}

/**
 * The generation a fresh `codex` would run, or null when there is none we own.
 * A `current` that points anywhere outside the managed generations tree is not ours and is
 * reported as "no active generation" rather than trusted.
 */
export function activeGeneration(paths: Paths): string | null {
  const target = readPointer(paths);
  if (target === null) return null;
  const abs = isAbsolute(target) ? target : resolve(dirname(paths.currentGeneration), target);
  if (!insideGenerationsRoot(paths, abs)) return null;
  try {
    return statSync(abs).isDirectory() ? abs : null;
  } catch {
    return null;
  }
}

const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;

const DigestSchema = z.object({
  sha256: z.string().regex(HEX64, "sha256 must be 64 lowercase hex chars"),
  size: z.number().refine((n) => Number.isSafeInteger(n) && n > 0, "size must be a positive safe integer"),
});

const StableVersion = z
  .string()
  .refine((v) => {
    const parsed = parseSemver(v);
    return parsed !== null && parsed.pre === null;
  }, "must be a stable three-part semver");

/**
 * The full `PreparedPair`-minus-`directory` shape. Task 2 re-hashes from `provenance.executables`
 * and re-uses `provenance.release.manifest`, so every field it reads has to be validated here:
 * a truncated or hand-edited installation.json must not be trusted just because it parses.
 */
const RecordSchema = z.object({
  codexVersion: StableVersion,
  provenance: z.object({
    source: z.enum(["prebuilt", "compiled"]),
    cxVersion: z.string(),
    platform: z.string(),
    patchSha256: z.string().regex(HEX64, "patchSha256 must be 64 lowercase hex chars"),
    upstreamCommit: z.string().regex(HEX40, "upstreamCommit must be 40 lowercase hex chars"),
    sourceCommit: z.string().regex(HEX40, "sourceCommit must be 40 lowercase hex chars").nullable(),
    sourceDirty: z.boolean(),
    installedAt: z.string(),
    executables: z.object({ codex: DigestSchema, "codex-code-mode-host": DigestSchema }),
    release: z
      .object({
        tag: z.string(),
        archiveSha256: z.string().regex(HEX64, "archiveSha256 must be 64 lowercase hex chars"),
        manifest: z.record(z.string(), z.unknown()),
      })
      .optional(),
  }),
});

/**
 * Structural validation, plus the exact-release check for a prebuilt pair: the embedded manifest is
 * re-validated with `validateManifest` against the identity the record itself claims, so a record
 * can never carry a manifest describing some other release.
 */
function checkedRecord(v: unknown): InstallationRecord | null {
  const parsed = RecordSchema.safeParse(v);
  if (!parsed.success) return null;
  const { provenance } = parsed.data;
  if (!provenance.release) return parsed.data as unknown as InstallationRecord;
  try {
    const manifest = validateManifest(provenance.release.manifest, {
      cxVersion: provenance.cxVersion,
      codexVersion: parsed.data.codexVersion,
      platform: provenance.platform as Platform,
    });
    const release = { ...provenance.release, manifest };
    return { ...parsed.data, provenance: { ...provenance, release } } as unknown as InstallationRecord;
  } catch {
    return null;
  }
}

/**
 * What is actually installed, read from the active generation.
 * This - not state.json - is the answer to "which pair is active": a bookkeeping write that fails
 * after the pointer commit must not make doctor or the hook claim the old pair is still running.
 * Metadata that does not fully validate means null: a generation without valid metadata is not a
 * complete generation, and callers must not act on half of a record.
 */
export function readInstallation(paths: Paths): InstallationRecord | null {
  const dir = activeGeneration(paths);
  if (dir === null) return null;
  try {
    const raw: unknown = JSON.parse(readFileSync(join(dir, INSTALLATION_FILE), "utf8"));
    return checkedRecord(raw);
  } catch {
    return null;
  }
}
