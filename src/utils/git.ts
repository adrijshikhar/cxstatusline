import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { GIT_HARDENING_ARGS } from "./git-hardening";
import { resolveExecutable } from "./executable-path";

export interface GitChangeCounts {
  readonly additions: number;
  readonly deletions: number;
}

export type GitRunner = (args: string[], cwd: string) => string;

export function parseDiffShortStat(stat: string): GitChangeCounts {
  const insertMatch = /(\d+)\s+insertions?/.exec(stat);
  const deleteMatch = /(\d+)\s+deletions?/.exec(stat);

  return {
    additions: insertMatch?.[1] ? parseInt(insertMatch[1], 10) : 0,
    deletions: deleteMatch?.[1] ? parseInt(deleteMatch[1], 10) : 0,
  };
}

export const GIT_EXEC_TIMEOUT = 5_000;

export const defaultGitRunner: GitRunner = (args: string[], cwd: string): string => {
  const gitExecutable = resolveExecutable("git");
  const result = spawnSync(gitExecutable, [...GIT_HARDENING_ARGS, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: GIT_EXEC_TIMEOUT,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    windowsHide: true,
  });

  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(`git exited with status ${result.status}`);
  }

  return result.stdout ?? "";
};

// True only when git is certain to fail with "not a git repository" in cwd,
// so getGitDiffChanges can skip spawning git.
export function isDefinitelyOutsideGitRepository(cwd: string): boolean {
  if (
    process.env.GIT_DIR !== undefined
    || process.env.GIT_WORK_TREE !== undefined
    || process.env.GIT_COMMON_DIR !== undefined
  ) {
    return false;
  }

  let current: string;
  try {
    current = fs.realpathSync(cwd);
    if (!fs.statSync(current).isDirectory()) {
      return false;
    }
  } catch {
    return false;
  }

  for (;;) {
    for (const marker of [".git", "HEAD"]) {
      try {
        fs.lstatSync(path.join(current, marker));
        return false;
      } catch {
        // Not present; keep looking.
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return true;
    }
    current = parent;
  }
}

export function getGitDiffChanges(cwd?: string, runner: GitRunner = defaultGitRunner): GitChangeCounts | null {
  if (!cwd) return null;
  if (isDefinitelyOutsideGitRepository(cwd)) return null;

  try {
    const unstaged = runner(["diff", "--no-ext-diff", "--no-textconv", "--ignore-submodules=dirty", "--shortstat"], cwd);
    const staged = runner(["diff", "--cached", "--no-ext-diff", "--no-textconv", "--ignore-submodules=dirty", "--shortstat"], cwd);

    const unstagedCounts = parseDiffShortStat(unstaged);
    const stagedCounts = parseDiffShortStat(staged);

    return {
      additions: unstagedCounts.additions + stagedCounts.additions,
      deletions: unstagedCounts.deletions + stagedCounts.deletions,
    };
  } catch {
    return null;
  }
}
