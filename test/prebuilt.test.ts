import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { list } from "tar";
import {
  ARCHIVE_ENTRIES,
  ARCHIVE_MTIME,
  archiveFilename,
  blockedIssueTitle,
  buildManifest,
  packArchive,
  resetDirectory,
  resolveDetection,
  selectStableVersion,
  validateMinos,
  verifyOutput,
  writeChecksums,
  type ManifestInput,
} from "../scripts/prebuilt";
import { extractArchive } from "../src/distribution/archive";
import { validateManifest, type ArtifactFile, type FileDigest } from "../src/distribution";
import type { Manifest } from "../src/patch/manifest";

const CX = "0.1.0";
const CODEX = "0.153.0";
const SHA40 = "a".repeat(40);
const RUN_URL = "https://github.com/adrijshikhar/cxstatusline/actions/runs/42";

const patchManifest: Manifest = {
  version: 1,
  tag_prefix: "rust-v",
  candidate: CODEX,
  patches: [
    { min: "0.152.1", max: "0.152.1", file: "codex-0.152.1.patch" },
    { min: "0.153.0", max: "0.153.0", file: "codex-0.153.0.patch" },
  ],
};

const rel = (tag: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  draft: false,
  prerelease: false,
  ...extra,
});

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `cxsl-prebuilt-${prefix}-`));
}

/** A staging directory holding the five archive members, with the release's exact modes. */
function staging(body = "#!/bin/sh\necho stub\n"): string {
  const dir = tmp("staging");
  for (const name of ARCHIVE_ENTRIES) {
    const executable = name === "codex" || name === "codex-code-mode-host";
    writeFileSync(join(dir, name), executable ? body : `${name} text\n`);
    chmodSync(join(dir, name), executable ? 0o755 : 0o644);
  }
  return dir;
}

/** Fake executables whose smoke output is exactly what `verify` demands. */
function smokeStaging(version = CODEX): string {
  const dir = tmp("smoke");
  writeFileSync(join(dir, "codex"), `#!/bin/sh\necho "codex-cli ${version}"\n`);
  writeFileSync(join(dir, "codex-code-mode-host"), '#!/bin/sh\necho "usage: --listen <addr>"\n');
  chmodSync(join(dir, "codex"), 0o755);
  chmodSync(join(dir, "codex-code-mode-host"), 0o755);
  for (const name of ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md"]) {
    writeFileSync(join(dir, name), `${name} text\n`);
    chmodSync(join(dir, name), 0o644);
  }
  return dir;
}

function digests(stagingDir: string): Record<ArtifactFile, FileDigest> {
  const out: Record<string, FileDigest> = {};
  for (const name of ARCHIVE_ENTRIES) {
    const bytes = readFileSync(join(stagingDir, name));
    out[name] = { sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
  }
  return out as Record<ArtifactFile, FileDigest>;
}

function manifestInput(stagingDir: string, archive: FileDigest): ManifestInput {
  return {
    cxVersion: CX,
    codexVersion: CODEX,
    platform: "darwin-arm64",
    upstreamCommit: "b".repeat(40),
    patchSha256: "c".repeat(64),
    sourceCommit: SHA40,
    workflowUrl: RUN_URL,
    createdAt: "2026-09-07T00:00:00Z",
    archive,
    files: digests(stagingDir),
  };
}

/** Build a complete, self-consistent `out/` (archive + manifest.json + SHA256SUMS). */
async function releaseDir(stagingDir: string): Promise<string> {
  const out = tmp("out");
  const filename = archiveFilename(CODEX, "darwin-arm64");
  const archive = await packArchive(stagingDir, join(out, filename));
  const manifest = buildManifest(manifestInput(stagingDir, archive));
  writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeChecksums(out, [filename, "manifest.json"]);
  return out;
}

describe("selectStableVersion", () => {
  test("picks the highest stable semver, not the lexicographically largest tag", () => {
    expect(selectStableVersion([rel("rust-v0.99.0"), rel("rust-v0.153.0"), rel("rust-v0.152.1")])).toBe("0.153.0");
  });

  test("excludes prereleases, drafts and malformed tags", () => {
    const releases = [
      rel("rust-v0.152.1"),
      rel("rust-v0.154.0", { prerelease: true }),
      rel("rust-v0.155.0", { draft: true }),
      rel("rust-v0.156.0-alpha.1"),
      rel("rust-v0.157"),
      rel("v0.158.0"),
      rel("rust-vnope"),
      { tag_name: 42 },
      null,
    ];
    expect(selectStableVersion(releases)).toBe("0.152.1");
  });

  test("rejects a non-array payload and an array with no usable stable release", () => {
    expect(() => selectStableVersion({ tag_name: "rust-v0.153.0" })).toThrow(/list of releases/);
    expect(() => selectStableVersion([rel("rust-v0.1.0-rc.1")])).toThrow(/no stable/);
  });
});

describe("blockedIssueTitle", () => {
  test("uses the detection title for null and a version title otherwise", () => {
    expect(blockedIssueTitle(null)).toBe("Prebuilt blocked: upstream detection");
    expect(blockedIssueTitle("0.153.0")).toBe("Prebuilt blocked: Codex 0.153.0");
  });
});

describe("resolveDetection", () => {
  test("returns the release identity for a covered version", () => {
    expect(resolveDetection(patchManifest, CODEX, CX)).toEqual({
      codexVersion: CODEX,
      cxVersion: CX,
      tag: `cxstatusline-v${CX}-codex-v${CODEX}`,
      upstreamTag: `rust-v${CODEX}`,
      patchFile: `codex-${CODEX}.patch`,
    });
  });

  test("fails naming both the uncovered upstream version and the supported candidate", () => {
    expect(() => resolveDetection(patchManifest, "0.154.0", CX)).toThrow(/0\.154\.0/);
    expect(() => resolveDetection(patchManifest, "0.154.0", CX)).toThrow(/0\.153\.0/);
  });

  test("refuses a non-stable upstream version and a non-stable cx version", () => {
    expect(() => resolveDetection(patchManifest, "0.153.0-rc.1", CX)).toThrow(/stable/);
    expect(() => resolveDetection(patchManifest, CODEX, "0.1.0-rc.1")).toThrow(/stable/);
  });
});

describe("buildManifest", () => {
  test("round-trips through the installer's validateManifest", async () => {
    const dir = staging();
    const archive = await packArchive(dir, join(tmp("pack"), archiveFilename(CODEX, "darwin-arm64")));
    const manifest = buildManifest(manifestInput(dir, archive));
    const parsed = validateManifest(JSON.parse(JSON.stringify(manifest)), {
      cxVersion: CX,
      codexVersion: CODEX,
      platform: "darwin-arm64",
    });
    expect(parsed.artifacts).toHaveLength(1);
    expect(parsed.artifacts[0]!.filename).toBe(`cxstatusline-codex-${CODEX}-darwin-arm64.tar.gz`);
    expect(parsed.upstreamTag).toBe(`rust-v${CODEX}`);
    expect(parsed.patchFile).toBe(`codex-${CODEX}.patch`);
  });
});

describe("packArchive", () => {
  test("identical inputs produce byte-identical archives even when file mtimes differ", async () => {
    const dir = staging();
    const a = join(tmp("a"), "one.tar.gz");
    const b = join(tmp("b"), "two.tar.gz");
    const first = await packArchive(dir, a);
    // Re-stamping the staged files is what a second CI run looks like: same bytes, new mtimes.
    for (const name of ARCHIVE_ENTRIES) utimesSync(join(dir, name), new Date(1e9), new Date(1e9));
    const second = await packArchive(dir, b);
    expect(readFileSync(a).equals(readFileSync(b))).toBe(true);
    expect(second).toEqual(first);
  });

  test("different inputs produce different archives", async () => {
    const one = join(tmp("d"), "one.tar.gz");
    const two = join(tmp("e"), "two.tar.gz");
    await packArchive(staging("#!/bin/sh\necho one\n"), one);
    await packArchive(staging("#!/bin/sh\necho two\n"), two);
    expect(readFileSync(one).equals(readFileSync(two))).toBe(false);
  });

  test("holds exactly the five expected entries in fixed order, with no './' entry", async () => {
    const archivePath = join(tmp("c"), "release.tar.gz");
    await packArchive(staging(), archivePath);
    const entries: { path: string; mode: number; mtime: Date | undefined }[] = [];
    await list({
      file: archivePath,
      onReadEntry: (e) => entries.push({ path: e.path, mode: e.mode ?? 0, mtime: e.mtime }),
    });
    expect(entries.map((e) => e.path)).toEqual([...ARCHIVE_ENTRIES]);
    expect(entries.map((e) => e.mode & 0o777)).toEqual([0o755, 0o755, 0o644, 0o644, 0o644]);
    expect(entries.every((e) => e.mtime?.getTime() === ARCHIVE_MTIME.getTime())).toBe(true);
  });

  test("the archive passes the installer's five-file validator", async () => {
    const dir = staging();
    const archivePath = join(tmp("f"), "release.tar.gz");
    await packArchive(dir, archivePath);
    const restored = tmp("restored");
    await extractArchive(archivePath, restored);
    for (const name of ARCHIVE_ENTRIES) expect(readFileSync(join(restored, name)).length).toBeGreaterThan(0);
  });

  test("refuses to pack an empty or missing member", async () => {
    const dir = staging();
    writeFileSync(join(dir, "NOTICE"), "");
    await expect(packArchive(dir, join(tmp("g"), "x.tar.gz"))).rejects.toThrow(/NOTICE is empty/);
    const bare = tmp("bare");
    await expect(packArchive(bare, join(tmp("h"), "y.tar.gz"))).rejects.toThrow();
  });
});

describe("writeChecksums", () => {
  test("SHA256SUMS agrees with the digests recorded in the manifest", async () => {
    const out = await releaseDir(staging());
    const filename = archiveFilename(CODEX, "darwin-arm64");
    const sums = readFileSync(join(out, "SHA256SUMS"), "utf8").trimEnd().split("\n");
    const entry = sums.find((line) => line.endsWith(`  ${filename}`));
    const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8")) as { artifacts: [{ sha256: string }] };
    expect(entry?.split("  ")[0]).toBe(manifest.artifacts[0].sha256);
    expect(sums).toHaveLength(2);
  });
});

describe("resetDirectory", () => {
  test("clears a directory it recognises and refuses one it does not", () => {
    const ours = staging();
    resetDirectory(ours, (e) => e.every((n) => (ARCHIVE_ENTRIES as readonly string[]).includes(n)));
    expect(existsSync(ours)).toBe(false);

    const theirs = tmp("theirs");
    writeFileSync(join(theirs, "keep.txt"), "precious\n");
    expect(() => resetDirectory(theirs, (e) => e.includes(".git"))).toThrow(/refusing to delete/);
    expect(readFileSync(join(theirs, "keep.txt"), "utf8")).toBe("precious\n");
  });

  test("an absent or empty directory is a no-op, not an error", () => {
    const empty = tmp("empty-reset");
    resetDirectory(empty, () => false);
    expect(existsSync(empty)).toBe(false);
    resetDirectory(join(empty, "gone"), () => false);
  });
});

describe("validateMinos", () => {
  test("accepts a deployment target at or below the ceiling and rejects a higher one", () => {
    expect(() => validateMinos("    platform macos\n    minos 14.0\n    sdk 15.0\n", "14.0")).not.toThrow();
    expect(() => validateMinos("    minos 13.5\n", "14.0")).not.toThrow();
    expect(() => validateMinos("    minos 15.0\n", "14.0")).toThrow(/minimum/);
    expect(() => validateMinos("no build version here\n", "14.0")).toThrow(/minos/);
  });
});

describe("verifyOutput", () => {
  test("accepts a self-consistent release directory and reports the skipped Mach-O probes", async () => {
    const out = await releaseDir(smokeStaging());
    const report = await verifyOutput({
      outDir: out,
      cxVersion: CX,
      codexVersion: CODEX,
      platform: "darwin-arm64",
      skipMacho: true,
    });
    expect(report.machoSkipped).toBe(true);
    expect(report.manifest.cxVersion).toBe(CX);
    expect(report.checks).toContain("archive sha256 matches manifest");
    expect(report.checks).toContain("SHA256SUMS matches manifest");
    expect(report.checks).toContain("Mach-O arch/linkage/minos SKIPPED");
  });

  test("rejects a tampered archive whose bytes no longer match the manifest", async () => {
    const out = await releaseDir(smokeStaging());
    const archivePath = join(out, archiveFilename(CODEX, "darwin-arm64"));
    const bytes = readFileSync(archivePath);
    bytes[bytes.length - 1] = (bytes.at(-1)! ^ 0xff) & 0xff;
    writeFileSync(archivePath, bytes);
    await expect(
      verifyOutput({ outDir: out, cxVersion: CX, codexVersion: CODEX, platform: "darwin-arm64", skipMacho: true }),
    ).rejects.toThrow(/sha256|SHA256SUMS/);
  });

  test("rejects a staged codex whose --version disagrees with the release", async () => {
    const out = await releaseDir(smokeStaging("0.152.1"));
    await expect(
      verifyOutput({ outDir: out, cxVersion: CX, codexVersion: CODEX, platform: "darwin-arm64", skipMacho: true }),
    ).rejects.toThrow(/version/);
  });

  test("rejects an output directory with no manifest", async () => {
    const out = tmp("empty");
    mkdirSync(out, { recursive: true });
    await expect(
      verifyOutput({ outDir: out, cxVersion: CX, codexVersion: CODEX, platform: "darwin-arm64", skipMacho: true }),
    ).rejects.toThrow(/manifest\.json/);
  });
});
