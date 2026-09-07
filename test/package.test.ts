import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertPackageFiles } from "../scripts/check-package";
import { assertReleaseProvenance, sourceProvenance } from "../scripts/provenance";
import { SOURCE_COMMIT, SOURCE_DIRTY, VERSION } from "../src/version-info";

test("packed artifact refuses missing notices and accidental private files", () => {
  const files = ["package.json", "README.md", "LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md",
    "dist/cxstatusline.js", "dist/THIRD_PARTY_LICENSES.txt", "patches/manifest.json",
    "patches/ink@6.2.0.patch", "patches/codex-0.152.1.patch", "patches/codex-0.153.0.patch"];
  expect(() => assertPackageFiles(files)).not.toThrow();
  expect(() => assertPackageFiles(files.filter(file => file !== "NOTICE"))).toThrow();
  expect(() => assertPackageFiles([...files, ".env"])).toThrow();
});

test("a source run invents no provenance", () => {
  // Nothing is defined when the TypeScript runs straight from src/, so the constants must fall
  // back to "unknown", never to whatever git happens to say at runtime.
  expect(SOURCE_COMMIT).toBeNull();
  expect(SOURCE_DIRTY).toBe(false);
  expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
});

/**
 * The bundle under test, rebuilt from this checkout.
 * Always rebuilt, never reused: a `dist/` left over from an earlier commit carries that commit's
 * provenance, and the assertion below is precisely about which commit got stamped.
 */
function bundle(): string {
  const r = spawnSync("bun", ["run", "build"], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`bun run build failed: ${r.stderr}`);
  return join(process.cwd(), "dist", "cxstatusline.js");
}

test("the packed CLI runs outside any git checkout and keeps its embedded provenance", () => {
  const dist = bundle();
  // A temp directory is not inside this (or any) checkout, so a bundle that resolved its commit at
  // runtime would come up empty here. The embedded constant must survive the move.
  const away = mkdtempSync(join(tmpdir(), "cxstatusline packed "));
  const copy = join(away, "cxstatusline.js");
  copyFileSync(dist, copy);
  expect(spawnSync("git", ["rev-parse", "HEAD"], { cwd: away, encoding: "utf8" }).status).not.toBe(0);

  const r = spawnSync("node", [copy, "--version"], { cwd: away, encoding: "utf8" });
  expect(r.status).toBe(0);
  expect(r.stdout.trim()).toMatch(/^cxstatusline \d+\.\d+\.\d+$/);

  const head = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  if (head.status === 0) expect(readFileSync(copy, "utf8")).toContain(head.stdout.trim());
});

describe("build-time source provenance", () => {
  const clean = (args: readonly string[]) =>
    args[0] === "rev-parse" ? { status: 0, stdout: `${"a".repeat(40)}\n` } : { status: 0, stdout: "" };

  test("a clean checkout records its exact commit", () => {
    expect(sourceProvenance(clean)).toEqual({ commit: "a".repeat(40), dirty: false });
  });
  test("a dirty checkout records the base commit and says so", () => {
    const dirty = (args: readonly string[]) =>
      args[0] === "rev-parse" ? { status: 0, stdout: `${"a".repeat(40)}\n` } : { status: 0, stdout: " M src/main.ts\n" };
    expect(sourceProvenance(dirty)).toEqual({ commit: "a".repeat(40), dirty: true });
  });
  test("no git metadata records null, never an invented commit", () => {
    expect(sourceProvenance(() => { throw new Error("not a git repository"); })).toEqual({ commit: null, dirty: false });
    expect(sourceProvenance(() => ({ status: 128, stdout: "" }))).toEqual({ commit: null, dirty: false });
    expect(sourceProvenance((args) => (args[0] === "rev-parse" ? { status: 0, stdout: "not-a-hash\n" } : { status: 0, stdout: "" })))
      .toEqual({ commit: null, dirty: false });
  });
  test("release packaging requires a clean checkout with an exact commit", () => {
    expect(() => assertReleaseProvenance({ commit: "a".repeat(40), dirty: false })).not.toThrow();
    expect(() => assertReleaseProvenance({ commit: "a".repeat(40), dirty: true })).toThrow(/dirty/i);
    expect(() => assertReleaseProvenance({ commit: null, dirty: false })).toThrow(/commit/i);
  });
});
