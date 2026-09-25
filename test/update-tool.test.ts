import { describe, expect, test } from "bun:test";
import { runUpdateTool, detectInstallType, type UpdateToolDeps } from "../src/commands/update-tool";

function mockIo() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      env: {},
      stdin: () => "",
      stdout: (s: string) => out.push(s),
      stderr: (s: string) => err.push(s),
      now: () => new Date(),
    },
    out,
    err,
  };
}

describe("update-tool", () => {
  test("reports already up to date when current version equals latest", async () => {
    const { io, out } = mockIo();
    const deps: UpdateToolDeps = {
      fetchLatestVersion: async () => "0.9.1",
      currentVersion: "0.9.1",
    };
    const code = await runUpdateTool([], io, deps);
    expect(code).toBe(0);
    expect(out.join("")).toContain("cxstatusline is already up to date (0.9.1)");
  });

  test("reports already up to date when current version is ahead of latest", async () => {
    const { io, out } = mockIo();
    const deps: UpdateToolDeps = {
      fetchLatestVersion: async () => "0.9.0",
      currentVersion: "0.9.1",
    };
    const code = await runUpdateTool([], io, deps);
    expect(code).toBe(0);
    expect(out.join("")).toContain("cxstatusline is already up to date (0.9.1)");
  });

  test("--check flag reports update available without executing installation", async () => {
    const { io, out } = mockIo();
    let executed = false;
    const deps: UpdateToolDeps = {
      fetchLatestVersion: async () => "0.9.2",
      currentVersion: "0.9.1",
      execCommand: () => {
        executed = true;
        return { status: 0, stdout: "", stderr: "" };
      },
    };
    const code = await runUpdateTool(["--check"], io, deps);
    expect(code).toBe(0);
    expect(out.join("")).toContain("Update available: 0.9.1 -> 0.9.2");
    expect(executed).toBe(false);
  });

  test("updates via npm when installType is npm", async () => {
    const { io, out } = mockIo();
    const commandsRun: string[] = [];
    const deps: UpdateToolDeps = {
      fetchLatestVersion: async () => "0.9.2",
      currentVersion: "0.9.1",
      detectInstallType: () => ({ type: "npm" }),
      execCommand: (cmd, args) => {
        commandsRun.push(`${cmd} ${args.join(" ")}`);
        return { status: 0, stdout: "", stderr: "" };
      },
    };
    const code = await runUpdateTool([], io, deps);
    expect(code).toBe(0);
    expect(commandsRun).toEqual(["npm install -g cxstatusline@latest"]);
    expect(out.join("")).toContain("Successfully updated cxstatusline to 0.9.2");
  });

  test("updates via bun when installType is bun", async () => {
    const { io, out } = mockIo();
    const commandsRun: string[] = [];
    const deps: UpdateToolDeps = {
      fetchLatestVersion: async () => "0.9.2",
      currentVersion: "0.9.1",
      detectInstallType: () => ({ type: "bun" }),
      execCommand: (cmd, args) => {
        commandsRun.push(`${cmd} ${args.join(" ")}`);
        return { status: 0, stdout: "", stderr: "" };
      },
    };
    const code = await runUpdateTool([], io, deps);
    expect(code).toBe(0);
    expect(commandsRun).toEqual(["bun add -g cxstatusline@latest"]);
    expect(out.join("")).toContain("Successfully updated cxstatusline to 0.9.2");
  });

  test("updates via git when installType is git checkout", async () => {
    const { io, out } = mockIo();
    const commandsRun: string[] = [];
    const deps: UpdateToolDeps = {
      fetchLatestVersion: async () => "0.9.2",
      currentVersion: "0.9.1",
      detectInstallType: () => ({ type: "git", repoDir: "/path/to/repo" }),
      execCommand: (cmd, args) => {
        commandsRun.push(`${cmd} ${args.join(" ")}`);
        return { status: 0, stdout: "", stderr: "" };
      },
    };
    const code = await runUpdateTool([], io, deps);
    expect(code).toBe(0);
    expect(commandsRun).toEqual([
      "git -C /path/to/repo pull origin main",
      "bun --cwd /path/to/repo install --frozen-lockfile",
      "bun --cwd /path/to/repo run build",
    ]);
    expect(out.join("")).toContain("Successfully updated cxstatusline from git checkout");
  });

  test("handles registry lookup failure gracefully", async () => {
    const { io, err } = mockIo();
    const deps: UpdateToolDeps = {
      fetchLatestVersion: async () => null,
      currentVersion: "0.9.1",
    };
    const code = await runUpdateTool([], io, deps);
    expect(code).toBe(1);
    expect(err.join("")).toContain("Failed to check for updates");
  });

  test("handles failed update command", async () => {
    const { io, err } = mockIo();
    const deps: UpdateToolDeps = {
      fetchLatestVersion: async () => "0.9.2",
      currentVersion: "0.9.1",
      detectInstallType: () => ({ type: "npm" }),
      execCommand: () => ({ status: 1, stdout: "", stderr: "EACCES permission denied" }),
    };
    const code = await runUpdateTool([], io, deps);
    expect(code).toBe(1);
    expect(err.join("")).toContain("Failed to update cxstatusline");
    expect(err.join("")).toContain("EACCES permission denied");
  });
});
