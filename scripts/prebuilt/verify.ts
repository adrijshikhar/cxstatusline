/**
 * Post-package verification: re-derive every claim in the release directory from the bytes on
 * disk, using the installer's own archive validator and manifest schema rather than a second
 * implementation. A verify failure means the release must not be published.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateManifest, type Artifact, type Platform, type ReleaseManifest } from "../../src/distribution";
import { extractArchive } from "../../src/distribution/archive";
import { validateLinkage, validateVersion } from "../ci-prebuilt";
import { ARCHIVE_ENTRIES, parseChecksums, sha256File } from "./pack";
import { RUST_NOTICES_MARKER } from "./rust-licenses";

/** The deployment-target ceiling the release promises. */
export const MAX_MINOS = "14.0";

const MACHO_ARCH: Partial<Record<Platform, string>> = { "darwin-arm64": "arm64", "darwin-x64": "x86_64" };
const ELF_MACHINE: Partial<Record<Platform, string>> = {
  "linux-x64": "Advanced Micro Devices X86-64",
  "linux-arm64": "AArch64",
};

export interface VerifyOptions {
  readonly outDir: string;
  readonly cxVersion?: string;
  readonly codexVersion: string;
  readonly platform: Platform;
  /** Skip the `lipo`/`otool`/`vtool` probes. Only ever true for unit tests and non-macOS hosts. */
  readonly skipMacho: boolean;
}

export interface VerifyReport {
  readonly manifest: ReleaseManifest;
  readonly archive: string;
  readonly machoSkipped: boolean;
  readonly checks: readonly string[];
}

function parseVersionTuple(s: string): readonly number[] {
  const parts = s.split(".").map((p) => Number.parseInt(p, 10));
  if (parts.length === 0 || parts.some((n) => !Number.isInteger(n) || n < 0)) {
    throw new Error(`unusable macOS version ${JSON.stringify(s)}`);
  }
  return parts;
}

function compareVersions(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * Reject a binary whose Mach-O build version demands a newer macOS than the release promises.
 * Parsed from `vtool -show-build`; a missing `minos` line is a failure, not a pass, because it
 * means we have no evidence either way.
 */
export function validateMinos(vtoolOutput: string, max: string = MAX_MINOS): void {
  const match = /^\s*minos\s+(\d+(?:\.\d+)*)\s*$/m.exec(vtoolOutput);
  if (match === null) throw new Error("vtool -show-build printed no minos line; cannot prove the deployment target");
  if (compareVersions(parseVersionTuple(match[1]!), parseVersionTuple(max)) > 0) {
    throw new Error(`binary requires a minimum macOS of ${match[1]} which is newer than the promised ${max}`);
  }
}

function probe(command: string, args: readonly string[]): string {
  return execFileSync(command, [...args], { encoding: "utf8", timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
}

function readManifest(outDir: string, o: VerifyOptions): ReleaseManifest {
  const file = join(outDir, "manifest.json");
  if (!existsSync(file)) throw new Error(`${file} is missing; nothing to verify`);
  return validateManifest(JSON.parse(readFileSync(file, "utf8")), {
    cxVersion: o.cxVersion,
    codexVersion: o.codexVersion,
    platform: o.platform,
  });
}

/**
 * Every staged member's bytes must equal the digest the manifest published for it - for the
 * artifact the archive was actually chosen from, not `artifacts[0]`: the schema permits two, and
 * comparing an arm64 extract against the x64 artifact's digests would fail for the wrong reason.
 */
async function checkExtractedDigests(staged: string, artifact: Artifact, checks: string[]): Promise<void> {
  const files = artifact.files;
  for (const name of ARCHIVE_ENTRIES) {
    const actual = await sha256File(join(staged, name));
    const expected = files[name];
    if (actual.sha256 !== expected.sha256 || actual.size !== expected.size) {
      throw new Error(`extracted ${name} does not match the digest recorded in manifest.json`);
    }
  }
  checks.push("extracted files match manifest digests");
}

function checkMachO(staged: string, o: VerifyOptions, checks: string[]): void {
  for (const name of ["codex", "codex-code-mode-host"] as const) {
    const file = join(staged, name);
    const arch = probe("lipo", ["-archs", file]).trim();
    if (arch !== MACHO_ARCH[o.platform]) {
      throw new Error(`${name}: Mach-O architecture ${arch} does not match ${o.platform}`);
    }
    validateLinkage(probe("otool", ["-L", file]));
    validateMinos(probe("vtool", ["-show-build", file]));
  }
  checks.push("Mach-O arch/linkage/minos verified");
}

function checkElf(staged: string, o: VerifyOptions, checks: string[]): void {
  for (const name of ["codex", "codex-code-mode-host"] as const) {
    const file = join(staged, name);
    const header = probe("readelf", ["-h", file]);
    if (!header.includes("ELF64")) {
      throw new Error(`${name}: expected ELF64 binary`);
    }
    const expected = ELF_MACHINE[o.platform];
    if (expected && !header.includes(expected)) {
      throw new Error(`${name}: ELF machine does not match ${expected} for ${o.platform}`);
    }
    const dynamic = probe("readelf", ["-d", file]);
    if (!/dynamic section/i.test(dynamic) && !dynamic.includes("NEEDED") && !dynamic.includes("DYNAMIC")) {
      throw new Error(`${name}: binary is not dynamically linked`);
    }
  }
  checks.push("ELF arch/linkage verified");
}

function checkSmoke(staged: string, o: VerifyOptions, checks: string[]): void {
  validateVersion(probe(join(staged, "codex"), ["--version"]), o.codexVersion);
  if (!probe(join(staged, "codex-code-mode-host"), ["--help"]).includes("--listen")) {
    throw new Error("codex-code-mode-host --help does not advertise --listen");
  }
  checks.push("staged codex --version and companion --help smoke passed");
}

function checkRustNotices(staged: string, checks: string[]): void {
  const file = join(staged, "THIRD_PARTY_NOTICES.md");
  const content = readFileSync(file, "utf8");
  const markerIndex = content.indexOf(RUST_NOTICES_MARKER);
  if (markerIndex === -1) {
    throw new Error("Rust dependency notices marker is missing from THIRD_PARTY_NOTICES.md");
  }
  const afterMarker = content.slice(markerIndex + RUST_NOTICES_MARKER.length);
  const hasBullet = afterMarker.split("\n").some((line) => line.trimStart().startsWith("- "));
  if (!hasBullet) {
    throw new Error("Rust dependency notices contain no dependency entries");
  }
  checks.push("Rust dependency notices present");
}

/**
 * Verify `outDir` (archive + `manifest.json` + `SHA256SUMS`) end to end. Throws on the first
 * disagreement; a returned report is the evidence that publication may proceed.
 */
export async function verifyOutput(o: VerifyOptions): Promise<VerifyReport> {
  const manifest = readManifest(o.outDir, o);
  const artifact = manifest.artifacts.find((a) => a.platform === o.platform)!;
  const archivePath = join(o.outDir, artifact.filename);
  if (!existsSync(archivePath)) throw new Error(`${artifact.filename} is missing from ${o.outDir}`);

  const checks: string[] = [];
  const actual = await sha256File(archivePath);
  if (actual.sha256 !== artifact.sha256 || actual.size !== artifact.size) {
    throw new Error(`${artifact.filename} sha256/size does not match manifest.json`);
  }
  checks.push("archive sha256 matches manifest");

  const sums = parseChecksums(readFileSync(join(o.outDir, "SHA256SUMS"), "utf8"));
  if (sums[artifact.filename] !== artifact.sha256) throw new Error("SHA256SUMS disagrees with manifest.json");
  const manifestDigest = (await sha256File(join(o.outDir, "manifest.json"))).sha256;
  if (sums["manifest.json"] !== manifestDigest) throw new Error("SHA256SUMS does not match manifest.json's own bytes");
  checks.push("SHA256SUMS matches manifest");

  const staged = mkdtempSync(join(tmpdir(), "cxsl-verify-"));
  try {
    await extractArchive(archivePath, staged);
    checks.push("archive passes the installer's five-file validator");
    await checkExtractedDigests(staged, artifact, checks);
    checkRustNotices(staged, checks);
    if (o.skipMacho) {
      checks.push(o.platform.startsWith("linux-") ? "ELF arch/linkage SKIPPED" : "Mach-O arch/linkage/minos SKIPPED");
    } else if (o.platform.startsWith("linux-")) {
      checkElf(staged, o, checks);
    } else {
      checkMachO(staged, o, checks);
    }
    checkSmoke(staged, o, checks);
  } finally {
    rmSync(staged, { recursive: true, force: true });
  }
  return { manifest, archive: artifact.filename, machoSkipped: o.skipMacho, checks };
}
