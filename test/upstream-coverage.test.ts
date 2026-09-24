import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadManifest } from "../src/patch/manifest";
import { DEFAULT_PREBUILT_PLATFORMS, type ReleaseManifest } from "../src/distribution";
import { classifyCoverage, fetchAllReleasePages, fetchUpstreamPages, stableUpstreamVersions, upsertCoverageIssue, COVERAGE_ISSUE_MARKER, COVERAGE_ISSUE_TITLE, type CoverageRelease, type CoverageReport } from "../scripts/upstream-coverage";
import type { GhRunner } from "../scripts/prebuilt/gh";

const patchesDir = join(import.meta.dir, "..", "patches");
const shipped = loadManifest(patchesDir);
// Preserve the original gap scenario as real compatibility entries are validated and added.
const manifest = { ...shipped, patches: shipped.patches.filter((patch) =>
  !["0.153.1", "0.153.2", "0.153.3", "0.156.0"].includes(patch.min)) };

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
  const gapReport: CoverageReport = { checkedAt: "2026-09-24T00:00:00.000Z", floor: "0.152.1", gapCount: 1,
    rows: [{ version: "0.153.1", status: "unsupported", detail: "No compatibility entry" }] };

  test("creates and updates only the marked stable tracking issue; dry run does not write", () => {
    let callList: string[][] = [];
    const gh: GhRunner = (args) => {
      callList.push([...args]);
      if (args[0] === "issue" && args[1] === "list") return { status: 0, stdout: JSON.stringify([
        { number: 5, title: COVERAGE_ISSUE_TITLE, body: "unmarked", state: "OPEN" },
      ]), stderr: "" };
      if (args[0] === "issue" && args[1] === "create") return { status: 0, stdout: "https://github.com/adrijshikhar/cxstatusline/issues/7", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    };
    upsertCoverageIssue(gh, "adrijshikhar/cxstatusline", gapReport, true);
    expect(callList).toHaveLength(1);
    expect(callList[0]?.[0]).toBe("issue");
    callList = [];
    upsertCoverageIssue(gh, "adrijshikhar/cxstatusline", gapReport);
    expect(callList.at(-1)?.[1]).toBe("create");
    expect(callList.at(-1)).toContain("--body-file");
    expect(COVERAGE_ISSUE_MARKER).toContain("cxstatusline-codex-coverage");
  });

  test("closes the marked issue only after a complete healthy report", () => {
    const calls: string[][] = [];
    const healthy: CoverageReport = { ...gapReport, gapCount: 0, rows: [] };
    const gh: GhRunner = (args) => {
      calls.push([...args]);
      if (args[0] === "issue" && args[1] === "list") return { status: 0, stdout: JSON.stringify([
        { number: 9, title: COVERAGE_ISSUE_TITLE, body: COVERAGE_ISSUE_MARKER, state: "OPEN" },
      ]), stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    };
    upsertCoverageIssue(gh, "adrijshikhar/cxstatusline", healthy);
    expect(calls.map((args) => args[1])).toEqual(["list", "edit", "close"]);
  });

  test("reopens a closed marked issue when a gap returns", () => {
    const calls: string[][] = [];
    const run: GhRunner = (args) => {
      calls.push([...args]);
      return { status: 0, stderr: "", stdout: args[1] === "list" ? JSON.stringify([
        { number: 9, title: COVERAGE_ISSUE_TITLE, body: COVERAGE_ISSUE_MARKER, state: "CLOSED" },
      ]) : "" };
    };
    upsertCoverageIssue(run, "adrijshikhar/cxstatusline", gapReport);
    expect(calls.map((args) => args[1])).toEqual(["list", "edit", "reopen"]);
  });

  test("a failed issue lookup aborts without writes", () => {
    let calls = 0;
    const gh: GhRunner = () => ({ status: ++calls === 1 ? 1 : 0, stdout: "", stderr: "API unavailable" });
    expect(() => upsertCoverageIssue(gh, "adrijshikhar/cxstatusline", gapReport)).toThrow(/gh issue list -R failed/);
    expect(calls).toBe(1);
  });

  test("enumerates stable releases semantically, with pagination and deduplication", async () => {
    const releases = await fetchAllReleasePages(async (page) => page === 1
      ? [...Array.from({ length: 100 }, (_, i) => ({ tag_name: `rust-v0.${200 - i}.0` })), { tag_name: "rust-v0.153.0" }]
      : [{ tag_name: "rust-v0.153.0" }, { tag_name: "rust-v0.152.1" }]);
    const versions = stableUpstreamVersions(releases, "0.152.1");
    expect(versions[0]).toBe("0.153.0");
    expect(versions.at(-1)).toBe("0.200.0");
    expect(versions.filter((v) => v === "0.153.0")).toHaveLength(1);
    expect(versions).not.toContain("0.154.1");
  });

  test("series rollover retains historical baselines and excludes drafts and prereleases", () => {
    const releases = ["0.155.0", "0.155.1", "0.156.0", "0.156.1", "0.156.2"]
      .map((v) => ({ tag_name: `rust-v${v}` }));
    expect(stableUpstreamVersions(releases, "0.152.1")).toEqual([
      "0.155.0", "0.156.0", "0.156.1", "0.156.2",
    ]);
    expect(stableUpstreamVersions([...releases,
      { tag_name: "rust-v0.157.0-alpha.1" },
      { tag_name: "rust-v0.157.0", draft: true },
      { tag_name: "rust-v0.158.0", prerelease: true },
    ], "0.152.1")).toEqual(stableUpstreamVersions(releases, "0.152.1"));
    expect(stableUpstreamVersions([...releases, { tag_name: "rust-v0.157.0" }], "0.152.1"))
      .toEqual(["0.155.0", "0.156.0", "0.157.0"]);
    expect(stableUpstreamVersions([...releases, { tag_name: "rust-v1.0.1" }], "0.152.1"))
      .toEqual(["0.155.0", "0.156.0", "1.0.1"]);
    expect(stableUpstreamVersions([], "0.152.1")).toEqual([]);
  });

  test("a failed later release page invalidates the complete listing", async () => {
    await expect(fetchAllReleasePages(async (page) => {
      if (page === 1) return Array.from({ length: 100 }, () => ({}));
      throw new Error("page two unavailable");
    })).rejects.toThrow("page two unavailable");
  });

  test("keeps latest-series gaps visible without requiring obsolete historical patch releases", () => {
    const releases = ["0.153.1", "0.153.2", "0.153.3", "0.156.0", "0.156.1"].map((v) => ({ tag_name: `rust-v${v}` }));
    const rows = classifyCoverage(manifest, stableUpstreamVersions(releases, "0.152.1"), [], new Map(), patchesDir);
    expect(rows.filter((r) => r.status === "unsupported").map((r) => r.version)).toEqual([
      "0.156.0",
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


test("upstream cursor pagination reaches past REST's 1000-release cap", () => {
  let page = 0;
  const run: GhRunner = (args) => {
    if (page > 0) expect(args).toContain(`cursor=page-${page}`);
    page += 1;
    return { status: 0, stderr: "", stdout: JSON.stringify({ data: { repository: { releases: {
      nodes: Array.from({ length: 100 }, (_, i) => ({ tagName: `rust-v0.${page * 100 + i}.0`, isDraft: false, isPrerelease: false })),
      pageInfo: { hasNextPage: page < 11, endCursor: `page-${page}` },
    } } } }) };
  };
  expect(fetchUpstreamPages(run)).toHaveLength(1100);
  expect(page).toBe(11);
});

test("a failed or repeated upstream cursor cannot produce a complete audit", () => {
  let calls = 0;
  const run: GhRunner = () => ({ status: ++calls === 2 ? 1 : 0, stderr: "later page failed", stdout: JSON.stringify({ data: { repository: { releases: {
    nodes: [], pageInfo: { hasNextPage: true, endCursor: "same" },
  } } } }) });
  expect(() => fetchUpstreamPages(run)).toThrow(/later page failed/);
  const repeat: GhRunner = () => ({ status: 0, stderr: "", stdout: JSON.stringify({ data: { repository: { releases: {
    nodes: [], pageInfo: { hasNextPage: true, endCursor: "same" },
  } } } }) });
  expect(() => fetchUpstreamPages(repeat)).toThrow(/did not advance/);
});
