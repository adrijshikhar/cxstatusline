import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { RenderContext } from '../types/RenderContext';
import { resolveExecutable } from './executable-path';
import {
  GIT_HARDENING_ARGS,
  getFilterOverrideArgs,
  parseFilterConfig,
  type FilterConfigEntry,
} from './git-hardening';

export interface GitChangeCounts {
  readonly additions: number;
  readonly deletions: number;
  readonly insertions?: number;
}

export interface GitFileStatusCounts {
  staged: number;
  unstaged: number;
  untracked: number;
}

export type GitRunner = (args: string[], cwd: string) => string;

interface GitRepoMetadata {
  cachePath: string;
  headMtimeMs: number | null;
  indexMtimeMs: number | null;
}

interface GitCacheEntry {
  output: string | null;
  createdAt: number;
  headMtimeMs: number | null;
  indexMtimeMs: number | null;
}

interface PersistentGitCache {
  version: 1;
  cwd: string | null;
  entries: Record<string, GitCacheEntry>;
}

export const DEFAULT_GIT_CACHE_TTL_SECONDS = 5;
const GIT_CACHE_SCHEMA_VERSION = 1 as const;

export const GIT_EXEC_TIMEOUT = 5_000;
const GIT_COMMAND_TIMEOUT_MS = GIT_EXEC_TIMEOUT;

const gitCommandCache = new Map<string, GitCacheEntry>();
const filterOverrideCache = new Map<string, string[] | null>();

const WORK_TREE_COMMAND_ARGS = new Map<string, string[]>([
  ['status', ['--ignore-submodules=dirty']],
  ['diff', ['--no-ext-diff', '--no-textconv', '--ignore-submodules=dirty']],
]);

const GIT_CONFIG_NO_MATCH_STATUS = 1;

function getCacheDir(): string {
  const base = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  return path.join(base, 'cxstatusline');
}

function getCachePath(gitDir: string, cwd: string): string {
  const repoHash = createHash('sha256')
    .update(`${gitDir}\0${cwd}`)
    .digest('hex')
    .slice(0, 16);

  return path.join(getCacheDir(), 'git-cache', `git-${repoHash}.json`);
}

function getMtimeMs(filePath: string): number | null {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
}

function normalizeDirectory(candidate: string): string | null {
  try {
    const resolved = path.resolve(candidate);
    const stats = fs.statSync(resolved);
    return stats.isDirectory() ? resolved : path.dirname(resolved);
  } catch {
    return null;
  }
}

function readGitDirFile(gitFilePath: string): string | null {
  try {
    const content = fs.readFileSync(gitFilePath, 'utf-8').trim();
    const match = /^gitdir:\s*(\S.*)$/i.exec(content);
    if (!match?.[1]) {
      return null;
    }

    return path.resolve(path.dirname(gitFilePath), match[1]);
  } catch {
    return null;
  }
}

function discoverGitDir(startDir: string): string | null {
  let current = startDir;

  for (;;) {
    const gitPath = path.join(current, '.git');

    try {
      const stats = fs.statSync(gitPath);
      if (stats.isDirectory()) {
        return gitPath;
      }
      if (stats.isFile()) {
        return readGitDirFile(gitPath);
      }
    } catch {
      // Keep walking up.
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function findWorkTreeRoot(startDir: string): string | null {
  let current = startDir;

  for (;;) {
    if (fs.existsSync(path.join(current, '.git'))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function readTextFile(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

function mayDefineFilters(gitDir: string): boolean {
  const commonDir = readTextFile(path.join(gitDir, 'commondir')).trim();
  const configDirs = [gitDir, ...(commonDir ? [path.resolve(gitDir, commonDir)] : [])];
  const configText = configDirs
    .flatMap(dir => [path.join(dir, 'config'), path.join(dir, 'config.worktree')])
    .map(readTextFile)
    .join('\n');

  return /filter|include/i.test(configText);
}

function gitExecOptions(cwd: string | undefined) {
  return {
    encoding: 'utf8' as const,
    stdio: ['pipe', 'pipe', 'ignore'] as ['pipe', 'pipe', 'ignore'],
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    timeout: GIT_COMMAND_TIMEOUT_MS,
    windowsHide: true,
    ...(cwd ? { cwd } : {}),
  };
}

function readFilterConfig(args: string[], cwd: string | undefined): string | null {
  try {
    return execFileSync(
      resolveExecutable('git'),
      [...GIT_HARDENING_ARGS, 'config', ...args, '-z', '--get-regexp', '^filter\\.'],
      gitExecOptions(cwd)
    );
  } catch (error) {
    return (error as { status?: unknown }).status === GIT_CONFIG_NO_MATCH_STATUS ? '' : null;
  }
}

function readRepositoryFilterConfig(cwd: string | undefined): FilterConfigEntry[] | null {
  const scoped = readFilterConfig(['--includes', '--show-scope'], cwd);
  if (scoped !== null) {
    return parseFilterConfig(scoped, true);
  }

  const local = readFilterConfig(['--local', '--includes'], cwd);
  if (local === null) {
    return null;
  }
  const worktree = readFilterConfig(['--worktree', '--includes'], cwd) ?? '';
  return [...parseFilterConfig(local, false), ...parseFilterConfig(worktree, false)];
}

function getRepositoryFilterOverrideArgs(cwd: string | undefined): string[] | null {
  const cacheKey = cwd ?? '';
  const cached = filterOverrideCache.get(cacheKey);
  if (cached !== undefined || filterOverrideCache.has(cacheKey)) {
    return cached ?? null;
  }

  const startDir = normalizeDirectory(cwd ?? process.cwd()) ?? process.cwd();
  const gitDir = discoverGitDir(startDir);
  let overrides: string[] | null = [];
  if (gitDir && mayDefineFilters(gitDir)) {
    const entries = readRepositoryFilterConfig(cwd);
    overrides = entries === null
      ? null
      : getFilterOverrideArgs(entries, findWorkTreeRoot(startDir) ?? startDir);
  }

  filterOverrideCache.set(cacheKey, overrides);
  return overrides;
}

export function execGit(args: string[], cwd: string | undefined, encoding: 'utf8' | 'latin1' = 'utf8'): string {
  const [subcommand = '', ...rest] = args;
  const workTreeArgs = WORK_TREE_COMMAND_ARGS.get(subcommand);
  const filterArgs = workTreeArgs ? getRepositoryFilterOverrideArgs(cwd) : [];
  if (filterArgs === null) {
    throw new Error("The repository's filter drivers could not be turned off");
  }

  return execFileSync(
    resolveExecutable('git'),
    [...GIT_HARDENING_ARGS, ...filterArgs, subcommand, ...(workTreeArgs ?? []), ...rest],
    { ...gitExecOptions(cwd), encoding }
  );
}

function getGitRepoMetadata(cwd: string | undefined): GitRepoMetadata | null {
  if (!cwd) {
    return null;
  }

  const startDir = normalizeDirectory(cwd);
  if (!startDir) {
    return null;
  }

  const gitDir = discoverGitDir(startDir);
  if (!gitDir) {
    return null;
  }

  return {
    cachePath: getCachePath(gitDir, cwd),
    headMtimeMs: getMtimeMs(path.join(gitDir, 'HEAD')),
    indexMtimeMs: getMtimeMs(path.join(gitDir, 'index')),
  };
}

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
    for (const marker of ['.git', 'HEAD']) {
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

function getGitCacheTtlMs(context: RenderContext): number {
  const ttlSeconds = context.gitCacheTtlSeconds;
  if (typeof ttlSeconds !== 'number' || !Number.isFinite(ttlSeconds)) {
    return DEFAULT_GIT_CACHE_TTL_SECONDS * 1000;
  }

  return Math.min(60, Math.max(0, ttlSeconds)) * 1000;
}

function isCacheEntry(value: unknown): value is GitCacheEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const entry = value as Record<string, unknown>;
  return (
    (typeof entry.output === 'string' || entry.output === null)
    && typeof entry.createdAt === 'number'
    && (typeof entry.headMtimeMs === 'number' || entry.headMtimeMs === null)
    && (typeof entry.indexMtimeMs === 'number' || entry.indexMtimeMs === null)
  );
}

function isCacheEntryFresh(
  entry: GitCacheEntry,
  metadata: GitRepoMetadata | null,
  ttlMs: number,
  now: number
): boolean {
  if (metadata) {
    if (entry.headMtimeMs !== metadata.headMtimeMs || entry.indexMtimeMs !== metadata.indexMtimeMs) {
      return false;
    }
  }

  return ttlMs === 0 || now - entry.createdAt <= ttlMs;
}

function readPersistentCache(cachePath: string): PersistentGitCache | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }

    const data = parsed as { version?: unknown; cwd?: unknown; entries?: unknown };
    if (
      data.version !== GIT_CACHE_SCHEMA_VERSION
      || (typeof data.cwd !== 'string' && data.cwd !== null)
      || typeof data.entries !== 'object'
      || data.entries === null
    ) {
      return null;
    }

    const entries: Record<string, GitCacheEntry> = {};
    for (const [key, value] of Object.entries(data.entries)) {
      if (isCacheEntry(value)) {
        entries[key] = value;
      }
    }

    return {
      version: GIT_CACHE_SCHEMA_VERSION,
      cwd: data.cwd,
      entries,
    };
  } catch {
    return null;
  }
}

function writePersistentCache(cachePath: string, cache: PersistentGitCache): void {
  const tempPath = `${cachePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(tempPath, JSON.stringify(cache), 'utf-8');
    fs.renameSync(tempPath, cachePath);
  } catch {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // Best-effort cleanup
    }
  }
}

function readPersistentCacheEntry(
  metadata: GitRepoMetadata | null,
  cacheKey: string,
  cwd: string | undefined,
  ttlMs: number,
  now: number
): GitCacheEntry | null {
  if (!metadata) {
    return null;
  }

  const cache = readPersistentCache(metadata.cachePath);
  if (cache?.cwd !== (cwd ?? null)) {
    return null;
  }

  const entry = cache.entries[cacheKey];
  if (!entry || !isCacheEntryFresh(entry, metadata, ttlMs, now)) {
    return null;
  }

  return entry;
}

function writePersistentCacheEntry(
  metadata: GitRepoMetadata | null,
  cacheKey: string,
  cwd: string | undefined,
  entry: GitCacheEntry
): void {
  if (!metadata) {
    return;
  }

  const cacheCwd = cwd ?? null;
  const existingCache = readPersistentCache(metadata.cachePath);
  const cache: PersistentGitCache = existingCache?.cwd === cacheCwd
    ? existingCache
    : {
        version: GIT_CACHE_SCHEMA_VERSION,
        cwd: cacheCwd,
        entries: {},
      };

  cache.entries[cacheKey] = entry;
  writePersistentCache(metadata.cachePath, cache);
}

function createCacheEntry(output: string | null, metadata: GitRepoMetadata | null, now: number): GitCacheEntry {
  return {
    output,
    createdAt: now,
    headMtimeMs: metadata?.headMtimeMs ?? null,
    indexMtimeMs: metadata?.indexMtimeMs ?? null,
  };
}

export function resolveGitCwd(context: RenderContext): string | undefined {
  const candidates = [
    (context.data as any)?.cwd,
    context.data?.session?.cwd,
    context.data?.session?.project_root,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
  }

  return undefined;
}

export function runGit(command: string, context: RenderContext): string | null {
  const args = command.trim().split(/\s+/).filter(Boolean);
  return runGitArgs(args, context, command);
}

export function runGitArgs(args: string[], context: RenderContext, cacheCommand?: string): string | null {
  return runGitArgsEncoded(args, context, cacheCommand, 'utf8');
}

export function runGitArgsEncoded(
  args: string[],
  context: RenderContext,
  cacheCommand: string | undefined,
  encoding: 'utf8' | 'latin1'
): string | null {
  const cwd = resolveGitCwd(context);
  const commandToken = cacheCommand ?? args.join('\0');
  const cacheToken = encoding === 'utf8' ? commandToken : `${encoding}\0${commandToken}`;
  const memoryCacheKey = `${cacheToken}|${cwd ?? ''}`;
  const persistentCacheKey = cacheToken;
  const metadata = getGitRepoMetadata(cwd);
  if (!metadata && cwd && isDefinitelyOutsideGitRepository(cwd)) {
    return null;
  }

  const ttlMs = getGitCacheTtlMs(context);
  const now = Date.now();

  const memoryEntry = gitCommandCache.get(memoryCacheKey);
  if (memoryEntry && isCacheEntryFresh(memoryEntry, metadata, ttlMs, now)) {
    return memoryEntry.output;
  }

  const persistentEntry = readPersistentCacheEntry(metadata, persistentCacheKey, cwd, ttlMs, now);
  if (persistentEntry) {
    gitCommandCache.set(memoryCacheKey, persistentEntry);
    return persistentEntry.output;
  }

  let result: string | null;
  try {
    const rawOutput = execGit(args, cwd, encoding);
    const output = encoding === 'utf8' ? rawOutput.trimEnd() : rawOutput;
    result = output.length > 0 ? output : null;
  } catch {
    result = null;
  }

  // Stamped after the run, so a command slower than the TTL still gets the full TTL.
  const entry = createCacheEntry(result, metadata, Date.now());
  gitCommandCache.set(memoryCacheKey, entry);
  writePersistentCacheEntry(metadata, persistentCacheKey, cwd, entry);
  return result;
}

export function clearGitCache(): void {
  gitCommandCache.clear();
  filterOverrideCache.clear();
}

export function isInsideGitWorkTree(context: RenderContext): boolean {
  return runGit('rev-parse --is-inside-work-tree', context) === 'true';
}

const BRANCH_REF_PREFIX = 'refs/heads/';

export function getGitBranch(context: RenderContext): string | null {
  const ref = runGit('symbolic-ref HEAD', context);
  return ref?.startsWith(BRANCH_REF_PREFIX) ? ref.slice(BRANCH_REF_PREFIX.length) : ref;
}

export function getGitShortSha(context: RenderContext): string | null {
  return runGit('rev-parse --short HEAD', context);
}

export function parseDiffShortStat(stat: string): GitChangeCounts {
  const insertMatch = /(\d+)\s+insertions?/.exec(stat);
  const deleteMatch = /(\d+)\s+deletions?/.exec(stat);

  return {
    additions: insertMatch?.[1] ? parseInt(insertMatch[1], 10) : 0,
    deletions: deleteMatch?.[1] ? parseInt(deleteMatch[1], 10) : 0,
  };
}

export function getGitChangeCounts(context: RenderContext): { insertions: number; deletions: number } {
  const unstagedStat = runGit('diff --shortstat', context) ?? '';
  const stagedStat = runGit('diff --cached --shortstat', context) ?? '';
  const unstagedCounts = parseDiffShortStat(unstagedStat);
  const stagedCounts = parseDiffShortStat(stagedStat);

  return {
    insertions: unstagedCounts.additions + stagedCounts.additions,
    deletions: unstagedCounts.deletions + stagedCounts.deletions,
  };
}

export const defaultGitRunner: GitRunner = (args: string[], cwd: string): string => {
  const gitExecutable = resolveExecutable('git');
  const result = spawnSync(gitExecutable, [...GIT_HARDENING_ARGS, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: GIT_EXEC_TIMEOUT,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    windowsHide: true,
  });

  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(`git exited with status ${result.status}`);
  }

  return result.stdout ?? '';
};

export function getGitDiffChanges(cwd?: string, runner: GitRunner = defaultGitRunner): GitChangeCounts | null {
  if (!cwd) return null;
  if (isDefinitelyOutsideGitRepository(cwd)) return null;

  try {
    const unstaged = runner(['diff', '--no-ext-diff', '--no-textconv', '--ignore-submodules=dirty', '--shortstat'], cwd);
    const staged = runner(['diff', '--cached', '--no-ext-diff', '--no-textconv', '--ignore-submodules=dirty', '--shortstat'], cwd);

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
