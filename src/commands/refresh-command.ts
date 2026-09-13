import { lstatSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { resolvePaths } from '../paths';
import type { Env } from '../env';
import {
    CACHE_MAX_AGE_MS,
    cacheKey as deriveCacheKey,
    readDocument,
    REFRESH_TIMEOUT_MS,
    writeDocument,
    type CacheDocument
} from '../widgets/shared/cached-command';
import { spawnCommand, type CommandRunner } from '../widgets/shared/command-runner';

export interface RefreshCommandDeps {
    env: Env;
    runner?: CommandRunner;
    now?: () => number;
}

function evictOldEntries(dir: string, now: number): void {
    try {
        const entries = readdirSync(dir);
        for (const entry of entries) {
            if (entry.endsWith('.json') || (entry.startsWith('.') && entry.endsWith('.tmp'))) {
                const filePath = join(dir, entry);
                try {
                    const st = lstatSync(filePath);
                    if (now - st.mtimeMs > CACHE_MAX_AGE_MS) {
                        unlinkSync(filePath);
                    }
                } catch {
                    // Ignore errors during individual file eviction
                }
            }
        }
    } catch {
        // Ignore errors reading directory
    }
}

export function runRefreshCommand(cacheKey: string, deps: RefreshCommandDeps): number {
    if (!/^[0-9a-f]{16}$/.test(cacheKey)) {
        return 2;
    }

    const paths = resolvePaths(deps.env);
    const docPath = join(paths.commandCacheDir, `${cacheKey}.json`);

    const doc = readDocument(docPath);
    if (doc === 'miss') {
        return 0;
    }

    if (deriveCacheKey(doc.command, doc.cwd) !== cacheKey) {
        return 2;
    }

    const runner = deps.runner ?? spawnCommand;
    const start = performance.now();
    const result = runner({
        command: doc.command,
        input: doc.input,
        timeoutMs: REFRESH_TIMEOUT_MS,
        cwd: doc.cwd && doc.cwd.length > 0 ? doc.cwd : undefined
    });
    const elapsed = performance.now() - start;
    const timedOut = result.errorCode === 'ETIMEDOUT' || elapsed >= REFRESH_TIMEOUT_MS;

    const now = (deps.now ?? Date.now)();
    const updatedDoc: CacheDocument = {
        ...doc,
        result: { ...result, timedOut },
        producedAt: now
    };

    try {
        writeDocument(docPath, updatedDoc);
    } catch {
        return 1;
    }

    evictOldEntries(paths.commandCacheDir, now);
    return 0;
}
