import { spawnSync } from "node:child_process";

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
  const result = spawnSync("git", args, {
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

export function getGitDiffChanges(cwd?: string, runner: GitRunner = defaultGitRunner): GitChangeCounts | null {
  if (!cwd) return null;

  try {
    const unstaged = runner(["diff", "--no-ext-diff", "--shortstat"], cwd);
    const staged = runner(["diff", "--cached", "--no-ext-diff", "--shortstat"], cwd);

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
