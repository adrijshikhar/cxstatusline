import type { RenderContext } from '../types';
import { getContextWindowMetrics } from './context-window';
import { getContextConfig, getModelContextIdentifier } from './model-context';

export interface ContextPercentageMetrics {
  usedPercentage: number;
  windowSize: number | null;
}

export function calculateContextPercentageMetrics(context: Pick<RenderContext, 'data'>): ContextPercentageMetrics | null {
  const metrics = getContextWindowMetrics(context.data);
  if (metrics.usedPercentage !== null) {
    return { usedPercentage: metrics.usedPercentage, windowSize: metrics.windowSize };
  }
  if (metrics.contextLengthTokens === null) return null;
  const config = getContextConfig(getModelContextIdentifier(context.data.model), metrics.windowSize);
  return {
    usedPercentage: Math.min(100, metrics.contextLengthTokens / config.maxTokens * 100),
    windowSize: config.maxTokens
  };
}

export function calculateContextPercentage(context: Pick<RenderContext, 'data'>): number {
  return calculateContextPercentageMetrics(context)?.usedPercentage ?? 0;
}

