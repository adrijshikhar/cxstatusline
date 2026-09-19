import { describe, expect, it } from "bun:test";
import { GIT_EXEC_TIMEOUT, defaultGitRunner } from "../src/utils/git";

describe("git runner timeout", () => {
  it("defines GIT_EXEC_TIMEOUT as 5000ms", () => {
    expect(GIT_EXEC_TIMEOUT).toBe(5000);
  });

  it("defaultGitRunner successfully executes git status in current directory", () => {
    const output = defaultGitRunner(["status", "--porcelain"], process.cwd());
    expect(typeof output).toBe("string");
  });
});
