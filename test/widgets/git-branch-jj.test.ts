import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { GitBranchWidget } from "../../src/widgets/GitBranch";
import { DEFAULT_SETTINGS } from "../../src/types/Settings";
import type { RenderContext } from "../../src/types/RenderContext";
import type { WidgetItem } from "../../src/types/Widget";
import { clearGitCache } from "../../src/utils/git";

describe("GitBranchWidget fish-style & JJ enhancements", () => {
  const widget = new GitBranchWidget();

  beforeEach(() => {
    clearGitCache();
  });

  describe("fish-style branch abbreviation", () => {
    it.each([
      { name: "collapses a plain branch to its first letter", branch: "main", expected: "⎇ m" },
      { name: "keeps the last segment full", branch: "feature/worktree", expected: "⎇ f/worktree" },
      { name: "collapses intermediate segments", branch: "fix/patch/story", expected: "⎇ f/p/story" },
      { name: "preserves a non-BMP character in a single segment", branch: "🚀launch", expected: "⎇ 🚀" },
      { name: "preserves non-BMP characters in abbreviated segments", branch: "🚀launch/🧪tests/topic", expected: "⎇ 🚀/🧪/topic" },
    ])("$name", ({ branch, expected }) => {
      const item: WidgetItem = {
        id: "git-branch",
        type: "git-branch",
        metadata: { fishStyle: "true" },
      };
      const context: RenderContext = {
        data: {
          payload_version: 1,
          git: { branch },
        },
        now: new Date(),
        terminalWidth: 80,
        isPreview: false,
      };

      expect(widget.render(item, context, DEFAULT_SETTINGS)).toBe(expected);
    });

    it("does not abbreviate detached HEAD commit", () => {
      const item: WidgetItem = {
        id: "git-branch",
        type: "git-branch",
        metadata: { fishStyle: "true" },
      };
      const context: RenderContext = {
        data: {
          payload_version: 1,
          git: {},
          session: { cwd: "/mock/repo" },
        },
        now: new Date(),
        terminalWidth: 80,
        isPreview: false,
      };

      const spy = (spyOn(childProcess, "execFileSync") as any).mockImplementation((_cmd: string, args: string[]) => {
        const argStr = (args as string[]).join(" ");
        if (argStr.includes("symbolic-ref")) {
          throw new Error("fatal: ref HEAD is not a symbolic ref");
        }
        if (argStr.includes("jj") || (args as string[])[0] === "root") {
          throw new Error("Error: There is no jj repo in '.'");
        }
        if (argStr.includes("rev-parse --short HEAD")) {
          return "ddfb2de\n";
        }
        return "";
      });

      try {
        expect(widget.render(item, context, DEFAULT_SETTINGS)).toBe("⎇ (ddfb2de)");
      } finally {
        spy.mockRestore();
      }
    });

    it("abbreviates preview sample when fishStyle is enabled", () => {
      const item: WidgetItem = {
        id: "git-branch",
        type: "git-branch",
        metadata: { fishStyle: "true" },
      };
      const context: RenderContext = {
        data: { payload_version: 1 },
        now: new Date(),
        terminalWidth: 80,
        isPreview: true,
      };

      expect(widget.render(item, context, DEFAULT_SETTINGS)).toBe("⎇ m");
    });

    it("shows the fish-style modifier in editor display and custom keybinds", () => {
      const item: WidgetItem = {
        id: "git-branch",
        type: "git-branch",
        metadata: { fishStyle: "true" },
      };
      expect(widget.getEditorDisplay(item).modifierText).toBe("(fish-style)");

      const keybinds = widget.getCustomKeybinds();
      expect(keybinds).toContainEqual({
        key: "f",
        label: "(f)ish style",
        action: "toggle-fish-style",
      });
    });

    it("toggles fishStyle metadata on handleEditorAction", () => {
      const item: WidgetItem = {
        id: "git-branch",
        type: "git-branch",
      };
      const enabled = widget.handleEditorAction("toggle-fish-style", item);
      expect(enabled?.metadata?.fishStyle).toBe("true");

      const disabled = widget.handleEditorAction("toggle-fish-style", enabled!);
      expect(disabled?.metadata?.fishStyle).toBeUndefined();
    });
  });

  describe("in a jj workspace", () => {
    let workspaceDir: string;

    beforeEach(() => {
      workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "cxstatusline-git-branch-jj-"));
      fs.mkdirSync(path.join(workspaceDir, ".jj"));
      fs.mkdirSync(path.join(workspaceDir, ".git"));
      fs.writeFileSync(path.join(workspaceDir, ".git", "HEAD"), "ref: refs/heads/main\n");

      const nestedRepo = path.join(workspaceDir, "code", "app");
      fs.mkdirSync(path.join(nestedRepo, ".git"), { recursive: true });
      fs.writeFileSync(path.join(nestedRepo, ".git", "HEAD"), "ref: refs/heads/main\n");
    });

    afterEach(() => {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    });

    it("treats a colocated jj repo's detached HEAD as no branch", () => {
      const item: WidgetItem = {
        id: "git-branch",
        type: "git-branch",
      };
      const context: RenderContext = {
        data: {
          payload_version: 1,
          git: {},
          session: { cwd: workspaceDir },
        },
        now: new Date(),
        terminalWidth: 80,
        isPreview: false,
      };

      const spy = (spyOn(childProcess, "execFileSync") as any).mockImplementation((cmd: string, args: string[]) => {
        const argStr = (args as string[]).join(" ");
        if (cmd === "jj" || (args as string[])[0] === "root") {
          return `${workspaceDir}\n`;
        }
        if (argStr.includes("symbolic-ref")) {
          throw new Error("fatal: ref HEAD is not a symbolic ref");
        }
        if (argStr.includes("rev-parse --show-toplevel")) {
          return `${workspaceDir}\n`;
        }
        return "";
      });

      try {
        expect(widget.render(item, context, DEFAULT_SETTINGS)).toBe("⎇ no git");
      } finally {
        spy.mockRestore();
      }
    });

    it("hides no git when hide: no-git is set in a colocated jj repo", () => {
      const item: WidgetItem = {
        id: "git-branch",
        type: "git-branch",
        metadata: { hide: "no-git" },
      };
      const context: RenderContext = {
        data: {
          payload_version: 1,
          git: {},
          session: { cwd: workspaceDir },
        },
        now: new Date(),
        terminalWidth: 80,
        isPreview: false,
      };

      const spy = (spyOn(childProcess, "execFileSync") as any).mockImplementation((cmd: string, args: string[]) => {
        const argStr = (args as string[]).join(" ");
        if (cmd === "jj" || (args as string[])[0] === "root") {
          return `${workspaceDir}\n`;
        }
        if (argStr.includes("symbolic-ref")) {
          throw new Error("fatal: ref HEAD is not a symbolic ref");
        }
        if (argStr.includes("rev-parse --show-toplevel")) {
          return `${workspaceDir}\n`;
        }
        return "";
      });

      try {
        expect(widget.render(item, context, DEFAULT_SETTINGS)).toBeNull();
      } finally {
        spy.mockRestore();
      }
    });

    it("renders the short commit on detached HEAD in a git repo nested in a jj workspace", () => {
      const nestedRepo = path.join(workspaceDir, "code", "app");
      const item: WidgetItem = {
        id: "git-branch",
        type: "git-branch",
      };
      const context: RenderContext = {
        data: {
          payload_version: 1,
          git: {},
          session: { cwd: nestedRepo },
        },
        now: new Date(),
        terminalWidth: 80,
        isPreview: false,
      };

      const spy = (spyOn(childProcess, "execFileSync") as any).mockImplementation((cmd: string, args: string[]) => {
        const argStr = (args as string[]).join(" ");
        if (cmd === "jj" || (args as string[])[0] === "root") {
          return `${workspaceDir}\n`;
        }
        if (argStr.includes("symbolic-ref")) {
          throw new Error("fatal: ref HEAD is not a symbolic ref");
        }
        if (argStr.includes("rev-parse --show-toplevel")) {
          return `${nestedRepo}\n`;
        }
        if (argStr.includes("rev-parse --short HEAD")) {
          return "ddfb2de\n";
        }
        return "";
      });

      try {
        expect(widget.render(item, context, DEFAULT_SETTINGS)).toBe("⎇ (ddfb2de)");
      } finally {
        spy.mockRestore();
      }
    });
  });
});
