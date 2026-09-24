import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadManifest } from "../src/patch/manifest";
import { DEFAULT_PREBUILT_PLATFORMS, type ReleaseManifest } from "../src/distribution";
import { classifyCoverage, fetchAllReleasePages, stableUpstreamVersions, type CoverageRelease } from "../scripts/upstream-coverage";

const patchesDir = join(import.meta.dir, "..", "patches");
const manifest = loadManifest(patchesDir);

function metadata(version: string): ReleaseManifest {
  const patch = manifest.patches.find((entry) => entry.min === version)!;
  const bytes = readFileSync(join(patchesDir, patch.file));
  const patchSha256 = createHash("sha256").update(bytes).digest("hex");
  const files = Object.fromEntries(["codex", "codex-code-mode-host", "LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md"]
    .map((name) => [name, { sha256: "a".repeat(64), size: 1 }])) as ReleaseManifest["artifacts"][number]["files"];
  return {
    schema: 2,
    patchVersion: patch.patchVersion,
    codexVersion: version,
    upstreamTag: `rust-v${version}`,
    upstreamCommit: "b".repeat(40),
    patchFile: patch.file,
    patchSha256,
    sourceCommit: "c".repeat(40),
    workflowUrl: "https://github.com/adrijshikhar/cxstatusline/actions/runs/42",
    createdAt: "2026-09-24T00:00:00Z",
    artifacts: DEFAULT_PREBUILT_PLATFORMS.map((platform) => ({
      platform,
      filename: `cxstatusline-codex-${version}-${platform}.tar.gz`,
      sha256: "d".repeat(64),
      size: 4,
      files,
    })),
  };
}

describe("upstream release coverage", () => {
  test("enumerates stable releases semantically, with pagination and deduplication", async () => {
    const releases = await fetchAllReleasePages(async (page) => page === 1
      ? [...Array.from({ length: 100 }, (_, i) => ({ tag_name: `rust-v0.${200 - i}.0` })), { tag_name: "rust-v0.153.0" }]
      : [{ tag_name: "rust-v0.153.0" }, { tag_name: "rust-v0.152.1" }]);
    const versions = stableUpstreamVersions(releases, "0.152.1");
    expect(versions[0]).toBe("0.152.1");
    expect(versions.at(-1)).toBe("0.200.0");
    expect(versions.filter((v) => v === "0.153.0")).toHaveLength(1);
    expect(versions).not.toContain("0.154.1");
  });

  test("a failed later release page invalidates the complete listing", async () => {
    await expect(fetchAllReleasePages(async (page) => {
      if (page === 1) return Array.from({ length: 100 }, () => ({}));
      throw new Error("page two unavailable");
    })).rejects.toThrow("page two unavailable");
  });

  test("keeps all historical gaps visible after the latest version is supported", () => {
    const releases = ["0.153.1", "0.153.2", "0.153.3", "0.156.0", "0.156.1"].map((v) => ({ tag_name: `rust-v${v}` }));
    const rows = classifyCoverage(manifest, stableUpstreamVersions(releases, "0.152.1"), [], new Map(), patchesDir);
    expect(rows.filter((r) => r.status === "unsupported").map((r) => r.version)).toEqual([
      "0.153.1", "0.153.2", "0.153.3", "0.156.0",
    ]);
    expect(rows.at(-1)?.status).toBe("missing-prebuilt");
  });

  test("counts published prereleases by exact stable tag and validates the full asset set", () => {
    const version = "0.153.4";
    const raw = metadata(version);
    const assets = [
      ...raw.artifacts.map((a) => ({ name: a.filename, size: a.size })),
      { name: "manifest.json", size: 100 }, { name: "SHA256SUMS", size: 100 },
    ];
    const release: CoverageRelease = { tag_name: `codex-v${version}`, draft: false, prerelease: true, assets };
    const row = classifyCoverage(manifest, [version], [release], new Map([[version, raw]]), patchesDir)[0]!;
    expect(row.status).toBe("ready");
    expect(row.detail).toContain("patch v1");
    const missing = classifyCoverage(manifest, [version], [{ ...release, assets: assets.slice(1) }], new Map([[version, raw]]), patchesDir)[0]!;
    expect(missing.status).toBe("invalid-prebuilt");
    const wrongDigest = { ...raw, patchSha256: "f".repeat(64) };
    expect(classifyCoverage(manifest, [version], [release], new Map([[version, wrongDigest]]), patchesDir)[0]?.status).toBe("invalid-prebuilt");
  });

  test("ignores draft releases and reports unsupported versions without guessing a patch", () => {
    const version = "0.153.4";
    const draft: CoverageRelease = { tag_name: `codex-v${version}`, draft: true, assets: [] };
    expect(classifyCoverage(manifest, [version], [draft], new Map(), patchesDir)[0]?.status).toBe("missing-prebuilt");
    expect(classifyCoverage(manifest, ["0.153.3"], [], new Map(), patchesDir)[0]?.status).toBe("unsupported");
  });
});
