import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { Context } from "../context";
import { platformFor } from "../distribution";
import type { Paths } from "../paths";
import {
  GENERATION_LEGAL_FILES,
  activeGeneration,
  insideGenerationsRoot,
  isGenerationDir,
  readInstallation,
  readPointer,
  type InstallationRecord,
} from "../patch/generation";
import { REQUIRED_TOOLCHAIN, preflight } from "../patch/preflight";
import type { State } from "../state";
import { VERSION } from "../version-info";
import type { DoctorLine } from "./doctor";

const line = (key: string, value: string, ok: boolean | null = null): DoctorLine => ({ key, value, ok });

const NO_GENERATION = "n/a (no active generation)";

export interface GenerationStatus {
  /** Validated metadata for the active generation, or null when there is none / it does not validate. */
  readonly record: InstallationRecord | null;
  /** Real directory of the active generation, or null when there is none we can trust. */
  readonly dir: string | null;
  readonly activeLine: DoctorLine;
  readonly generationLine: DoctorLine;
}

function resolvePointerTarget(paths: Paths, raw: string): string {
  return isAbsolute(raw) ? raw : resolve(dirname(paths.currentGeneration), raw);
}

/**
 * The `generation` line and, when it resolves, the real directory backing it.
 * `activeGeneration` already collapses "no pointer", "dangling" and "outside the managed root"
 * into a single null - here we re-derive which one it was, purely for the operator's benefit.
 */
function computeGenerationLine(paths: Paths, pointer: string | null): { readonly line: DoctorLine; readonly dir: string | null } {
  const dir = activeGeneration(paths);
  if (dir !== null) {
    if (!isGenerationDir(dir)) return { line: line("generation", "foreign", false), dir: null };
    return { line: line("generation", dir, true), dir };
  }
  if (pointer === null) return { line: line("generation", "none", null), dir: null };
  const abs = resolvePointerTarget(paths, pointer);
  if (!insideGenerationsRoot(paths, abs)) return { line: line("generation", "outside generations dir", false), dir: null };
  return { line: line("generation", "dangling", false), dir: null };
}

function computeActiveLine(record: InstallationRecord | null, pointer: string | null, dir: string | null): DoctorLine {
  if (record !== null) return line("active", `${record.provenance.source} ${record.codexVersion}`, true);
  if (pointer === null) return line("active", "none", null);
  // A pointer exists: either it never resolved to a real generation directory (broken link, in
  // all its forms - dangling, outside the root, or foreign), or it did but installation.json
  // failed validation (invalid metadata).
  return dir === null ? line("active", "broken link", false) : line("active", "invalid metadata", false);
}

/** Read the active generation, tolerating every way it can be broken. Read-only. */
export function classifyGeneration(paths: Paths): GenerationStatus {
  const pointer = readPointer(paths);
  const { line: generationLine, dir } = computeGenerationLine(paths, pointer);
  const record = readInstallation(paths);
  const activeLine = computeActiveLine(record, pointer, dir);
  return { record, dir, activeLine, generationLine };
}

function platformLine(): DoctorLine {
  try {
    return line("platform", platformFor(process.platform, process.arch), true);
  } catch {
    return line("platform", `unsupported ${process.platform}-${process.arch}`, false);
  }
}

function cxVersionLine(record: InstallationRecord | null): DoctorLine {
  if (!record) return line("cx_version", NO_GENERATION, null);
  const match = record.provenance.cxVersion === VERSION;
  return line("cx_version", `running ${VERSION} vs installed ${record.provenance.cxVersion}`, match);
}

function releaseLine(record: InstallationRecord | null): DoctorLine {
  if (!record) return line("release", NO_GENERATION, null);
  const { provenance } = record;
  if (provenance.source === "compiled") return line("release", "not a verified release (compiled locally)", null);
  if (!provenance.release) return line("release", "missing release metadata for a prebuilt install", false);
  return line("release", `${provenance.release.tag} archive ${provenance.release.archiveSha256.slice(0, 12)}`, true);
}

function patchLine(record: InstallationRecord | null): DoctorLine {
  if (!record) return line("patch", NO_GENERATION, null);
  return line("patch", record.provenance.patchSha256.slice(0, 12), null);
}

function sourceCommitLine(record: InstallationRecord | null): DoctorLine {
  if (!record) return line("source_commit", NO_GENERATION, null);
  const { sourceCommit, sourceDirty } = record.provenance;
  const base = sourceCommit ? sourceCommit.slice(0, 12) : "unknown";
  return line("source_commit", sourceDirty ? `${base} (dirty)` : base, sourceDirty ? false : null);
}

function upstreamCommitLine(record: InstallationRecord | null): DoctorLine {
  if (!record) return line("upstream_commit", NO_GENERATION, null);
  return line("upstream_commit", record.provenance.upstreamCommit.slice(0, 12), null);
}

/** Re-hash one executable from the active generation against the digest the record claims for it. */
function digestLine(key: "codex" | "codex-code-mode-host", label: string, record: InstallationRecord | null, dir: string | null): DoctorLine {
  if (!record || !dir) return line(label, NO_GENERATION, null);
  const file = join(dir, key);
  if (!existsSync(file)) return line(label, "missing", false);
  let buf: Buffer;
  try {
    buf = readFileSync(file);
  } catch (e) {
    return line(label, `unreadable: ${(e as Error).message.split("\n")[0]}`, false);
  }
  const got = { sha256: createHash("sha256").update(buf).digest("hex"), size: buf.length };
  const want = record.provenance.executables[key];
  const verified = got.sha256 === want.sha256 && got.size === want.size;
  return line(label, verified ? "verified" : "MISMATCH", verified);
}

/** Bounded probe of the active generation's own `codex --version`, expecting an exact match. */
function codexVersionLine(ctx: Context, record: InstallationRecord | null, dir: string | null): DoctorLine {
  if (!record || !dir) return line("codex_version", NO_GENERATION, null);
  const bin = join(dir, "codex");
  if (!existsSync(bin)) return line("codex_version", "missing", false);
  let result;
  try {
    result = ctx.run(bin, ["--version"], { timeoutMs: 30_000 });
  } catch (e) {
    return line("codex_version", `probe failed: ${(e as Error).message}`.slice(0, 200), false);
  }
  const expected = `codex-cli ${record.codexVersion}`;
  const out = result.stdout.trim().slice(0, 200);
  if (result.status === 0 && out === expected) return line("codex_version", out, true);
  const stderr = result.stderr.trim().slice(0, 200);
  return line("codex_version", `expected "${expected}", got "${out}"${stderr ? ` (stderr: ${stderr})` : ""}`, false);
}

function legalLine(record: InstallationRecord | null, dir: string | null): DoctorLine {
  if (!record) return line("legal", NO_GENERATION, null);
  if (record.provenance.source === "compiled") return line("legal", "n/a (compiled build)", null);
  if (!dir) return line("legal", NO_GENERATION, null);
  const missing = GENERATION_LEGAL_FILES.filter((f) => !existsSync(join(dir, f)));
  return missing.length === 0 ? line("legal", "present", true) : line("legal", `missing: ${missing.join(", ")}`, false);
}

/** platform, cx_version, release, patch, source_commit, upstream_commit, codex_digest, host_digest, codex_version, legal - in report order. */
export function generationDetailLines(ctx: Context, status: GenerationStatus): DoctorLine[] {
  const { record, dir } = status;
  return [
    platformLine(),
    cxVersionLine(record),
    releaseLine(record),
    patchLine(record),
    sourceCommitLine(record),
    upstreamCommitLine(record),
    digestLine("codex", "codex_digest", record, dir),
    digestLine("codex-code-mode-host", "host_digest", record, dir),
    codexVersionLine(ctx, record, dir),
    legalLine(record, dir),
  ];
}

/**
 * Toolchain is only load-bearing when we might compile: a prebuilt or absent install must never
 * fail doctor just because the operator has no Rust toolchain installed.
 */
export function toolchainLine(ctx: Context, source: "prebuilt" | "compiled" | "none"): DoctorLine {
  const pf = preflight({ which: ctx.which, run: ctx.run, freeBytes: ctx.freeBytes }, ctx.paths.shareDir);
  const detail = pf.ok ? `git, cargo and Rust ${REQUIRED_TOOLCHAIN} present; disk ok` : `${pf.reason} - ${pf.fix}`;
  if (source === "compiled") return line("toolchain", detail, pf.ok);
  return line("toolchain", `optional for prebuilt; ${detail}`, null);
}

/**
 * Metadata wins over state.json's `patched_from` (src/patch/generation.ts). When they disagree,
 * state.json was not updated after activation - surface that as its own failing line rather than
 * silently overriding it, so the stale write itself is visible and fixable.
 */
export function bookkeepingLine(state: State, record: InstallationRecord | null): DoctorLine | null {
  if (!record || state.patched_from === null || state.patched_from === record.codexVersion) return null;
  return line("bookkeeping", `state.json says ${state.patched_from}, active generation is ${record.codexVersion}`, false);
}

/**
 * Owners installed before generations existed still have the flat layout on disk. Once a
 * generation is active it is authoritative and the flat files are never reported again (revert
 * still cleans them up); until then, their presence without an active generation means a stuck
 * install that needs a manual revert + reinstall - doctor never fixes this itself.
 */
export function legacyLine(paths: Paths, record: InstallationRecord | null): DoctorLine | null {
  if (record !== null) return null;
  if (!existsSync(paths.patchedBin) && !existsSync(paths.patchedCodeModeHost)) return null;
  return line("legacy", "legacy layout: run cxstatusline revert then cxstatusline install", false);
}
