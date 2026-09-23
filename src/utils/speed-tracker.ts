import { readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "../atomic";
import type { NumberFormat } from "../types/NumberFormat";
import type { RenderContext } from "../types/RenderContext";
import type { WidgetItem } from "../types/Widget";
import { renderMagnitude } from "./number-format";
import { getWidgetSpeedWindowSeconds, isWidgetSpeedWindowEnabled } from "./speed-window";

export type SpeedKind = "input" | "output" | "total";

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
  readonly lastActiveSpeed: {
    readonly input: number | null;
    readonly output: number | null;
    readonly total: number | null;
    readonly timeMs: number;
  };
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

/**
 * Formats tokens per second into human-readable string (e.g. "42.5 t/s", "1.2k t/s", or "—").
 */
export function formatSpeed(tokensPerSec: number | null, format: NumberFormat = {}): string {
  if (tokensPerSec === null || !Number.isFinite(tokensPerSec) || tokensPerSec <= 0) {
    return "—";
  }

  if (tokensPerSec >= 1000) {
    return `${renderMagnitude(tokensPerSec / 1000, format, 1)}k t/s`;
  }

  return `${renderMagnitude(tokensPerSec, format, 1)} t/s`;
}

const PREVIEW_VALUES: Record<SpeedKind, { session: number; windowed: number }> = {
  input: { session: 85.2, windowed: 31.5 },
  output: { session: 42.5, windowed: 26.8 },
  total: { session: 127.7, windowed: 58.3 },
};

const MAX_PLAUSIBLE_OUTPUT_SPEED = 10_000;
const MAX_PLAUSIBLE_INPUT_SPEED = 100_000;

/**
 * Retrieves or calculates the token processing speed for the specified kind.
 */
export function calculateSpeed(kind: SpeedKind, item: WidgetItem, context: RenderContext): number | null {
  if (context.isPreview) {
    const isWindowed = isWidgetSpeedWindowEnabled(item);
    return isWindowed ? PREVIEW_VALUES[kind].windowed : PREVIEW_VALUES[kind].session;
  }

  const session = context.data.session;
  const startedAt = session?.started_at;
  const usage = context.data.usage;
  if (!session || !startedAt || !usage) {
    return null;
  }

  const currentInput = usage.input_tokens;
  const currentOutput = usage.output_tokens;
  if (currentInput === undefined && currentOutput === undefined) {
    return null;
  }

  const nowMs = context.now.getTime();
  const startedAtMs = Date.parse(startedAt);
  if (Number.isNaN(startedAtMs)) {
    return null;
  }

  const sessionId = session.id ?? "default";
  const rawInput = currentInput ?? 0;
  const rawOutput = currentOutput ?? 0;

  // If commandCacheDir is available, perform robust baseline and delta tracking
  if (context.commandCacheDir) {
    const cached = readCache(context.commandCacheDir, sessionId);

    // If no cache or if this is a fresh process boot for the session, initialize baseline
    if (!cached || cached.sessionId !== sessionId || cached.startedAt !== startedAt) {
      const initialCache: SpeedCacheData = {
        version: 1,
        sessionId,
        startedAt,
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
        lastActiveSpeed: {
          input: null,
          output: null,
          total: null,
          timeMs: nowMs,
        },
      };
      writeCache(context.commandCacheDir, initialCache);
      return null;
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

    let nextLastActiveSpeed = { ...cached.lastActiveSpeed };
    let nextLastSample = cached.lastSample;

    if ((deltaInput > 0 || deltaOutput > 0) && elapsedSinceLastSec >= 0.2) {
      const instInput = deltaInput > 0 ? deltaInput / elapsedSinceLastSec : null;
      const instOutput = deltaOutput > 0 ? deltaOutput / elapsedSinceLastSec : null;
      const instTotal = (Math.max(0, deltaInput) + Math.max(0, deltaOutput)) / elapsedSinceLastSec;

      // Sanity filter to discard anomalies
      if ((instOutput ?? 0) <= MAX_PLAUSIBLE_OUTPUT_SPEED && (instInput ?? 0) <= MAX_PLAUSIBLE_INPUT_SPEED) {
        nextLastActiveSpeed = {
          input: instInput ?? cached.lastActiveSpeed.input,
          output: instOutput ?? cached.lastActiveSpeed.output,
          total: instTotal,
          timeMs: nowMs,
        };
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
      lastActiveSpeed: nextLastActiveSpeed,
    };
    writeCache(context.commandCacheDir, updatedCache);

    // 1. If windowed speed is configured:
    const windowSeconds = getWidgetSpeedWindowSeconds(item);
    if (windowSeconds > 0) {
      const targetTime = nowMs - windowSeconds * 1000;
      const olderSample = samples.find((s) => s.timeMs >= targetTime) ?? samples[0];
      if (olderSample) {
        const windowElapsedSec = (nowMs - olderSample.timeMs) / 1000;
        if (windowElapsedSec >= 1) {
          const wInput = rawInput - olderSample.inputTokens;
          const wOutput = rawOutput - olderSample.outputTokens;
          if (kind === "input") return wInput > 0 ? wInput / windowElapsedSec : null;
          if (kind === "output") return wOutput > 0 ? wOutput / windowElapsedSec : null;
          const wTotal = Math.max(0, wInput) + Math.max(0, wOutput);
          return wTotal > 0 ? wTotal / windowElapsedSec : null;
        }
      }
      return null;
    }

    // 2. If recent active speed is available within 60s, return it
    if (nextLastActiveSpeed.timeMs && nowMs - nextLastActiveSpeed.timeMs <= 60_000) {
      if (kind === "input") return nextLastActiveSpeed.input;
      if (kind === "output") return nextLastActiveSpeed.output;
      return nextLastActiveSpeed.total;
    }

    return null;
  }

  // Fallback for stateless or cached-less contexts (e.g. test fixtures, owner preset):
  const elapsedSeconds = Math.max(1, (nowMs - startedAtMs) / 1000);
  const rawTokens =
    kind === "input"
      ? currentInput
      : kind === "output"
        ? currentOutput
        : currentInput === undefined && currentOutput === undefined
          ? undefined
          : rawInput + rawOutput;

  if (rawTokens === undefined) {
    return null;
  }

  const rawSpeed = rawTokens / elapsedSeconds;
  const maxAllowed = kind === "output" ? MAX_PLAUSIBLE_OUTPUT_SPEED : MAX_PLAUSIBLE_INPUT_SPEED;
  if (rawSpeed > maxAllowed) {
    return null;
  }

  return rawSpeed;
}
