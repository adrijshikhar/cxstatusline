import { describe, expect, it, spyOn } from "bun:test";
import * as childProcess from "node:child_process";
import { GIT_EXEC_TIMEOUT, defaultGitRunner } from "../src/utils/git";

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
      expect(call?.[1]).toEqual(["status", "--porcelain"]);
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
});
