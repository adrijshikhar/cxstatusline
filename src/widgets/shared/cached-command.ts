import { chmodSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';

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

export interface CacheDocument {
    version: number;
    command: string;
    cwd: string;
    input: string;
    requestedAt: number;
    result: (CommandResult & { timedOut: boolean }) | null;
    producedAt: number | null;
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
            typeof data.requestedAt !== 'number'
        ) {
            return 'miss';
        }
        return data as CacheDocument;
    } catch {
        return 'miss';
    }
}

/** Writes a cache document to disk atomically, ensuring directory is 0700 and file is 0600 */
export function writeDocument(filePath: string, doc: CacheDocument): void {
    const dir = dirname(filePath);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
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

/** Shared execution seam for CustomCommandWidget */
export function resolveCommandText(
    item: WidgetItem,
    context: RenderContext,
    runner: CommandRunner
): string | null {
    return runSynchronously(item, context, runner);
}
