import { lstatSync, mkdirSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';

import { writeFileAtomic } from '../../atomic';
import type { RenderContext } from '../../types/RenderContext';
import type { WidgetItem } from '../../types/Widget';
import { getVisibleText, keepSgrOnly } from '../../utils/ansi';
import {
    describeFailure,
    refundBudget,
    resolveTimeout,
    takeBudget,
    type CommandResult,
    type CommandRunner
} from './command-runner';
import { applyMaxWidth } from './max-width';

export const CACHE_VERSION = 1;
export const MIN_REFRESH_MS = 1_000;
export const MAX_REFRESH_MS = 86_400_000;
export const REFRESH_TIMEOUT_MS = 10_000;
export const REQUEST_STALE_MS = 60_000;
export const CACHE_MAX_AGE_MS = 604_800_000;
export const LOADING_TOKEN = '[Loading]';
export const ERROR_TOKEN = '[Error]';

export interface CacheDeps {
    spawn: typeof import('node:child_process').spawn;
    scriptPath: string | undefined;   // production: process.argv[1]
    now: () => number;                // so staleness needs no sleeping
}

export const productionCacheDeps: CacheDeps = { spawn, scriptPath: process.argv[1], now: Date.now };

export function resolveRefresh(item: WidgetItem): number {
    const raw = item.refreshMs ?? 0;
    return Math.max(MIN_REFRESH_MS, Math.min(MAX_REFRESH_MS, raw));
}

export function scheduleRefresh(key: string, deps: CacheDeps): void {
    if (!deps.scriptPath) {
        return;
    }
    try {
        const child = deps.spawn(
            process.execPath,
            [deps.scriptPath, '--internal-refresh-command', key],
            { detached: true, stdio: 'ignore', windowsHide: true }
        );
        child.on('error', () => {});
        child.unref();
    } catch {
        // Ignored; requestedAt throttle protects against repeated spawn storms
    }
}

export interface CacheDocument {
    version: number;
    command: string;
    cwd: string;
    input: string;
    requestedAt: number;
    result: (CommandResult & { timedOut: boolean }) | null;
    producedAt: number | null;
    failedAt?: number | null;
}

/** 16-character lowercase hex digest uniquely identifying (command, cwd) */
export function cacheKey(command: string, cwd?: string): string {
    const normalizedCwd = cwd ?? '';
    return createHash('sha256')
        .update(command + '\0' + normalizedCwd)
        .digest('hex')
        .slice(0, 16);
}

/** Reads a cache document from disk, returning 'miss' on absent, unreadable, or invalid files */
export function readDocument(filePath: string): CacheDocument | 'miss' {
    try {
        const raw = readFileSync(filePath, 'utf8');
        const data = JSON.parse(raw);
        if (
            typeof data !== 'object' ||
            data === null ||
            data.version !== CACHE_VERSION ||
            typeof data.command !== 'string' ||
            typeof data.cwd !== 'string' ||
            typeof data.input !== 'string' ||
            typeof data.requestedAt !== 'number' ||
            !Number.isFinite(data.requestedAt)
        ) {
            return 'miss';
        }
        if (data.producedAt !== null && (typeof data.producedAt !== 'number' || !Number.isFinite(data.producedAt))) {
            return 'miss';
        }
        if (
            data.failedAt !== undefined &&
            data.failedAt !== null &&
            (typeof data.failedAt !== 'number' || !Number.isFinite(data.failedAt))
        ) {
            return 'miss';
        }
        if (data.result !== null) {
            if (typeof data.result !== 'object' || data.result === null) {
                return 'miss';
            }
            if (typeof data.result.stdout !== 'string') {
                return 'miss';
            }
            if (data.result.status !== null && (typeof data.result.status !== 'number' || !Number.isFinite(data.result.status))) {
                return 'miss';
            }
            if (data.result.signal !== null && typeof data.result.signal !== 'string') {
                return 'miss';
            }
        }
        return data as CacheDocument;
    } catch {
        return 'miss';
    }
}

/** Writes a cache document to disk atomically, ensuring directory is 0700 and file is 0600 */
export function writeDocument(filePath: string, doc: CacheDocument): void {
    const dir = dirname(filePath);
    try {
        if (lstatSync(dir).isSymbolicLink()) {
            throw new Error(`Command cache directory must not be a symlink: ${dir}`);
        }
    } catch (e: any) {
        if (e?.code !== 'ENOENT') {
            throw e;
        }
    }
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileAtomic(filePath, JSON.stringify(doc, null, 2), { mode: 0o600 });
}


/** First visibly non-empty line of stdout, trimmed. Codex rejects frames with blank or extra rows. */
export function firstLine(stdout: string): string {
    return stdout
        .split(/\r?\n/)
        .map(line => line.trim())
        .find(line => getVisibleText(line).trim().length > 0) ?? '';
}

/** Phase 1 output pipeline: failure token -> ANSI cleanup -> first line -> maxWidth -> null if empty */
export function processResult(
    result: CommandResult,
    item: WidgetItem,
    timedOut: boolean = false
): string | null {
    const failure = describeFailure(result, timedOut);
    if (failure) {
        return failure;
    }

    const line = firstLine(result.stdout);
    const cleaned = item.preserveColors ? keepSgrOnly(line) : keepSgrOnly(getVisibleText(line));
    const text = applyMaxWidth(cleaned, item.maxWidth);
    return getVisibleText(text).trim().length > 0 ? text : null;
}

/** Synchronous execution path: takes budget, spawns command, refunds unused budget, processes result */
export function runSynchronously(
    item: WidgetItem,
    context: RenderContext,
    runner: CommandRunner
): string | null {
    if (!item.commandPath) {
        return null;
    }

    const timeoutMs = takeBudget(context, resolveTimeout(item));
    if (timeoutMs === 0) {
        return '[Budget]';
    }

    const input = JSON.stringify(typeof context.terminalWidth === 'number'
        ? { ...context.data, terminal_width: context.terminalWidth }
        : context.data);
    const cwd = context.data.session?.cwd;
    const start = performance.now();
    const result = runner({
        command: item.commandPath,
        input,
        timeoutMs,
        cwd: cwd && cwd.length > 0 ? cwd : undefined
    });
    const elapsed = performance.now() - start;
    refundBudget(context, timeoutMs - elapsed);

    const timedOut = result.errorCode === 'ETIMEDOUT' || elapsed >= timeoutMs;
    return processResult(result, item, timedOut);
}

function runCached(
    item: WidgetItem,
    context: RenderContext,
    runner: CommandRunner,
    deps: CacheDeps
): string | null {
    if (!item.commandPath || !context.commandCacheDir) {
        return runSynchronously(item, context, runner);
    }

    const cwd = context.data.session?.cwd;
    const cwdStr = cwd && cwd.length > 0 ? cwd : '';
    const key = cacheKey(item.commandPath, cwdStr);
    const docPath = join(context.commandCacheDir, `${key}.json`);
    const input = JSON.stringify(typeof context.terminalWidth === 'number'
        ? { ...context.data, terminal_width: context.terminalWidth }
        : context.data);

    const doc = readDocument(docPath);
    const now = deps.now();
    const refreshMs = resolveRefresh(item);

    if (doc === 'miss') {
        const newDoc: CacheDocument = {
            version: CACHE_VERSION,
            command: item.commandPath,
            cwd: cwdStr,
            input,
            requestedAt: now,
            result: null,
            producedAt: null,
            failedAt: null
        };
        try {
            writeDocument(docPath, newDoc);
        } catch {
            return runSynchronously(item, context, runner);
        }
        scheduleRefresh(key, deps);
        return LOADING_TOKEN;
    }

    const since = (now: number, t: number) => (t > now ? Number.POSITIVE_INFINITY : Math.max(0, now - t));

    const inFlight = doc.requestedAt > (doc.producedAt ?? -1)
                  && since(now, doc.requestedAt) <= REQUEST_STALE_MS;

    if (inFlight) {
        if (doc.result === null) {
            return doc.failedAt !== null ? ERROR_TOKEN : LOADING_TOKEN;
        }
        return processResult(doc.result, item, doc.result.timedOut ?? false);
    }

    // not in flight
    if (doc.result === null) {
        const updatedDoc: CacheDocument = {
            ...doc,
            input,
            requestedAt: now,
            failedAt: now
        };
        try {
            writeDocument(docPath, updatedDoc);
        } catch {
            return runSynchronously(item, context, runner);
        }
        scheduleRefresh(key, deps);
        return ERROR_TOKEN;
    }

    const age = since(now, doc.producedAt ?? 0);
    if (age <= refreshMs) {
        return processResult(doc.result, item, doc.result.timedOut ?? false);
    }

    // not in flight, result present, age > refreshMs
    const updatedDoc: CacheDocument = {
        ...doc,
        input,
        requestedAt: now
    };
    try {
        writeDocument(docPath, updatedDoc);
    } catch {
        return runSynchronously(item, context, runner);
    }
    scheduleRefresh(key, deps);
    return processResult(doc.result, item, doc.result.timedOut ?? false);
}

/** Shared execution seam for CustomCommandWidget */
export function resolveCommandText(
    item: WidgetItem,
    context: RenderContext,
    runner: CommandRunner,
    deps: CacheDeps = productionCacheDeps
): string | null {
    if (!item.commandPath) {
        return null;
    }
    if (item.refreshMs === undefined || !context.commandCacheDir || context.isPreview) {
        return runSynchronously(item, context, runner);
    }
    return runCached(item, context, runner, deps);
}
