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
export function getContextWindowMetrics(data?: PayloadV1 | any): ContextWindowMetrics {
  const usage = data?.usage;
  const cw = data?.context_window;

  const rawWindowSize = finite(usage?.context_window ?? (typeof cw === 'object' ? cw?.context_window_size : undefined));
  const windowSize = rawWindowSize !== null && rawWindowSize > 0 ? rawWindowSize : null;

  let currentUsageTotalTokens: number | null = null;
  let contextLengthTokens: number | null = null;
  let cachedTokens: number | null = finite(usage?.cached_input_tokens);

  if (typeof cw?.current_usage === 'number') {
    currentUsageTotalTokens = finite(cw.current_usage);
    contextLengthTokens = currentUsageTotalTokens;
  } else if (cw?.current_usage && typeof cw.current_usage === 'object') {
    const usageTokens = parseUsageTokens(cw.current_usage);
    const { input, output, creation, read } = usageTokens;
    currentUsageTotalTokens = input + output + creation + read;
    contextLengthTokens = contextLengthFromUsageTokens(usageTokens);
    cachedTokens = creation + read;
  } else {
    contextLengthTokens = finite(usage?.context_tokens);
    currentUsageTotalTokens = finite(usage?.used_tokens);
  }

  const rawUsedPercentage = finite(usage?.context_used) !== null
    ? (finite(usage?.context_used)! * 100)
    : finite(cw?.used_percentage);

  const rawRemainingPercentage = finite(usage?.context_remaining) !== null
    ? (finite(usage?.context_remaining)! * 100)
    : finite(cw?.remaining_percentage);

  const usedTokensFromPercentage = rawUsedPercentage !== null && windowSize !== null
    ? (rawUsedPercentage / 100) * windowSize
    : null;

  const totalInputTokens = finite(usage?.input_tokens ?? cw?.total_input_tokens);
  const totalOutputTokens = finite(usage?.output_tokens ?? cw?.total_output_tokens);

  const usedTokens = currentUsageTotalTokens
    ?? usedTokensFromPercentage
    ?? (totalInputTokens !== null && totalOutputTokens !== null
      ? totalInputTokens + totalOutputTokens
      : contextLengthTokens);

  // Output tokens aren't in the context until the next turn reads them back
  // as input, so count only input tokens, as the context length does.
  const percentageTokens = contextLengthTokens ?? usedTokens;

  const usedPercentage = rawUsedPercentage !== null
    ? clamp(rawUsedPercentage)
    : percentageTokens !== null && windowSize !== null && windowSize > 0
      ? clamp((percentageTokens / windowSize) * 100)
      : null;

  const remainingPercentage = rawRemainingPercentage !== null
    ? clamp(rawRemainingPercentage)
    : usedPercentage !== null
      ? 100 - usedPercentage
      : null;

  const totalTokens = currentUsageTotalTokens
    ?? (totalInputTokens !== null && totalOutputTokens !== null
      ? totalInputTokens + totalOutputTokens
      : null);

  return {
    windowSize,
    usedTokens,
    contextLengthTokens: percentageTokens,
    usedPercentage,
    remainingPercentage,
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

export function getContextWindowTurnCacheTokens(data?: PayloadV1 | any): TurnCacheTokens | null {
  const usage = data?.usage;
  if (usage?.cached_input_tokens !== undefined || usage?.input_tokens !== undefined) {
    return {
      read: finite(usage.cached_input_tokens) ?? 0,
      creation: 0,
      input: finite(usage.input_tokens) ?? 0
    };
  }
  const cwUsage = (data as any)?.context_window?.current_usage;
  if (cwUsage && typeof cwUsage === "object") {
    const { input, creation, read } = parseUsageTokens(cwUsage);
    return { read, creation, input };
  }
  return null;
}
