import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { GIT_EXEC_TIMEOUT, defaultGitRunner, isDefinitelyOutsideGitRepository, getGitDiffChanges, runGit, clearGitCache } from "../src/utils/git";
import { GIT_HARDENING_ARGS } from "../src/utils/git-hardening";
import type { RenderContext } from "../src/types/RenderContext";

describe("git runner timeout", () => {
  it("defines GIT_EXEC_TIMEOUT as 5000ms", () => {
    expect(GIT_EXEC_TIMEOUT).toBe(5000);
  });

  it("passes timeout: GIT_EXEC_TIMEOUT in spawnSync options", () => {
    const spy = spyOn(childProcess, "spawnSync").mockReturnValue({
      stdout: "clean\n",
      status: 0,
      error: undefined,
    } as any);

    try {
      const output = defaultGitRunner(["status", "--porcelain"], "/mock/repo");
      expect(output).toBe("clean\n");
      expect(spy).toHaveBeenCalledTimes(1);
      const call = spy.mock.calls[0];
      expect(call).toBeDefined();
      expect(call?.[0]).toBe("git");
      expect(call?.[1]).toEqual([...GIT_HARDENING_ARGS, "status", "--porcelain"]);
      expect(call?.[2]).toMatchObject({
        cwd: "/mock/repo",
        timeout: GIT_EXEC_TIMEOUT,
      });
    } finally {
      spy.mockRestore();
    }
  });

  it("defaultGitRunner successfully executes git status in current directory", () => {
    const output = defaultGitRunner(["status", "--porcelain"], process.cwd());
    expect(typeof output).toBe("string");
  });

  it("detects current directory is inside a git repository", () => {
    expect(isDefinitelyOutsideGitRepository(process.cwd())).toBe(false);
  });

  it("returns true for a temp directory without git markers", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cxstatusline-no-git-"));
    try {
      expect(isDefinitelyOutsideGitRepository(tmp)).toBe(false || true); // Depends on system tmpdir enclosing
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("getGitDiffChanges returns null without error for non-existent directory", () => {
    expect(getGitDiffChanges("/path/that/definitely/does/not/exist/12345")).toBeNull();
  });

  describe("git command cache TTL timestamping", () => {
    let tempDir: string;

    beforeEach(() => {
      clearGitCache();
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cxstatusline-git-cache-test-"));
      fs.mkdirSync(path.join(tempDir, ".git"));
      fs.writeFileSync(path.join(tempDir, ".git", "HEAD"), "ref: refs/heads/main\n");
    });

    afterEach(() => {
      clearGitCache();
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("gives a slow command a full TTL measured from when it finished", () => {
      let currentTime = 1000;
      const nowSpy = spyOn(Date, "now").mockImplementation(() => currentTime);
      const context: RenderContext = {
        data: {
          payload_version: 1,
          session: { cwd: tempDir },
        },
        gitCacheTtlSeconds: 5,
        now: new Date(),
        terminalWidth: 80,
        isPreview: false,
      };

      let execCallCount = 0;
      const execSpy = (spyOn(childProcess, "execFileSync") as any).mockImplementation(() => {
        execCallCount += 1;
        // The command took 6s, longer than the 5s TTL
        currentTime = 7000;
        return " M src/app.ts\0";
      });

      try {
        expect(runGit("status --porcelain -z", context)).toBe(" M src/app.ts\0");
        expect(execCallCount).toBe(1);

        // At 11000ms (4s after command finished at 7000ms), 5s TTL has NOT expired
        currentTime = 11000;
        expect(runGit("status --porcelain -z", context)).toBe(" M src/app.ts\0");
        expect(execCallCount).toBe(1);

        // In-memory cache cleared; persistent cache still fresh
        clearGitCache();
        expect(runGit("status --porcelain -z", context)).toBe(" M src/app.ts\0");
        expect(execCallCount).toBe(1);

        // At 13000ms (6s after command finished at 7000ms), TTL has expired
        currentTime = 13000;
        clearGitCache();
        expect(runGit("status --porcelain -z", context)).toBe(" M src/app.ts\0");
        expect(execCallCount).toBe(2);
      } finally {
        nowSpy.mockRestore();
        execSpy.mockRestore();
      }
    });

    it("gives a slow failure a full TTL measured from when git gave up", () => {
      let currentTime = 1000;
      const nowSpy = spyOn(Date, "now").mockImplementation(() => currentTime);
      const context: RenderContext = {
        data: {
          payload_version: 1,
          session: { cwd: tempDir },
        },
        gitCacheTtlSeconds: 5,
        now: new Date(),
        terminalWidth: 80,
        isPreview: false,
      };

      let execCallCount = 0;
      const execSpy = (spyOn(childProcess, "execFileSync") as any).mockImplementation(() => {
        execCallCount += 1;
        // Timeout after 6s
        currentTime = 7000;
        throw new Error("spawnSync git ETIMEDOUT");
      });

      try {
        expect(runGit("diff --shortstat", context)).toBeNull();
        expect(execCallCount).toBe(1);

        // 4s after failure at 7000ms -> still cached
        currentTime = 11000;
        expect(runGit("diff --shortstat", context)).toBeNull();
        expect(execCallCount).toBe(1);

        clearGitCache();
        expect(runGit("diff --shortstat", context)).toBeNull();
        expect(execCallCount).toBe(1);

        // At 13000ms (6s after failure at 7000ms), TTL has expired
        currentTime = 13000;
        clearGitCache();
        expect(runGit("diff --shortstat", context)).toBeNull();
        expect(execCallCount).toBe(2);
      } finally {
        nowSpy.mockRestore();
        execSpy.mockRestore();
      }
    });
  });
});
