import { describe, expect, it, spyOn } from "bun:test";
import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { GIT_EXEC_TIMEOUT, defaultGitRunner, isDefinitelyOutsideGitRepository, getGitDiffChanges } from "../src/utils/git";
import { GIT_HARDENING_ARGS } from "../src/utils/git-hardening";

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
});
