import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ManifestError,
  loadManifest,
  resolvePatch,
  supportedCodexVersions,
  isCodexVersionSupported,
  type Manifest,
} from "../src/patch/manifest";
import { parseSemver } from "../src/version";
import { tmpEnv } from "./helpers";

const v = (s: string) => parseSemver(s)!;
const m: Manifest = {
  version: 1,
  tag_prefix: "rust-v",
  patches: [
    { min: "0.152.1", max: "0.152.3", file: "codex-0.152.1.patch" },
    { min: "0.153.0", max: "0.153.0", file: "codex-0.153.0.patch" },
  ],
};

function manifestDir(body: string): string {
  const { root } = tmpEnv();
  const dir = join(root, "patches");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "manifest.json"), body);
  return dir;
}

describe("resolvePatch", () => {
  test("inclusive range match returns file and tag", () => {
    expect(resolvePatch(m, v("0.152.1"))).toEqual({ file: "codex-0.152.1.patch", tag: "rust-v0.152.1" });
    expect(resolvePatch(m, v("0.152.3"))).toEqual({ file: "codex-0.152.1.patch", tag: "rust-v0.152.3" });
    expect(resolvePatch(m, v("0.153.0"))?.file).toBe("codex-0.153.0.patch");
  });
  test("fails closed: no nearest-lower fallback, no prerelease match", () => {
    expect(resolvePatch(m, v("0.152.4"))).toBeNull();
    expect(resolvePatch(m, v("0.152.0"))).toBeNull();
    expect(resolvePatch(m, v("0.154.0"))).toBeNull();
    expect(resolvePatch(m, v("0.153.0-alpha.1"))).toBeNull();
  });
});

describe("loadManifest", () => {
  test("loads the shipped manifest and every referenced file exists", async () => {
    const { existsSync } = await import("node:fs");
    const dir = join(import.meta.dir, "..", "patches");
    const shipped = loadManifest(dir);
    expect(shipped.version).toBe(1);
    expect(shipped.patches.length).toBeGreaterThan(0);
    for (const p of shipped.patches) expect(existsSync(join(dir, p.file))).toBe(true);
  });
  test("a missing manifest throws ManifestError, not ENOENT", () => {
    expect(() => loadManifest("/nonexistent")).toThrow(ManifestError);
    expect(() => loadManifest("/nonexistent")).toThrow(/manifest/);
  });
  test("a partially-malformed entry throws ManifestError, never a raw TypeError", () => {
    const dir = manifestDir('{"version":1,"tag_prefix":"rust-v","patches":[{}]}');
    expect(() => loadManifest(dir)).toThrow(ManifestError);
    expect(() => loadManifest(dir)).toThrow(/malformed/);
  });
  test("a non-semver range throws ManifestError", () => {
    const dir = manifestDir('{"version":1,"tag_prefix":"rust-v","patches":[{"min":"x","max":"y","file":"f"}]}');
    expect(() => loadManifest(dir)).toThrow(ManifestError);
  });
  test("unparsable JSON throws ManifestError", () => {
    expect(() => loadManifest(manifestDir("{ nope"))).toThrow(ManifestError);
  });
});

describe("candidate metadata", () => {
  test("the shipped manifest names the newest explicitly supported version and covers it", () => {
    const shipped = loadManifest(join(import.meta.dir, "..", "patches"));
    expect(shipped.candidate).toBe("0.155.1");
    expect(resolvePatch(shipped, v(shipped.candidate!))?.file).toBe("codex-0.155.1.patch");
  });
  test("the field is optional and never widens resolution", () => {
    const dir = manifestDir('{"version":1,"tag_prefix":"rust-v","patches":[{"min":"0.153.0","max":"0.153.0","file":"f.patch"}]}');
    const loaded = loadManifest(dir);
    expect(loaded.candidate).toBeUndefined();
    const withCandidate = manifestDir(
      '{"version":1,"tag_prefix":"rust-v","candidate":"0.160.0","patches":[{"min":"0.153.0","max":"0.153.0","file":"f.patch"}]}',
    );
    expect(resolvePatch(loadManifest(withCandidate), v("0.160.0"))).toBeNull();
  });
  test("a non-stable or non-string candidate is a malformed manifest", () => {
    const bad = '{"version":1,"tag_prefix":"rust-v","candidate":"0.153.0-rc.1","patches":[]}';
    expect(() => loadManifest(manifestDir(bad))).toThrow(ManifestError);
    expect(() => loadManifest(manifestDir('{"version":1,"tag_prefix":"rust-v","candidate":7,"patches":[]}'))).toThrow(
      ManifestError,
    );
  });
});

describe("supportedCodexVersions and isCodexVersionSupported", () => {
  test("returns supported versions sorted newest first", () => {
    const list = supportedCodexVersions(m);
    expect(list).toEqual(["0.153.0", "0.152.3", "0.152.1"]);
  });

  test("shipped manifest includes all supported versions and candidate is newest", () => {
    const shipped = loadManifest(join(import.meta.dir, "..", "patches"));
    const versions = supportedCodexVersions(shipped);
    expect(versions.length).toBeGreaterThan(0);
    expect(versions[0]).toBe(shipped.candidate);
    expect(versions).toContain("0.155.0");
    expect(versions).toContain("0.154.0");
  });

  test("checks if a version is supported", () => {
    expect(isCodexVersionSupported(m, "0.153.0")).toBe(true);
    expect(isCodexVersionSupported(m, "0.152.2")).toBe(true);
    expect(isCodexVersionSupported(m, "0.154.0")).toBe(false);
    expect(isCodexVersionSupported(m, "invalid")).toBe(false);
  });
});
