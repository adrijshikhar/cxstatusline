import { describe, expect, test } from "bun:test";
import { codexTarget, modeFor, packageRequiredFiles, validateManifest, type Platform, type ReleaseManifest } from "../src/distribution";

const HEX64_A = "a".repeat(64);
const digest = (sha256 = HEX64_A) => ({ sha256, size: 10 });

/** A schema-3 manifest for one platform, listing exactly upstream's package plus our legal files. */
export function packageManifest(platform: Platform = "darwin-arm64", codexVersion = "0.157.0"): ReleaseManifest {
  const files = Object.fromEntries(packageRequiredFiles(platform).map((k) => [k, digest()])) as ReleaseManifest["artifacts"][number]["files"];
  files["codex-resources/zsh/bin/zsh"] = digest();
  return {
    schema: 3,
    patchVersion: 2,
    cxVersion: "0.11.0",
    codexVersion,
    upstreamTag: `rust-v${codexVersion}`,
    upstreamCommit: "b".repeat(40),
    patchFile: `codex-${codexVersion}.patch`,
    patchSha256: "c".repeat(64),
    sourceCommit: "d".repeat(40),
    workflowUrl: "https://github.com/adrijshikhar/cxstatusline/actions/runs/123456789",
    createdAt: "2026-09-29T12:00:00Z",
    artifacts: [{ platform, filename: `cxstatusline-codex-${codexVersion}-${platform}.tar.gz`, sha256: HEX64_A, size: 100, files }],
  };
}

const expected = (platform: Platform = "darwin-arm64") => ({ codexVersion: "0.157.0", platform });

describe("codexTarget / modeFor / packageRequiredFiles", () => {
  test("maps every release platform to the triple upstream's daemon compares against", () => {
    expect(codexTarget("darwin-arm64")).toBe("aarch64-apple-darwin");
    expect(codexTarget("darwin-x64")).toBe("x86_64-apple-darwin");
    expect(codexTarget("linux-x64")).toBe("x86_64-unknown-linux-gnu");
    expect(codexTarget("linux-arm64")).toBe("aarch64-unknown-linux-gnu");
  });

  test("executables live under the three package directories; everything at the root is text", () => {
    expect(modeFor("bin/codex")).toBe(0o755);
    expect(modeFor("codex-path/rg")).toBe(0o755);
    expect(modeFor("codex-resources/zsh/bin/zsh")).toBe(0o755);
    expect(modeFor("codex-package.json")).toBe(0o644);
    expect(modeFor("THIRD_PARTY_NOTICES.md")).toBe(0o644);
  });

  test("bwrap is required on Linux only", () => {
    expect(packageRequiredFiles("darwin-arm64")).not.toContain("codex-resources/bwrap");
    expect(packageRequiredFiles("linux-arm64")).toContain("codex-resources/bwrap");
    expect(packageRequiredFiles("linux-x64")).toContain("codex-resources/bwrap");
  });
});

describe("validateManifest schema 3", () => {
  test("a package manifest round-trips for macOS and Linux", () => {
    expect(validateManifest(packageManifest("darwin-arm64"), expected("darwin-arm64")).schema).toBe(3);
    expect(validateManifest(packageManifest("linux-arm64"), expected("linux-arm64")).schema).toBe(3);
  });

  const rejects: Array<{ name: string; mutate: (m: ReleaseManifest) => void; message: RegExp }> = [
    { name: "schema 3 without patchVersion", mutate: (m) => { delete (m as { patchVersion?: number }).patchVersion; }, message: /patchVersion/ },
    { name: "a member outside the package directories", mutate: (m) => { m.artifacts[0]!.files["README.md"] = digest(); }, message: /unexpected member README.md/ },
    { name: "a member with a traversal segment", mutate: (m) => { m.artifacts[0]!.files["bin/../codex"] = digest(); }, message: /unexpected member/ },
    { name: "a member nested deeper than four levels", mutate: (m) => { m.artifacts[0]!.files["bin/a/b/c/d/e"] = digest(); }, message: /unexpected member/ },
    { name: "a missing required member", mutate: (m) => { delete m.artifacts[0]!.files["codex-path/rg"]; }, message: /missing codex-path\/rg/ },
    { name: "bwrap missing on Linux", mutate: (m) => { delete m.artifacts[0]!.files["codex-resources/bwrap"]; }, message: /missing codex-resources\/bwrap/ },
    { name: "a member that is also a directory of another", mutate: (m) => { m.artifacts[0]!.files["bin/codex/extra"] = digest(); }, message: /also a directory/ },
    { name: "two members differing only by case", mutate: (m) => { m.artifacts[0]!.files["bin/Codex"] = digest(); }, message: /differ only by case/ },
    { name: "more than 64 members", mutate: (m) => { for (let i = 0; i < 64; i += 1) m.artifacts[0]!.files[`bin/extra${i}`] = digest(); }, message: /more than 64/ },
  ];
  for (const { name, mutate, message } of rejects) {
    test(`rejects: ${name}`, () => {
      const platform: Platform = name.includes("Linux") ? "linux-arm64" : "darwin-arm64";
      const m = packageManifest(platform);
      mutate(m);
      expect(() => validateManifest(m, expected(platform))).toThrow(message);
    });
  }

  test("bwrap is not required for a macOS artifact even when a Linux one sits beside it", () => {
    const m = packageManifest("darwin-arm64");
    const linux = packageManifest("linux-arm64").artifacts[0]!;
    m.artifacts.push(linux);
    expect(validateManifest(m, expected("darwin-arm64")).artifacts).toHaveLength(2);
  });

  test("a manifest from the future names the fix instead of a zod path", () => {
    const m = { ...packageManifest(), schema: 4 };
    expect(() => validateManifest(m, expected())).toThrow(/needs a newer cxstatusline \(manifest schema 4\); run npm i -g cxstatusline/);
  });
});
