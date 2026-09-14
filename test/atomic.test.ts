import { describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "../src/atomic";
import { tmpEnv } from "./helpers";

describe("writeFileAtomic", () => {
  test("creates a file with explicit mode", () => {
    const { root } = tmpEnv();
    const file = join(root, "subdir", "test-mode.txt");
    writeFileAtomic(file, "hello with mode", { mode: 0o600 });
    expect(readFileSync(file, "utf8")).toBe("hello with mode");
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  test("two-argument form continues to work with default mode", () => {
    const { root } = tmpEnv();
    const file = join(root, "subdir", "test-default.txt");
    writeFileAtomic(file, "hello default");
    expect(readFileSync(file, "utf8")).toBe("hello default");
    expect(statSync(file).mode & 0o777).not.toBe(0);
  });

  test("structurally: src/atomic.ts creates file with mode and contains no chmod", () => {
    const source = readFileSync(join(import.meta.dir, "../src/atomic.ts"), "utf8");
    expect(source).not.toContain("chmod");
  });

  test("cleans up temp file when rename fails", () => {
    const { root } = tmpEnv();
    const dir = join(root, "subdir");
    const target = join(dir, "target-dir");
    const { mkdirSync, readdirSync } = require("node:fs");
    mkdirSync(target, { recursive: true });

    // Renaming a file over an existing directory fails with EISDIR
    expect(() => writeFileAtomic(target, "will fail")).toThrow();

    const tmpFiles = readdirSync(dir).filter((name: string) => name.endsWith(".tmp"));
    expect(tmpFiles).toHaveLength(0);
  });
});
