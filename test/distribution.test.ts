import { expect, test } from "bun:test";
import {
  releaseTag,
  platformFor,
  validateManifest,
  type Artifact,
  type ExpectedRelease,
  type FileDigest,
  type ReleaseManifest,
} from "../src/distribution";

test("exact immutable identity and supported CPU only", () => {
  expect(releaseTag("0.2.1", "0.153.0")).toBe("cxstatusline-v0.2.1-codex-v0.153.0");
  expect(platformFor("darwin", "arm64")).toBe("darwin-arm64");
  expect(platformFor("darwin", "x64")).toBe("darwin-x64");
  expect(() => platformFor("linux", "x64")).toThrow();
  expect(() => releaseTag("0.2.1", "0.153.0-beta.1")).toThrow();
  expect(() =>
    validateManifest({}, { cxVersion: "0.2.1", codexVersion: "0.153.0", platform: "darwin-arm64" }),
  ).toThrow();
});

// ---- Fixtures ----

const CX = "0.2.1";
const CODEX = "0.153.0";
const HEX64_A = "a".repeat(64);
const HEX64_B = "b".repeat(64);
const HEX40_C = "c".repeat(40);
const HEX40_D = "d".repeat(40);

const EXPECTED_ARM: ExpectedRelease = { cxVersion: CX, codexVersion: CODEX, platform: "darwin-arm64" };
const EXPECTED_X64: ExpectedRelease = { cxVersion: CX, codexVersion: CODEX, platform: "darwin-x64" };

function digest(sha: string, size = 1024): FileDigest {
  return { sha256: sha, size };
}

function filesFor(sha: string): Artifact["files"] {
  return {
    codex: digest(sha),
    "codex-code-mode-host": digest(sha),
    LICENSE: digest(sha),
    NOTICE: digest(sha),
    "THIRD_PARTY_NOTICES.md": digest(sha),
  };
}

function artifactFor(platform: "darwin-arm64" | "darwin-x64", sha: string): Artifact {
  return {
    platform,
    filename: `cxstatusline-codex-${CODEX}-${platform}.tar.gz`,
    sha256: sha,
    size: 2048,
    files: filesFor(sha),
  };
}

function validManifest(): ReleaseManifest {
  return {
    schema: 1,
    cxVersion: CX,
    codexVersion: CODEX,
    upstreamTag: `rust-v${CODEX}`,
    upstreamCommit: HEX40_C,
    patchFile: `codex-${CODEX}.patch`,
    patchSha256: HEX64_A,
    sourceCommit: HEX40_D,
    workflowUrl: "https://github.com/adrijshikhar/cxstatusline/actions/runs/123456789",
    createdAt: "2026-09-05T12:00:00Z",
    artifacts: [artifactFor("darwin-arm64", HEX64_A), artifactFor("darwin-x64", HEX64_B)],
  };
}

test("valid two-platform manifest round-trips through validateManifest", () => {
  const manifest = validManifest();
  expect(validateManifest(manifest, EXPECTED_ARM)).toEqual(manifest);
  expect(validateManifest(manifest, EXPECTED_X64)).toEqual(manifest);
});

test("one-artifact manifest for the expected platform validates (Apple-Silicon-only release)", () => {
  const manifest = validManifest();
  manifest.artifacts = [artifactFor("darwin-arm64", HEX64_A)];
  expect(validateManifest(manifest, EXPECTED_ARM)).toEqual(manifest);
});

test("one-artifact manifest for a different platform is rejected", () => {
  const manifest = validManifest();
  manifest.artifacts = [artifactFor("darwin-x64", HEX64_B)];
  expect(() => validateManifest(manifest, EXPECTED_ARM)).toThrow();
});

// ---- Table-driven mutations ----

type Mutator = (m: ReleaseManifest) => unknown;

const cases: Array<{ name: string; mutate: Mutator }> = [
  { name: "missing schema", mutate: (m) => { delete (m as unknown as Record<string, unknown>).schema; } },
  { name: "unknown schema version", mutate: (m) => { (m as { schema: number }).schema = 2; } },
  { name: "missing cxVersion", mutate: (m) => { delete (m as unknown as Record<string, unknown>).cxVersion; } },
  { name: "cxVersion mismatched with expected", mutate: (m) => { m.cxVersion = "0.2.2"; } },
  { name: "cxVersion not stable (prerelease)", mutate: (m) => { m.cxVersion = "0.2.1-beta.1"; } },
  { name: "missing codexVersion", mutate: (m) => { delete (m as unknown as Record<string, unknown>).codexVersion; } },
  { name: "codexVersion mismatched with expected", mutate: (m) => { m.codexVersion = "0.153.1"; } },
  { name: "codexVersion not stable (prerelease)", mutate: (m) => { m.codexVersion = "0.153.0-rc.1"; } },
  { name: "missing upstreamTag", mutate: (m) => { delete (m as unknown as Record<string, unknown>).upstreamTag; } },
  { name: "upstreamTag wrong prefix", mutate: (m) => { m.upstreamTag = `v${CODEX}`; } },
  { name: "upstreamTag wrong version", mutate: (m) => { m.upstreamTag = "rust-v0.999.0"; } },
  { name: "missing upstreamCommit", mutate: (m) => { delete (m as unknown as Record<string, unknown>).upstreamCommit; } },
  { name: "upstreamCommit wrong length", mutate: (m) => { m.upstreamCommit = "c".repeat(39); } },
  { name: "upstreamCommit uppercase hex", mutate: (m) => { m.upstreamCommit = "C".repeat(40); } },
  { name: "missing patchFile", mutate: (m) => { delete (m as unknown as Record<string, unknown>).patchFile; } },
  { name: "patchFile wrong version", mutate: (m) => { m.patchFile = "codex-0.999.0.patch"; } },
  { name: "missing patchSha256", mutate: (m) => { delete (m as unknown as Record<string, unknown>).patchSha256; } },
  { name: "patchSha256 malformed", mutate: (m) => { m.patchSha256 = "not-a-hash"; } },
  { name: "missing sourceCommit", mutate: (m) => { delete (m as unknown as Record<string, unknown>).sourceCommit; } },
  { name: "sourceCommit malformed", mutate: (m) => { m.sourceCommit = "z".repeat(40); } },
  { name: "missing workflowUrl", mutate: (m) => { delete (m as unknown as Record<string, unknown>).workflowUrl; } },
  {
    name: "workflowUrl wrong repository",
    mutate: (m) => { m.workflowUrl = "https://github.com/someone-else/cxstatusline/actions/runs/1"; },
  },
  { name: "workflowUrl not a runs URL", mutate: (m) => { m.workflowUrl = "https://github.com/adrijshikhar/cxstatusline"; } },
  { name: "missing createdAt", mutate: (m) => { delete (m as unknown as Record<string, unknown>).createdAt; } },
  { name: "createdAt not a valid timestamp", mutate: (m) => { m.createdAt = "not-a-date"; } },
  { name: "missing artifacts", mutate: (m) => { delete (m as unknown as Record<string, unknown>).artifacts; } },
  { name: "empty artifacts array", mutate: (m) => { m.artifacts = []; } },
  {
    name: "too many artifacts (three entries)",
    mutate: (m) => {
      m.artifacts = [
        artifactFor("darwin-arm64", HEX64_A),
        artifactFor("darwin-x64", HEX64_B),
        artifactFor("darwin-arm64", HEX64_A),
      ];
    },
  },
  {
    name: "duplicate platform in artifacts",
    mutate: (m) => {
      m.artifacts = [artifactFor("darwin-arm64", HEX64_A), artifactFor("darwin-arm64", HEX64_B)];
    },
  },
  {
    name: "artifact filename with path traversal",
    mutate: (m) => { m.artifacts[0]!.filename = `../cxstatusline-codex-${CODEX}-darwin-arm64.tar.gz`; },
  },
  {
    name: "artifact filename with backslash",
    mutate: (m) => { m.artifacts[0]!.filename = `cxstatusline-codex-${CODEX}-darwin-arm64.tar.gz\\evil`; },
  },
  {
    name: "artifact filename does not match platform/version",
    mutate: (m) => { m.artifacts[0]!.filename = "cxstatusline-codex-0.999.0-darwin-arm64.tar.gz"; },
  },
  {
    name: "artifact filename missing the cxstatusline prefix",
    mutate: (m) => { m.artifacts[0]!.filename = `codex-${CODEX}-darwin-arm64.tar.gz`; },
  },
  {
    name: "artifact sha256 malformed",
    mutate: (m) => { m.artifacts[0]!.sha256 = "short"; },
  },
  {
    name: "artifact size is zero",
    mutate: (m) => { m.artifacts[0]!.size = 0; },
  },
  {
    name: "artifact size is negative",
    mutate: (m) => { m.artifacts[0]!.size = -1; },
  },
  {
    name: "artifact size is not an integer",
    mutate: (m) => { m.artifacts[0]!.size = 1.5; },
  },
  {
    name: "artifact size is not a safe integer",
    mutate: (m) => { m.artifacts[0]!.size = Number.MAX_SAFE_INTEGER + 10; },
  },
  {
    name: "artifact missing companion executable file (codex-code-mode-host)",
    mutate: (m) => { delete (m.artifacts[0]!.files as Record<string, unknown>)["codex-code-mode-host"]; },
  },
  {
    name: "artifact missing legal file (LICENSE)",
    mutate: (m) => { delete (m.artifacts[0]!.files as Record<string, unknown>).LICENSE; },
  },
  {
    name: "artifact has an unexpected extra file key",
    mutate: (m) => { (m.artifacts[0]!.files as Record<string, unknown>)["README.md"] = digest(HEX64_A); },
  },
  {
    name: "artifact file digest sha256 malformed",
    mutate: (m) => { m.artifacts[0]!.files.codex.sha256 = "nope"; },
  },
];

for (const { name, mutate } of cases) {
  test(`rejects: ${name}`, () => {
    const manifest = validManifest();
    mutate(manifest);
    expect(() => validateManifest(manifest, EXPECTED_ARM)).toThrow();
  });
}
