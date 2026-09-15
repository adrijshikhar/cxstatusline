import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { getGitDiffChanges, parseDiffShortStat } from "../src/utils/git";
import { GitChangesWidget } from "../src/widgets/GitChanges";
import { DEFAULT_SETTINGS } from "../src/types/Settings";
import type { RenderContext } from "../src/types/RenderContext";

describe("parseDiffShortStat", () => {
  test("parses insertions and deletions", () => {
    expect(parseDiffShortStat(" 2 files changed, 14 insertions(+), 5 deletions(-)")).toEqual({
      additions: 14,
      deletions: 5,
    });
  });

  test("parses insertions only", () => {
    expect(parseDiffShortStat(" 1 file changed, 42 insertions(+)")).toEqual({
      additions: 42,
      deletions: 0,
    });
  });

  test("parses deletions only", () => {
    expect(parseDiffShortStat(" 1 file changed, 7 deletions(-)")).toEqual({
      additions: 0,
      deletions: 7,
    });
  });

  test("handles empty or non-matching string", () => {
    expect(parseDiffShortStat("")).toEqual({ additions: 0, deletions: 0 });
    expect(parseDiffShortStat("nothing to commit")).toEqual({ additions: 0, deletions: 0 });
  });
});

describe("getGitDiffChanges with custom runner", () => {
  test("sums unstaged and staged additions and deletions", () => {
    const runner = (args: string[]) => {
      if (args.includes("--cached")) {
        return " 1 file changed, 5 insertions(+), 1 deletion(-)";
      }
      return " 2 files changed, 10 insertions(+), 3 deletions(-)";
    };

    const changes = getGitDiffChanges("/fake/dir", runner);
    expect(changes).toEqual({
      additions: 15,
      deletions: 4,
    });
  });

  test("returns null when runner throws or fails", () => {
    const runner = () => {
      throw new Error("not a git repository");
    };
    expect(getGitDiffChanges("/fake/dir", runner)).toBeNull();
  });
});

describe("getGitDiffChanges in real git repository", () => {
  test("reports uncommitted working tree diff in real time", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "cxstatusline-git-test-"));
    try {
      spawnSync("git", ["init"], { cwd: tempDir });
      spawnSync("git", ["config", "user.name", "Test"], { cwd: tempDir });
      spawnSync("git", ["config", "user.email", "test@test.com"], { cwd: tempDir });

      const file = join(tempDir, "sample.txt");
      writeFileSync(file, "line 1\nline 2\n");
      spawnSync("git", ["add", "sample.txt"], { cwd: tempDir });
      spawnSync("git", ["commit", "-m", "initial"], { cwd: tempDir });

      // Clean working tree
      expect(getGitDiffChanges(tempDir)).toEqual({ additions: 0, deletions: 0 });

      // Add a line (unstaged)
      writeFileSync(file, "line 1\nline 2\nline 3\n");
      expect(getGitDiffChanges(tempDir)).toEqual({ additions: 1, deletions: 0 });

      // Stage the change
      spawnSync("git", ["add", "sample.txt"], { cwd: tempDir });
      expect(getGitDiffChanges(tempDir)).toEqual({ additions: 1, deletions: 0 });

      // Add another unstaged change
      writeFileSync(file, "line 1\nline 2\nline 3\nline 4\n");
      expect(getGitDiffChanges(tempDir)).toEqual({ additions: 2, deletions: 0 });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe("GitChangesWidget", () => {
  const widget = new GitChangesWidget();

  test("uses live git diff changes when available", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "cxstatusline-widget-test-"));
    try {
      spawnSync("git", ["init"], { cwd: tempDir });
      spawnSync("git", ["config", "user.name", "Test"], { cwd: tempDir });
      spawnSync("git", ["config", "user.email", "test@test.com"], { cwd: tempDir });
      const file = join(tempDir, "file.txt");
      writeFileSync(file, "hello\n");
      spawnSync("git", ["add", "file.txt"], { cwd: tempDir });
      spawnSync("git", ["commit", "-m", "init"], { cwd: tempDir });

      writeFileSync(file, "hello\nworld\n");

      const context: RenderContext = {
        data: {
          payload_version: 1,
          git: { changes: { additions: 0, deletions: 0 } }, // Stale payload from Codex!
          session: { cwd: tempDir },
        },
        now: new Date(),
        terminalWidth: 80,
        isPreview: false,
        liveGit: true,
      };

      const result = widget.render({ id: "git-changes", type: "git-changes" }, context, DEFAULT_SETTINGS);
      expect(result).toBe("(+1,-0)");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("falls back to payload changes when live diff is null", () => {
    const context: RenderContext = {
      data: {
        payload_version: 1,
        git: { changes: { additions: 7, deletions: 2 } },
        session: { cwd: "/nonexistent/path/for/test" },
      },
      now: new Date(),
      terminalWidth: 80,
      isPreview: false,
      liveGit: true,
    };

    const result = widget.render({ id: "git-changes", type: "git-changes" }, context, DEFAULT_SETTINGS);
    expect(result).toBe("(+7,-2)");
  });
});
