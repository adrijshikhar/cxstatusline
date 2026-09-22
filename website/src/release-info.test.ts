import { describe, expect, test } from "bun:test";
import { SUPPORTED_PLATFORMS, supportedCodexReleases, supportedCodexVersions } from "./release-info";

describe("release-info", () => {
  test("defines supported platforms for macOS and Linux", () => {
    expect(SUPPORTED_PLATFORMS).toEqual([
      { name: "macOS", arch: "Apple Silicon, Intel" },
      { name: "Linux", arch: "x64, arm64" },
    ]);
  });

  test("populates supported Codex releases with platform metadata", () => {
    expect(supportedCodexReleases.length).toBeGreaterThan(0);
    expect(supportedCodexReleases.length).toBe(supportedCodexVersions.length);

    // Latest version is marked
    expect(supportedCodexReleases[0]?.isLatest).toBe(true);

    for (let i = 1; i < supportedCodexReleases.length; i++) {
      expect(supportedCodexReleases[i]?.isLatest).toBe(false);
    }

    // Every release supports macOS and Linux
    for (const release of supportedCodexReleases) {
      expect(release.version).toBeTruthy();
      expect(release.releaseUrl).toContain("https://github.com/adrijshikhar/cxstatusline/releases/tag/");
      expect(release.platforms).toHaveLength(2);

      const mac = release.platforms.find((p) => p.name === "macOS");
      const linux = release.platforms.find((p) => p.name === "Linux");

      expect(mac).toBeDefined();
      expect(mac?.arch).toContain("Apple Silicon");
      expect(linux).toBeDefined();
      expect(linux?.arch).toContain("x64");
      expect(linux?.arch).toContain("arm64");
    }
  });
});
