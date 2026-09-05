import type { PayloadV1 } from "../payload";

export interface ContextWindowMetrics {
  windowSize: number | null;
  usedTokens: number | null;
  contextLengthTokens: number | null;
  usedPercentage: number | null;
  remainingPercentage: number | null;
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  cachedTokens: number | null;
  totalTokens: number | null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export interface UsageTokens { input: number; output: number; creation: number; read: number }
export function parseUsageTokens(value: Partial<{ input_tokens: number; output_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number }>): UsageTokens {
  return { input: finite(value.input_tokens) ?? 0, output: finite(value.output_tokens) ?? 0, creation: finite(value.cache_creation_input_tokens) ?? 0, read: finite(value.cache_read_input_tokens) ?? 0 };
}
export function contextLengthFromUsageTokens(tokens: UsageTokens): number { return tokens.input + tokens.creation + tokens.read; }

/** Normalize the Codex usage fields once so every context/token widget agrees. */
export function getContextWindowMetrics(data?: PayloadV1): ContextWindowMetrics {
  const usage = data?.usage;
  const windowSize = finite(usage?.context_window);
  const contextLengthTokens = finite(usage?.context_tokens ?? usage?.used_tokens);
  const totalInputTokens = finite(usage?.input_tokens);
  const totalOutputTokens = finite(usage?.output_tokens);
  const cachedTokens = finite(usage?.cached_input_tokens);
  const totalTokens = totalInputTokens !== null && totalOutputTokens !== null
    ? totalInputTokens + totalOutputTokens
    : null;
  const usedPercentage = finite(usage?.context_used);
  const resolvedUsedPercentage = usedPercentage !== null
    ? clamp(usedPercentage * 100)
    : contextLengthTokens !== null && windowSize !== null && windowSize > 0
      ? clamp(contextLengthTokens / windowSize * 100)
      : null;
  return {
    windowSize: windowSize !== null && windowSize > 0 ? windowSize : null,
    usedTokens: contextLengthTokens,
    contextLengthTokens,
    usedPercentage: resolvedUsedPercentage,
    remainingPercentage: resolvedUsedPercentage === null ? null : 100 - resolvedUsedPercentage,
    totalInputTokens,
    totalOutputTokens,
    cachedTokens,
    totalTokens
  };
}

export function getContextWindowInputTotalTokens(data?: PayloadV1): number | null {
  return getContextWindowMetrics(data).totalInputTokens;
}

export function getContextWindowOutputTotalTokens(data?: PayloadV1): number | null {
  return getContextWindowMetrics(data).totalOutputTokens;
}

export function getContextWindowCachedTokens(data?: PayloadV1): number | null {
  return getContextWindowMetrics(data).cachedTokens;
}

export function getContextWindowTotalTokens(data?: PayloadV1): number | null {
  return getContextWindowMetrics(data).totalTokens;
}

export function getContextWindowContextLengthTokens(data?: PayloadV1): number | null {
  return getContextWindowMetrics(data).contextLengthTokens;
}

export function getContextWindowUsedTokens(data?: PayloadV1): number | null {
  return getContextWindowMetrics(data).usedTokens;
}

export function getContextWindowUsedPercentage(data?: PayloadV1): number | null {
  return getContextWindowMetrics(data).usedPercentage;
}

export function getContextWindowSize(data?: PayloadV1): number | null {
  return getContextWindowMetrics(data).windowSize;
}

/** Cache counters supplied by Codex's cumulative payload. */
export interface TurnCacheTokens {
  read: number;
  creation: number;
  input: number;
}

export function getContextWindowTurnCacheTokens(data?: PayloadV1): TurnCacheTokens | null {
  const usage = data?.usage;
  if (usage?.cached_input_tokens === undefined && usage?.input_tokens === undefined) {
    return null;
  }
  return {
    read: finite(usage.cached_input_tokens) ?? 0,
    creation: 0,
    input: finite(usage.input_tokens) ?? 0
  };
}
