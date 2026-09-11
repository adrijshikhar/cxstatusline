import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { assertReleaseIdentity } from "../scripts/release-npm";

const root = join(import.meta.dir, "..");

describe("assertReleaseIdentity", () => {
  const valid = {
    tag: "v0.1.1",
    packageVersion: "0.1.1",
    headSha: "a".repeat(40),
    bundle: `// compiled bundle\nconst CXSTATUSLINE_SOURCE_COMMIT = "${"a".repeat(40)}";\n`,
    candidate: "0.153.4",
    nativeReleaseExists: (tag: string) => tag === "cxstatusline-v0.1.1-codex-v0.153.4",
  };

  test("happy path passes with valid matching inputs", () => {
    expect(() => assertReleaseIdentity(valid)).not.toThrow();
  });

  test("tag/version mismatch throws", () => {
    expect(() => assertReleaseIdentity({ ...valid, tag: "v0.1.2" })).toThrow(
      /tag v0\.1\.2 does not match package version v0\.1\.1/,
    );
  });

  test("bundle without headSha throws", () => {
    expect(() =>
      assertReleaseIdentity({
        ...valid,
        bundle: "// bundle with no commit\n",
      }),
    ).toThrow(/embedded source commit/);
  });

  test("missing native release throws", () => {
    expect(() =>
      assertReleaseIdentity({
        ...valid,
        nativeReleaseExists: () => false,
      }),
    ).toThrow(/no native release/);
  });
});

describe("release-npm CLI", () => {
  test("unknown command exits 2 with usage", () => {
    try {
      execFileSync(process.execPath, ["scripts/release-npm.ts", "invalid"], { cwd: root, stdio: "pipe" });
      expect.unreachable();
    } catch (e: any) {
      expect(e.status).toBe(2);
      expect(e.stderr.toString()).toContain("usage: bun scripts/release-npm.ts check");
    }
  });

  test("missing flags exit 1", () => {
    try {
      execFileSync(process.execPath, ["scripts/release-npm.ts", "check"], { cwd: root, stdio: "pipe" });
      expect.unreachable();
    } catch (e: any) {
      expect(e.status).toBe(1);
      expect(e.stderr.toString()).toContain("--tag is required");
    }
  });
});
