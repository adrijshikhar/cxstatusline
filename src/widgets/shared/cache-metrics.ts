import type { RenderContext } from '../../types/RenderContext';
import { formatTokens } from '../../utils/format-tokens';

export interface TurnCacheTokens { read: number; creation: number; input: number; }

export function getCacheTokens(context: RenderContext, _sessionScope: boolean): TurnCacheTokens | null {
  const usage = context.data.usage;
  if (usage?.input_tokens === undefined && usage?.cached_input_tokens === undefined) return null;
  return { read: usage.cached_input_tokens ?? 0, creation: 0, input: usage.input_tokens ?? 0 };
}

export function getCacheHitRate(tokens: TurnCacheTokens): number | null {
  const denominator = tokens.input;
  return denominator > 0 ? tokens.read / denominator * 100 : null;
}
export function getCacheReadPercentage(tokens: TurnCacheTokens): number | null {
  const denominator = tokens.input;
  return denominator > 0 ? tokens.read / denominator * 100 : null;
}
export function getCacheWritePercentage(tokens: TurnCacheTokens): number | null {
  const denominator = tokens.input;
  return denominator > 0 ? (tokens.input - tokens.read) / denominator * 100 : null;
}
export function formatTokensWithPercentage(tokenCount: number, percentage: number | null): string {
  const value = formatTokens(tokenCount);
  return percentage === null ? value : value + ' (' + percentage.toFixed(1) + '%)';
}

