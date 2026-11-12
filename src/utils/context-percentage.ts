import type { RenderContext } from '../types';
import { getContextWindowMetrics } from './context-window';
import { getContextConfig, getContextWindowEnvOverride, getModelContextIdentifier } from './model-context';

export interface ContextPercentageMetrics {
  usedPercentage: number;
  windowSize: number | null;
}

export function calculateContextPercentageMetrics(context: Pick<RenderContext, 'data'>): ContextPercentageMetrics | null {
  const metrics = getContextWindowMetrics(context.data);
  const modelIdentifier = getModelContextIdentifier(context.data?.model);
  const config = getContextConfig(modelIdentifier, metrics.windowSize);

  // Reported percentages use the reported window, which an explicit override
  // replaces. Keep token counts (including those inferred from that original
  // window) and recalculate against the effective size instead.
  if (metrics.usedPercentage !== null && getContextWindowEnvOverride() === null) {
    return { usedPercentage: metrics.usedPercentage, windowSize: metrics.windowSize };
  }

  const tokenCount = metrics.contextLengthTokens
    ?? (metrics.usedPercentage !== null && metrics.windowSize !== null
      ? (metrics.usedPercentage / 100) * metrics.windowSize
      : null);

  if (tokenCount === null) {
    return null;
  }

  return {
    usedPercentage: Math.min(100, (tokenCount / config.maxTokens) * 100),
    windowSize: config.maxTokens
  };
}

export function calculateContextPercentage(context: Pick<RenderContext, 'data'>): number {
  return calculateContextPercentageMetrics(context)?.usedPercentage ?? 0;
}
