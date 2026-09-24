import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_HOST,
  DEFAULT_KEY,
  DEFAULT_KEY_LOCATION,
  DEFAULT_URL,
  executeIndexNow,
  resolveClaudeSeoPath,
} from "../scripts/indexnow";

const root = join(import.meta.dir, "..");
const scriptPath = join(root, "scripts", "indexnow.ts");

describe("indexnow CLI helper", () => {
  test("resolveClaudeSeoPath uses process.env.CLAUDE_SEO_PATH if set", () => {
    const customPath = "/custom/path/to/claude-seo";
    const resolved = resolveClaudeSeoPath({ CLAUDE_SEO_PATH: customPath }, "/nonexistent");
    expect(resolved).toBe(customPath);
  });

  test("executeIndexNow invokes runner with default host, key, and URL", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "indexnow-mock-"));
    try {
      const mockRunner = join(tempDir, "claude-seo");
      const logFile = join(tempDir, "invocation.log");
      writeFileSync(
        mockRunner,
        `#!/bin/sh\necho "$@" > "${logFile}"\nexit 0\n`
      );
      chmodSync(mockRunner, 0o755);

      const code = executeIndexNow([], {
        claudeSeoPath: mockRunner,
        stdio: "pipe",
      });
      expect(code).toBe(0);

      const loggedArgs = readFileSync(logFile, "utf8").trim();
      expect(loggedArgs).toContain("run indexnow_submit.py");
      expect(loggedArgs).toContain(`--host ${DEFAULT_HOST}`);
      expect(loggedArgs).toContain(`--key ${DEFAULT_KEY}`);
      expect(loggedArgs).toContain(`--key-location ${DEFAULT_KEY_LOCATION}`);
      expect(loggedArgs).toContain(`--urls ${DEFAULT_URL}`);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("executeIndexNow respects custom host, key, and urls arguments", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "indexnow-mock-"));
    try {
      const mockRunner = join(tempDir, "claude-seo");
      const logFile = join(tempDir, "invocation.log");
      writeFileSync(
        mockRunner,
        `#!/bin/sh\necho "$@" > "${logFile}"\nexit 0\n`
      );
      chmodSync(mockRunner, 0o755);

      const code = executeIndexNow(["--host", "example.com", "--key", "customkey", "--urls", "https://example.com/page"], {
        claudeSeoPath: mockRunner,
        stdio: "pipe",
      });
      expect(code).toBe(0);

      const loggedArgs = readFileSync(logFile, "utf8").trim();
      expect(loggedArgs).toContain("--host example.com");
      expect(loggedArgs).toContain("--key customkey");
      expect(loggedArgs).toContain("--urls https://example.com/page");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("exits non-zero when runner is missing", () => {
    const code = executeIndexNow([], {
      claudeSeoPath: "/nonexistent/path/to/claude-seo",
      stdio: "pipe",
    });
    expect(code).not.toBe(0);
  });
});
