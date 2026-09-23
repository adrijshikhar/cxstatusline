import { readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "../atomic";
import type { RenderContext } from "../types/RenderContext";
import type { SpeedMetrics } from "../types/SpeedMetrics";
export { formatSpeed } from "./speed-metrics";

export interface SpeedSample {
  readonly timeMs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface SpeedCacheData {
  readonly version: 1;
  readonly sessionId: string;
  readonly startedAt: string;
  readonly baselineTokens: {
    readonly input: number;
    readonly output: number;
  };
  readonly lastSample: SpeedSample;
  readonly samples: SpeedSample[];
  readonly lastActiveMetrics: SpeedMetrics;
  readonly lastActiveTimeMs: number;
}

const memoryCache = new Map<string, SpeedCacheData>();

export function resetSpeedTrackerMemoryCache(): void {
  memoryCache.clear();
}

function sanitizeCacheKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function readCache(cacheDir: string | undefined, sessionId: string): SpeedCacheData | null {
  const inMemory = memoryCache.get(sessionId);
  if (inMemory) return inMemory;
  if (!cacheDir) return null;

  try {
    const filePath = join(cacheDir, `speed-${sanitizeCacheKey(sessionId)}.json`);
    const raw = readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);
    if (data?.version === 1 && data?.sessionId === sessionId) {
      memoryCache.set(sessionId, data);
      return data;
    }
  } catch {
    // Ignore read or parse errors
  }
  return null;
}

function writeCache(cacheDir: string | undefined, data: SpeedCacheData): void {
  memoryCache.set(data.sessionId, data);
  if (!cacheDir) return;

  try {
    const filePath = join(cacheDir, `speed-${sanitizeCacheKey(data.sessionId)}.json`);
    writeFileAtomic(filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
  } catch {
    // Ignore write errors
  }
}

const MAX_PLAUSIBLE_OUTPUT_SPEED = 10_000;
const MAX_PLAUSIBLE_INPUT_SPEED = 100_000;

/**
 * Resolves live SpeedMetrics from session usage and timestamps for live Codex runs.
 */
export function resolveLiveSpeedMetrics(context: RenderContext, windowSeconds?: number): SpeedMetrics | null {
  const session = context.data?.session;
  const startedAt = session?.started_at;
  const usage = context.data?.usage;
  if (!usage) {
    return null;
  }

  const currentInput = usage.input_tokens;
  const currentOutput = usage.output_tokens;
  if (currentInput === undefined && currentOutput === undefined) {
    return null;
  }

  const nowMs = context.now.getTime();
  const startedAtMs = startedAt ? Date.parse(startedAt) : NaN;
  const sessionId = session?.id ?? "default";
  const rawInput = currentInput ?? 0;
  const rawOutput = currentOutput ?? 0;

  // If commandCacheDir is available, perform robust baseline and delta tracking
  if (context.commandCacheDir) {
    const cached = readCache(context.commandCacheDir, sessionId);

    // If no cache or if this is a fresh process boot for the session, initialize baseline
    if (!cached || cached.sessionId !== sessionId || (startedAt && cached.startedAt !== startedAt)) {
      const initialCache: SpeedCacheData = {
        version: 1,
        sessionId,
        startedAt: startedAt ?? new Date(nowMs).toISOString(),
        baselineTokens: {
          input: rawInput,
          output: rawOutput,
        },
        lastSample: {
          timeMs: nowMs,
          inputTokens: rawInput,
          outputTokens: rawOutput,
        },
        samples: [
          {
            timeMs: nowMs,
            inputTokens: rawInput,
            outputTokens: rawOutput,
          },
        ],
        lastActiveMetrics: {
          totalDurationMs: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          requestCount: 0,
        },
        lastActiveTimeMs: nowMs,
      };
      writeCache(context.commandCacheDir, initialCache);
      return {
        totalDurationMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        requestCount: 0,
      };
    }

    // Token delta since last sample
    const deltaInput = rawInput - cached.lastSample.inputTokens;
    const deltaOutput = rawOutput - cached.lastSample.outputTokens;
    const elapsedSinceLastSec = Math.max(0, (nowMs - cached.lastSample.timeMs) / 1000);

    // Prune samples older than 125 seconds
    const samples = cached.samples.filter((s) => nowMs - s.timeMs <= 125_000);
    samples.push({
      timeMs: nowMs,
      inputTokens: rawInput,
      outputTokens: rawOutput,
    });

    let nextLastActiveMetrics = { ...cached.lastActiveMetrics };
    let nextLastActiveTimeMs = cached.lastActiveTimeMs;
    let nextLastSample = cached.lastSample;

    if ((deltaInput > 0 || deltaOutput > 0) && elapsedSinceLastSec >= 0.2) {
      const instInput = deltaInput > 0 ? deltaInput / elapsedSinceLastSec : 0;
      const instOutput = deltaOutput > 0 ? deltaOutput / elapsedSinceLastSec : 0;

      // Sanity filter to discard anomalies
      if (instOutput <= MAX_PLAUSIBLE_OUTPUT_SPEED && instInput <= MAX_PLAUSIBLE_INPUT_SPEED) {
        nextLastActiveMetrics = {
          totalDurationMs: Math.round(elapsedSinceLastSec * 1000),
          inputTokens: Math.max(0, deltaInput),
          outputTokens: Math.max(0, deltaOutput),
          totalTokens: Math.max(0, deltaInput) + Math.max(0, deltaOutput),
          requestCount: cached.lastActiveMetrics.requestCount + 1,
        };
        nextLastActiveTimeMs = nowMs;
        nextLastSample = {
          timeMs: nowMs,
          inputTokens: rawInput,
          outputTokens: rawOutput,
        };
      }
    }

    const updatedCache: SpeedCacheData = {
      ...cached,
      lastSample: nextLastSample,
      samples,
      lastActiveMetrics: nextLastActiveMetrics,
      lastActiveTimeMs: nextLastActiveTimeMs,
    };
    writeCache(context.commandCacheDir, updatedCache);

    // 1. If windowed speed is configured:
    if (windowSeconds && windowSeconds > 0) {
      const targetTime = nowMs - windowSeconds * 1000;
      const olderSample = samples.find((s) => s.timeMs >= targetTime) ?? samples[0];
      if (olderSample) {
        const windowElapsedSec = (nowMs - olderSample.timeMs) / 1000;
        if (windowElapsedSec >= 1) {
          const wInput = Math.max(0, rawInput - olderSample.inputTokens);
          const wOutput = Math.max(0, rawOutput - olderSample.outputTokens);
          return {
            totalDurationMs: Math.round(windowElapsedSec * 1000),
            inputTokens: wInput,
            outputTokens: wOutput,
            totalTokens: wInput + wOutput,
            requestCount: samples.length,
          };
        }
      }
      return {
        totalDurationMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        requestCount: 0,
      };
    }

    // 2. If recent active speed is available within 60s, return it
    if (nextLastActiveTimeMs && nowMs - nextLastActiveTimeMs <= 60_000 && nextLastActiveMetrics.totalDurationMs > 0) {
      return nextLastActiveMetrics;
    }

    return {
      totalDurationMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      requestCount: 0,
    };
  }

  // Fallback for stateless test fixtures (e.g. test/widgets.test.ts, test/owner-layout.test.ts)
  if (!Number.isNaN(startedAtMs)) {
    const elapsedSeconds = Math.max(1, (nowMs - startedAtMs) / 1000);
    const speedIn = rawInput / elapsedSeconds;
    const speedOut = rawOutput / elapsedSeconds;
    if (speedIn > MAX_PLAUSIBLE_INPUT_SPEED || speedOut > MAX_PLAUSIBLE_OUTPUT_SPEED) {
      return {
        totalDurationMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        requestCount: 0,
      };
    }
    const totalDurationMs = elapsedSeconds * 1000;
    return {
      totalDurationMs,
      inputTokens: rawInput,
      outputTokens: rawOutput,
      totalTokens: rawInput + rawOutput,
      requestCount: 1,
    };
  }

  return null;
}
