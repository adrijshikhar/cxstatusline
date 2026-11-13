import { execFileSync } from 'node:child_process';

import type { RenderContext } from '../types/RenderContext';
import { resolveExecutable } from './executable-path';
import { resolveGitCwd } from './git';

const JJ_COMMAND_TIMEOUT_MS = 5_000;

export interface JjChangeCounts {
  insertions: number;
  deletions: number;
}

export function runJjArgs(args: string[], context: RenderContext, allowEmpty = false): string | null {
  try {
    const cwd = resolveGitCwd(context);
    // ui.color = "always" in the user's jj config colors jj's output even
    // into a pipe, and its codes would override the widget's own colors
    const output = execFileSync(resolveExecutable('jj'), ['--color=never', ...args], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: JJ_COMMAND_TIMEOUT_MS,
      windowsHide: true,
      ...(cwd ? { cwd } : {}),
    }).trimEnd();

    return allowEmpty || output.length > 0 ? output : null;
  } catch {
    return null;
  }
}

export function isInsideJjRepo(context: RenderContext): boolean {
  return runJjArgs(['root'], context) !== null;
}

export function parseDiffStat(stat: string): JjChangeCounts {
  const lines = stat.trimEnd().split('\n');
  const summaryLine = lines.slice().reverse().find(line => /(?:\d+\s+files?\s+changed|\d+\s+insertions?|\d+\s+deletions?)/i.test(line)) ?? '';
  const insertMatch = /(\d+)\s+insertions?/.exec(summaryLine);
  const deleteMatch = /(\d+)\s+deletions?/.exec(summaryLine);

  return {
    insertions: insertMatch?.[1] ? Number.parseInt(insertMatch[1], 10) : 0,
    deletions: deleteMatch?.[1] ? Number.parseInt(deleteMatch[1], 10) : 0,
  };
}

export function getJjChangeCounts(context: RenderContext): JjChangeCounts {
  return parseDiffStat(runJjArgs(['diff', '--stat'], context) ?? '');
}
