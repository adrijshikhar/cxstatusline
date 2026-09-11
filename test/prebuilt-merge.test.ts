import { describe, expect, test } from "bun:test";
import { validateManifest } from "../src/distribution";
import { mergeManifests } from "../scripts/prebuilt/merge";
import { releaseFixture } from "./release-fixture";

describe("mergeManifests", () => {
  const arm64 = releaseFixture({ cxVersion: "0.1.0", codexVersion: "0.153.4", platform: "darwin-arm64" }).manifest;
  const x64 = releaseFixture({ cxVersion: "0.1.0", codexVersion: "0.153.4", platform: "darwin-x64" }).manifest;

  test("merges two single-platform manifests into sorted artifacts", () => {
    const merged = mergeManifests([
      { ...x64, createdAt: "2026-09-05T14:00:00Z" },
      { ...arm64, createdAt: "2026-09-05T12:00:00Z" },
    ]);

    expect(merged.artifacts).toHaveLength(2);
    expect(merged.artifacts[0]!.platform).toBe("darwin-arm64");
    expect(merged.artifacts[1]!.platform).toBe("darwin-x64");
    expect(merged.createdAt).toBe("2026-09-05T12:00:00Z");

    // Passes validateManifest for each platform
    const valArm64 = validateManifest(merged, { cxVersion: "0.1.0", codexVersion: "0.153.4", platform: "darwin-arm64" });
    expect(valArm64.artifacts).toHaveLength(2);
    const valX64 = validateManifest(merged, { cxVersion: "0.1.0", codexVersion: "0.153.4", platform: "darwin-x64" });
    expect(valX64.artifacts).toHaveLength(2);
  });

  test("fails when parts array is empty", () => {
    expect(() => mergeManifests([])).toThrow(/no manifests given/);
  });

  test("fails on mismatched sourceCommit", () => {
    const badCommit = { ...x64, sourceCommit: "e".repeat(40) };
    expect(() => mergeManifests([arm64, badCommit])).toThrow(/sourceCommit/);
  });

  test("fails on duplicate platform", () => {
    expect(() => mergeManifests([arm64, arm64])).toThrow(/duplicate platform/);
  });
});
