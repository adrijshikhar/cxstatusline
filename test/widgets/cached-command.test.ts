import { describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  CACHE_VERSION,
  cacheKey,
  readDocument,
  writeDocument,
  type CacheDocument,
} from "../../src/widgets/shared/cached-command";
import { tmpEnv } from "../helpers";

describe("cacheKey", () => {
  test("returns 16 lowercase hex characters; stable for same (command, cwd); changes when either changes", () => {
    const k1 = cacheKey("date", "/repo");
    expect(k1).toMatch(/^[0-9a-f]{16}$/);
    expect(cacheKey("date", "/repo")).toBe(k1);
    expect(cacheKey("date -u", "/repo")).not.toBe(k1);
    expect(cacheKey("date", "/other")).not.toBe(k1);
  });

  test("cacheKey(cmd, undefined) equals cacheKey(cmd, '')", () => {
    expect(cacheKey("date", undefined)).toBe(cacheKey("date", ""));
  });
});

describe("readDocument", () => {
  test("returns 'miss' for absent file, non-JSON, wrong version, or missing command", () => {
    const { root } = tmpEnv();
    const missing = join(root, "missing.json");
    expect(readDocument(missing)).toBe("miss");

    const badJson = join(root, "bad.json");
    writeDocument(badJson, {
      version: CACHE_VERSION,
      command: "date",
      cwd: "",
      input: "{}",
      requestedAt: Date.now(),
      result: null,
      producedAt: null,
    });
    // Corrupt with invalid JSON:
    const { writeFileAtomic } = require("../../src/atomic");
    writeFileAtomic(badJson, "{ invalid json");
    expect(readDocument(badJson)).toBe("miss");

    // Wrong version:
    writeFileAtomic(badJson, JSON.stringify({ version: 99, command: "date" }));
    expect(readDocument(badJson)).toBe("miss");

    // Missing command:
    writeFileAtomic(badJson, JSON.stringify({ version: CACHE_VERSION }));
    expect(readDocument(badJson)).toBe("miss");
  });

  test("round-trips document fields including result: null", () => {
    const { root } = tmpEnv();
    const file = join(root, "doc.json");
    const doc: CacheDocument = {
      version: CACHE_VERSION,
      command: "printf hello",
      cwd: "/work/dir",
      input: '{"terminal_width":80}',
      requestedAt: 1757740000000,
      result: null,
      producedAt: null,
    };
    writeDocument(file, doc);
    expect(readDocument(file)).toEqual(doc);

    const populated: CacheDocument = {
      ...doc,
      result: {
        stdout: "hello\n",
        status: 0,
        signal: null,
        errorCode: undefined,
        timedOut: false,
      },
      producedAt: 1757740003000,
    };
    writeDocument(file, populated);
    expect(readDocument(file)).toEqual(populated);
  });
});

describe("permissions", () => {
  test("file written by writeDocument is 0600 and created directory is 0700", () => {
    const { root } = tmpEnv();
    // Path inside a non-existent directory to test directory creation
    const file = join(root, "new-cache-dir", "sub", "test.json");
    const doc: CacheDocument = {
      version: CACHE_VERSION,
      command: "test",
      cwd: "",
      input: "{}",
      requestedAt: 1000,
      result: null,
      producedAt: null,
    };
    writeDocument(file, doc);

    const fileStat = statSync(file);
    expect(fileStat.mode & 0o777).toBe(0o600);

    const dirStat = statSync(join(root, "new-cache-dir", "sub"));
    expect(dirStat.mode & 0o777).toBe(0o700);
  });
});
