import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { compareSemver, parseSemver } from "../version";
import { VERSION } from "../version-info";

export interface InstallTypeInfo {
  readonly type: "git" | "bun" | "pnpm" | "npm";
  readonly repoDir?: string;
}

export interface UpdateToolDeps {
  readonly fetchLatestVersion?: () => Promise<string | null>;
  readonly detectInstallType?: () => InstallTypeInfo;
  readonly execCommand?: (cmd: string, args: string[]) => { status: number; stdout: string; stderr: string };
  readonly currentVersion?: string;
}

export interface UpdateToolIo {
  stdout(s: string): void;
  stderr(s: string): void;
}

export async function defaultFetchLatestVersion(): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch("https://registry.npmjs.org/cxstatusline/latest", {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: unknown };
    return typeof data.version === "string" ? data.version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function detectInstallType(binaryPath = process.argv[1]): InstallTypeInfo {
  if (!binaryPath) return { type: "npm" };

  try {
    let resolved = binaryPath;
    try {
      resolved = realpathSync(binaryPath);
    } catch {
      // Keep original path if realpath fails
    }

    // Check if resolved path is inside a git checkout of cxstatusline
    let dir = dirname(resolved);
    for (let i = 0; i < 5; i++) {
      if (existsSync(join(dir, ".git")) && existsSync(join(dir, "package.json"))) {
        return { type: "git", repoDir: dir };
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }

    if (binaryPath.includes(".bun") || resolved.includes(".bun")) {
      return { type: "bun" };
    }
    if (binaryPath.includes("pnpm") || resolved.includes("pnpm")) {
      return { type: "pnpm" };
    }
  } catch {
    // Fall back to npm
  }

  return { type: "npm" };
}

export function defaultExecCommand(cmd: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const res = spawnSync(cmd, args, { encoding: "utf8" });
  return {
    status: res.status ?? (res.error ? 1 : 0),
    stdout: res.stdout || "",
    stderr: res.stderr || (res.error ? res.error.message : ""),
  };
}

export async function runUpdateTool(
  flags: readonly string[],
  io: UpdateToolIo,
  deps: UpdateToolDeps = {},
): Promise<number> {
  const checkOnly = flags.includes("--check");
  const currentVersionStr = deps.currentVersion ?? VERSION;
  const currentSemver = parseSemver(currentVersionStr);
  if (!currentSemver) {
    io.stderr(`Invalid current version: ${currentVersionStr}\n`);
    return 1;
  }

  io.stdout("Checking for cxstatusline updates...\n");

  const fetcher = deps.fetchLatestVersion ?? defaultFetchLatestVersion;
  const latest = await fetcher();

  if (!latest) {
    io.stderr("Failed to check for updates: could not reach npm registry.\n");
    return 1;
  }

  const latestSemver = parseSemver(latest);
  if (!latestSemver) {
    io.stderr(`Invalid version received from registry: ${latest}\n`);
    return 1;
  }

  if (compareSemver(latestSemver, currentSemver) <= 0) {
    io.stdout(`cxstatusline is already up to date (${currentVersionStr}).\n`);
    return 0;
  }

  if (checkOnly) {
    io.stdout(`Update available: ${currentVersionStr} -> ${latest}\n`);
    io.stdout("Run `cxstatusline update` to upgrade the tool.\n");
    return 0;
  }

  const detector = deps.detectInstallType ?? (() => detectInstallType());
  const installInfo = detector();
  const exec = deps.execCommand ?? defaultExecCommand;

  if (installInfo.type === "git" && installInfo.repoDir) {
    io.stdout(`Updating cxstatusline from git repository at ${installInfo.repoDir}...\n`);

    const pull = exec("git", ["-C", installInfo.repoDir, "pull", "origin", "main"]);
    if (pull.status !== 0) {
      io.stderr(`Failed to update cxstatusline via git pull:\n${pull.stderr || pull.stdout}\n`);
      return 1;
    }

    const install = exec("bun", ["--cwd", installInfo.repoDir, "install", "--frozen-lockfile"]);
    if (install.status !== 0) {
      io.stderr(`Failed to run bun install in repo:\n${install.stderr || install.stdout}\n`);
      return 1;
    }

    const build = exec("bun", ["--cwd", installInfo.repoDir, "run", "build"]);
    if (build.status !== 0) {
      io.stderr(`Failed to build cxstatusline in repo:\n${build.stderr || build.stdout}\n`);
      return 1;
    }

    io.stdout("Successfully updated cxstatusline from git checkout.\n");
    return 0;
  }

  let command = "npm";
  let args = ["install", "-g", "cxstatusline@latest"];

  if (installInfo.type === "bun") {
    command = "bun";
    args = ["add", "-g", "cxstatusline@latest"];
  } else if (installInfo.type === "pnpm") {
    command = "pnpm";
    args = ["add", "-g", "cxstatusline@latest"];
  }

  io.stdout(`Updating cxstatusline via ${command} (${command} ${args.join(" ")})...\n`);
  const result = exec(command, args);

  if (result.status !== 0) {
    io.stderr(`Failed to update cxstatusline:\n${result.stderr || result.stdout}\n`);
    io.stderr(`You can try updating manually with: ${command} ${args.join(" ")}\n`);
    return 1;
  }

  io.stdout(`Successfully updated cxstatusline to ${latest}.\n`);
  return 0;
}
