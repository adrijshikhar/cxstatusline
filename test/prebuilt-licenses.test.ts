import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildManifest } from "../scripts/prebuilt/manifest";
import { ARCHIVE_ENTRIES, packArchive, writeChecksums } from "../scripts/prebuilt/pack";
import { appendRustNotices, auditRustLicenses, generateRustNotices, RUST_NOTICES_MARKER } from "../scripts/prebuilt/rust-licenses";
import { verifyOutput } from "../scripts/prebuilt/verify";
import type { ArtifactFile, FileDigest } from "../src/distribution";

const fakeRun = (calls: string[][], stdout = "", status = 0) =>
  (cmd: string, args: readonly string[]) => { calls.push([cmd, ...args]); return { status, stdout, stderr: "" }; };

test("appendRustNotices appends once, deterministically, below the repo notices", () => {
  const dir = mkdtempSync(join(tmpdir(), "cx notices "));
  writeFileSync(join(dir, "THIRD_PARTY_NOTICES.md"), "# Third-party notices\n\nrepo text\n");
  appendRustNotices(dir, "## crate-a 1.0.0 (MIT)\n\nMIT text\n");
  const once = readFileSync(join(dir, "THIRD_PARTY_NOTICES.md"), "utf8");
  expect(once).toBe(`# Third-party notices\n\nrepo text\n\n${RUST_NOTICES_MARKER}\n\n## crate-a 1.0.0 (MIT)\n\nMIT text\n`);
  expect(() => appendRustNotices(dir, "again")).toThrow(/already contains/);
});

test("generateRustNotices runs cargo about with the repo config and returns its stdout", () => {
  const calls: string[][] = [];
  const out = generateRustNotices("/up", fakeRun(calls, "GENERATED\n"));
  expect(out).toBe("GENERATED\n");
  expect(calls[0]![0]).toBe("cargo");
  expect(calls[0]).toContain("about");
  expect(calls[0]).toContain("generate");
  expect(calls[0]!.some((a) => a.endsWith("scripts/prebuilt/about.toml"))).toBe(true);
  expect(calls[0]!.some((a) => a.endsWith("scripts/prebuilt/about.hbs"))).toBe(true);
});

test("auditRustLicenses fails when cargo deny rejects a license", () => {
  expect(() => auditRustLicenses("/up", fakeRun([], "", 1))).toThrow(/cargo deny check licenses failed/);
  expect(() => auditRustLicenses("/up", fakeRun([], "", 0))).not.toThrow();
});

test("verifyOutput rejects archive whose THIRD_PARTY_NOTICES lacks the Rust notices marker", async () => {
  const staging = mkdtempSync(join(tmpdir(), "cx-stage-no-notices-"));
  writeFileSync(join(staging, "codex"), '#!/bin/sh\necho "codex-cli 0.153.4"\n');
  writeFileSync(join(staging, "codex-code-mode-host"), '#!/bin/sh\necho "usage: --listen <addr>"\n');
  chmodSync(join(staging, "codex"), 0o755);
  chmodSync(join(staging, "codex-code-mode-host"), 0o755);
  writeFileSync(join(staging, "LICENSE"), "MIT\n");
  chmodSync(join(staging, "LICENSE"), 0o644);
  writeFileSync(join(staging, "NOTICE"), "Notice\n");
  chmodSync(join(staging, "NOTICE"), 0o644);
  writeFileSync(join(staging, "THIRD_PARTY_NOTICES.md"), "# Third party only\n");
  chmodSync(join(staging, "THIRD_PARTY_NOTICES.md"), 0o644);

  const out = mkdtempSync(join(tmpdir(), "cx-out-no-notices-"));
  const filename = "cxstatusline-codex-0.153.4-darwin-arm64.tar.gz";
  const archive = await packArchive(staging, join(out, filename));
  const files: Record<string, FileDigest> = {};
  for (const name of ARCHIVE_ENTRIES) {
    const bytes = readFileSync(join(staging, name));
    files[name] = { sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
  }
  const manifest = buildManifest({
    cxVersion: "0.1.0",
    codexVersion: "0.153.4",
    platform: "darwin-arm64",
    upstreamCommit: "b".repeat(40),
    patchSha256: "c".repeat(64),
    sourceCommit: "a".repeat(40),
    workflowUrl: "https://github.com/adrijshikhar/cxstatusline/actions/runs/123",
    createdAt: "2026-09-07T00:00:00Z",
    archive,
    files: files as Record<ArtifactFile, FileDigest>,
  });
  writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeChecksums(out, [filename, "manifest.json"]);

  await expect(
    verifyOutput({ outDir: out, cxVersion: "0.1.0", codexVersion: "0.153.4", platform: "darwin-arm64", skipMacho: true }),
  ).rejects.toThrow(/Rust dependency notices/);
});
