import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  utimesSync,
  writeFileSync,
  writeSync,
} from "node:fs";
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
  runPackage,
  selectStableVersion,
  sourceCommit,
  UncoveredUpstreamError,
  validateMinos,
  verifyOutput,
  writeChecksums,
  type ManifestInput,
} from "../scripts/prebuilt";
import { RUST_NOTICES_MARKER } from "../scripts/prebuilt/rust-licenses";
import { extractArchive } from "../src/distribution/archive";
import { validateManifest, type ArtifactFile, type FileDigest, type Platform } from "../src/distribution";
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
    const text = name === "THIRD_PARTY_NOTICES.md"
      ? `THIRD_PARTY_NOTICES.md text\n\n${RUST_NOTICES_MARKER}\n\n- crate-a 1.0.0 (MIT)\n`
      : `${name} text\n`;
    writeFileSync(join(dir, name), executable ? body : text);
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
  for (const name of ["LICENSE", "NOTICE"]) {
    writeFileSync(join(dir, name), `${name} text\n`);
    chmodSync(join(dir, name), 0o644);
  }
  writeFileSync(
    join(dir, "THIRD_PARTY_NOTICES.md"),
    `THIRD_PARTY_NOTICES.md text\n\n${RUST_NOTICES_MARKER}\n\n- crate-a 1.0.0 (MIT)\n`,
  );
  chmodSync(join(dir, "THIRD_PARTY_NOTICES.md"), 0o644);
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

function manifestInput(stagingDir: string, archive: FileDigest, over: Partial<ManifestInput> = {}): ManifestInput {
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
    ...over,
  };
}

/** Build a complete, self-consistent `out/` (archive + manifest.json + SHA256SUMS). */
async function releaseDir(stagingDir: string, platform: Platform = "darwin-arm64"): Promise<string> {
  const out = tmp("out");
  const filename = archiveFilename(CODEX, platform);
  const archive = await packArchive(stagingDir, join(out, filename));
  const manifest = buildManifest(manifestInput(stagingDir, archive, { platform }));
  writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeChecksums(out, [filename, "manifest.json"]);
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
      tag: `codex-v${CODEX}`,
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

  // Finding #2: `detect`'s CLI must exit 3 (blocked-issue summary) only for the coverage failure
  // below, and exit 1 (plain error) for everything else - a malformed manifest or a bad input
  // version. The discriminator the CLI uses is `instanceof UncoveredUpstreamError`, so these two
  // tests pin that only the coverage failure carries that type.
  test("only the uncovered-upstream failure is an UncoveredUpstreamError", () => {
    expect(() => resolveDetection(patchManifest, "0.154.0", CX)).toThrow(UncoveredUpstreamError);
  });

  test("a non-stable input version is a plain error, not UncoveredUpstreamError", () => {
    try {
      resolveDetection(patchManifest, "0.153.0-rc.1", CX);
      throw new Error("expected resolveDetection to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect(e).not.toBeInstanceOf(UncoveredUpstreamError);
    }
  });
});

describe("detect CLI exit codes", () => {
  const root = join(import.meta.dir, "..");

  function runDetectCli(codexVersion: string): { status: number; stderr: string } {
    const env = { ...process.env };
    delete env.GITHUB_STEP_SUMMARY;
    delete env.GITHUB_OUTPUT;
    delete env.GITHUB_EVENT_NAME;
    try {
      execFileSync(process.execPath, ["scripts/prebuilt.ts", "detect", "--codex-version", codexVersion, "--event", "workflow_dispatch"], {
        cwd: root,
        encoding: "utf8",
        env,
      });
      return { status: 0, stderr: "" };
    } catch (e) {
      const err = e as { status: number | null; stderr: string };
      return { status: err.status ?? -1, stderr: err.stderr };
    }
  }

  test("an upstream version not covered by patches/manifest.json exits 3 with the blocked summary", () => {
    const { status, stderr } = runDetectCli("9.9.9");
    expect(status).toBe(3);
    expect(stderr).toContain("Prebuilt blocked: Codex 9.9.9");
  });

  test("the blocked summary never reaches an inherited GITHUB_STEP_SUMMARY", () => {
    const summaryFile = join(tmp("summary-leak"), "summary.md");
    writeFileSync(summaryFile, "");
    const previous = process.env.GITHUB_STEP_SUMMARY;
    process.env.GITHUB_STEP_SUMMARY = summaryFile;
    try {
      expect(runDetectCli("9.9.9").status).toBe(3);
      expect(readFileSync(summaryFile, "utf8")).toBe("");
    } finally {
      if (previous === undefined) delete process.env.GITHUB_STEP_SUMMARY;
      else process.env.GITHUB_STEP_SUMMARY = previous;
    }
  });

  test("detect CLI exit codes isolate from an inherited GITHUB_EVENT_NAME=schedule", () => {
    const previous = process.env.GITHUB_EVENT_NAME;
    process.env.GITHUB_EVENT_NAME = "schedule";
    try {
      expect(runDetectCli("9.9.9").status).toBe(3);
    } finally {
      if (previous === undefined) delete process.env.GITHUB_EVENT_NAME;
      else process.env.GITHUB_EVENT_NAME = previous;
    }
  });

  test("a malformed --codex-version exits 1 with a plain error and no blocked summary", () => {
    const { status, stderr } = runDetectCli("not-a-version");
    expect(status).toBe(1);
    expect(stderr).not.toContain("Prebuilt blocked");
    expect(stderr).toMatch(/stable/);
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

// ---------------------------------------------------------------------------
// The source commit stamped into the manifest. `GITHUB_SHA` is never it: on a scheduled run it
// stays at the default-branch head while the build is checked out at the frozen source commit.
// ---------------------------------------------------------------------------

/** An upstream checkout shaped exactly like the one `native` hands to `package`. */
function upstreamCheckout(): string {
  const dir = tmp("upstream");
  const release = join(dir, "codex-rs", "target", "release");
  mkdirSync(release, { recursive: true });
  writeFileSync(join(release, "codex"), `#!/bin/sh\necho "codex-cli ${CODEX}"\n`);
  writeFileSync(join(release, "codex-code-mode-host"), '#!/bin/sh\necho "usage: --listen <addr>"\n');
  writeFileSync(join(dir, "LICENSE"), "upstream LICENSE\n");
  writeFileSync(join(dir, "NOTICE"), "upstream NOTICE\n");
  const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  git("init", "-q");
  git("add", "-A");
  git("-c", "user.email=t@example.invalid", "-c", "user.name=t", "commit", "-q", "-m", "upstream");
  return dir;
}

describe("sourceCommit", () => {
  test("returns an explicit 40-hex commit and ignores GITHUB_SHA", () => {
    const previous = process.env.GITHUB_SHA;
    process.env.GITHUB_SHA = "f".repeat(40);
    try {
      expect(sourceCommit("e".repeat(40))).toBe("e".repeat(40));
      expect(sourceCommit()).not.toBe("f".repeat(40));
    } finally {
      if (previous === undefined) delete process.env.GITHUB_SHA;
      else process.env.GITHUB_SHA = previous;
    }
  });

  test("refuses anything that is not a 40-hex commit", () => {
    expect(() => sourceCommit("HEAD")).toThrow(/not a 40-hex commit/);
  });
});

describe("runPackage", () => {
  const frozen = "e".repeat(40);
  const noticesFile = join(tmp("notices"), "rust-notices.md");
  writeFileSync(noticesFile, "## crate-a 1.0.0 (MIT)\n\nMIT text\n");
  const packageFlags = (upstream: string, out: string): Record<string, string> => ({
    "codex-version": CODEX,
    "cx-version": CX,
    "source-commit": frozen,
    "rust-notices": noticesFile,
    upstream,
    staging: join(tmp("staging-run"), "staged"),
    out,
    "workflow-url": RUN_URL,
  });

  // Derives the platform from the running machine, so it only means anything on macOS.
  test.skipIf(process.platform !== "darwin")("stamps the explicit source commit, not GITHUB_SHA", async () => {
    const out = tmp("out-run");
    const previous = process.env.GITHUB_SHA;
    process.env.GITHUB_SHA = "f".repeat(40);
    try {
      await runPackage(packageFlags(upstreamCheckout(), out));
    } finally {
      if (previous === undefined) delete process.env.GITHUB_SHA;
      else process.env.GITHUB_SHA = previous;
    }
    const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8")) as { sourceCommit: string };
    expect(manifest.sourceCommit).toBe(frozen);
  });

  test("refuses to package without an explicit source commit", async () => {
    const flags = packageFlags(tmp("upstream-unused"), tmp("out-unused"));
    delete flags["source-commit"];
    await expect(runPackage(flags)).rejects.toThrow(/--source-commit is required/);
  });

  test("refuses to package without --rust-notices", async () => {
    const flags = packageFlags(tmp("upstream-unused"), tmp("out-unused"));
    delete flags["rust-notices"];
    await expect(runPackage(flags)).rejects.toThrow(/--rust-notices <file> is required/);
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

describe("packArchive memory behaviour", () => {
  test("packs a large synthetic member without reading the archive whole into memory", async () => {
    // 64 MiB is large enough that a naive `readFileSync(tar)` + `gzipSync(...)` (or a
    // non-streaming sha256) would show up as a clear step in heap growth; it is still small
    // enough to keep the test fast.
    const SIZE = 64 * 1024 * 1024;
    const dir = staging();
    // Deterministic, compressible-but-not-trivially-empty content, written in chunks so the test
    // itself does not need a single 64 MiB allocation either.
    const fh = openSync(join(dir, "codex"), "w");
    const chunk = Buffer.alloc(1024 * 1024);
    for (let i = 0; i < chunk.length; i += 1) chunk[i] = i % 256;
    try {
      for (let written = 0; written < SIZE; written += chunk.length) writeSync(fh, chunk);
    } finally {
      closeSync(fh);
    }
    chmodSync(join(dir, "codex"), 0o755);

    // `Bun.gc(true)` forces a synchronous collection so the before/after heap snapshots reflect
    // live retained memory rather than not-yet-swept garbage (bun test does not run with
    // `--expose-gc`, so `global.gc` is unavailable here).
    Bun.gc(true);
    const before = process.memoryUsage().heapUsed;
    const archivePath = join(tmp("big"), "big.tar.gz");
    const digest = await packArchive(dir, archivePath);
    Bun.gc(true);
    const after = process.memoryUsage().heapUsed;

    expect(digest.size).toBeGreaterThan(0);
    // Streaming packaging and hashing should never need to hold the ~64 MiB payload (let alone a
    // second ~64 MiB gzip buffer) on the JS heap at once; a generous 40 MiB ceiling - well under
    // the 64 MiB payload, let alone 2x it - still catches a regression back to
    // `readFileSync`/`gzipSync` while tolerating normal heap noise from a forced GC pass.
    expect(after - before).toBeLessThan(40 * 1024 * 1024);
  }, 30_000);

  test("code structure: pack.ts never reads a whole archive/tar file into memory", () => {
    // Reviewer finding #1 asked for either a runtime proof or a structural assertion "if that is
    // not feasible" - the runtime proof above is the primary evidence; this is the belt-and-braces
    // structural check that the banned APIs have not crept back in.
    const source = readFileSync(join(import.meta.dir, "..", "scripts", "prebuilt", "pack.ts"), "utf8");
    expect(source).not.toMatch(/gzipSync/);
    expect(source).not.toMatch(/readFileSync\(/);
    expect(source).toMatch(/createReadStream/);
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

  test("accepts a self-consistent Linux release directory and reports skipped ELF probes", async () => {
    const out = await releaseDir(smokeStaging(), "linux-x64");
    const report = await verifyOutput({
      outDir: out,
      cxVersion: CX,
      codexVersion: CODEX,
      platform: "linux-x64",
      skipMacho: true,
    });
    expect(report.machoSkipped).toBe(true);
    expect(report.manifest.cxVersion).toBe(CX);
    expect(report.checks).toContain("archive sha256 matches manifest");
    expect(report.checks).toContain("SHA256SUMS matches manifest");
    expect(report.checks).toContain("ELF arch/linkage SKIPPED");
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
