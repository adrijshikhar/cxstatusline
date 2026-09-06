import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import type { FileDigest, PreparedPair } from "../distribution";
import type { Paths } from "../paths";

/** The metadata file that makes a generation self-describing - and authoritative over state.json. */
export const INSTALLATION_FILE = "installation.json";

/** The two files that must always appear or disappear together. */
export const GENERATION_EXECUTABLES = ["codex", "codex-code-mode-host"] as const;

/** Shipped with prebuilt pairs; absent from locally compiled ones. */
export const GENERATION_LEGAL_FILES = ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md"] as const;

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

/** True when `child` really lives under `parent`, comparing real paths (/var vs /private/var). */
function contains(parent: string, child: string): boolean {
  const real = (p: string): string => {
    try {
      return realpathSync(p);
    } catch {
      return resolve(p);
    }
  };
  const root = real(parent);
  return real(child).startsWith(`${root}${sep}`);
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
  if (!contains(paths.generationsDir, abs)) return null;
  try {
    return statSync(abs).isDirectory() ? abs : null;
  } catch {
    return null;
  }
}

function isRecord(v: unknown): v is InstallationRecord {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  const p = r.provenance as Record<string, unknown> | undefined;
  return typeof r.codexVersion === "string"
    && typeof p === "object" && p !== null
    && (p.source === "prebuilt" || p.source === "compiled");
}

/**
 * What is actually installed, read from the active generation.
 * This - not state.json - is the answer to "which pair is active": a bookkeeping write that fails
 * after the pointer commit must not make doctor or the hook claim the old pair is still running.
 */
export function readInstallation(paths: Paths): InstallationRecord | null {
  const dir = activeGeneration(paths);
  if (dir === null) return null;
  try {
    const raw: unknown = JSON.parse(readFileSync(join(dir, INSTALLATION_FILE), "utf8"));
    return isRecord(raw) ? raw : null;
  } catch {
    return null;
  }
}
