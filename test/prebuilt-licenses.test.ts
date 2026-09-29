import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildManifest } from "../scripts/prebuilt/manifest";
import { fileDigests, packArchive, writeChecksums } from "../scripts/prebuilt/pack";
import { appendRustNotices, appendToolNotices, auditRustLicenses, generateRustNotices, RUST_NOTICES_MARKER, TOOL_NOTICES_MARKER } from "../scripts/prebuilt/rust-licenses";
import { verifyOutput } from "../scripts/prebuilt/verify";
import { packageStaging } from "./prebuilt-gh-fixture";

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

test("appendToolNotices adds the verbatim licences of exactly the tools present", () => {
  const dir = packageStaging();
  writeFileSync(join(dir, "THIRD_PARTY_NOTICES.md"), "# Third-party notices\n");
  appendToolNotices(dir, "/no-upstream");
  const text = readFileSync(join(dir, "THIRD_PARTY_NOTICES.md"), "utf8");
  expect(text).toContain(TOOL_NOTICES_MARKER);
  expect(text).toContain("### ripgrep (MIT OR Unlicense)");
  expect(text).toContain("Copyright (c) 2015 Andrew Gallant");
  expect(text).toContain("This is free and unencumbered software released into the public domain.");
  expect(text).toContain("### zsh (zsh licence)");
  expect(text).not.toContain("bubblewrap");
  expect(() => appendToolNotices(dir, "/no-upstream")).toThrow(/already contains/);
});

test("appendToolNotices on Linux reads bubblewrap's COPYING from the vendored source it was built from", () => {
  const dir = packageStaging({ platform: "linux-arm64" });
  writeFileSync(join(dir, "THIRD_PARTY_NOTICES.md"), "# Third-party notices\n");
  const upstream = mkdtempSync(join(tmpdir(), "cx-upstream-"));
  mkdirSync(join(upstream, "codex-rs", "vendor", "bubblewrap"), { recursive: true });
  writeFileSync(join(upstream, "codex-rs", "vendor", "bubblewrap", "COPYING"), "GNU LIBRARY GENERAL PUBLIC LICENSE\n");
  appendToolNotices(dir, upstream);
  expect(readFileSync(join(dir, "THIRD_PARTY_NOTICES.md"), "utf8")).toContain("### bubblewrap (LGPL-2.1-or-later)\n\n```\nGNU LIBRARY GENERAL PUBLIC LICENSE\n```");
  const missing = packageStaging({ platform: "linux-arm64" });
  writeFileSync(join(missing, "THIRD_PARTY_NOTICES.md"), "# Third-party notices\n");
  expect(() => appendToolNotices(missing, mkdtempSync(join(tmpdir(), "cx-empty-")))).toThrow(/COPYING for codex-resources\/bwrap is missing/);
});

test("verifyOutput rejects archive whose THIRD_PARTY_NOTICES lacks the Rust notices marker", async () => {
  const staging = packageStaging({ codexVersion: "0.153.4" });
  writeFileSync(join(staging, "THIRD_PARTY_NOTICES.md"), "# Third party only\n");

  const out = mkdtempSync(join(tmpdir(), "cx-out-no-notices-"));
  const filename = "cxstatusline-codex-0.153.4-darwin-arm64.tar.gz";
  const archive = await packArchive(staging, join(out, filename));
  const files = fileDigests(staging);
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
    files,
    patchVersion: 2,
    patchFile: "codex-0.153.4.patch",
  });
  writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeChecksums(out, [filename, "manifest.json"]);

  await expect(
    verifyOutput({ outDir: out, cxVersion: "0.1.0", codexVersion: "0.153.4", platform: "darwin-arm64", skipMacho: true, skipDaemon: true }),
  ).rejects.toThrow(/Rust dependency notices/);
});
