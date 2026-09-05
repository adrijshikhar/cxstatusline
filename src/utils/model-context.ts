const DEFAULT_CONTEXT_WINDOW_SIZE = 200_000;
const USABLE_CONTEXT_RATIO = 0.8;

function valid(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function inferredSize(model: string | undefined): number | null {
  if (!model) return null;
  const match = /(?:^|[ ([])((?:\\d[\\d,_]*)(?:\\.\\d+)?)\\s*([km])(?:\\b|$|[)\\]])/i.exec(model);
  if (!match?.[1] || !match[2]) return null;
  const value = Number.parseFloat(match[1].replace(/[,_]/g, ""));
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * (match[2].toLowerCase() === "m" ? 1_000_000 : 1_000));
}

export function getModelContextIdentifier(model?: { name?: string; reasoning?: string }): string | undefined {
  const name = model?.name?.trim();
  return name || undefined;
}

export interface ModelContextConfig {
  maxTokens: number;
  usableTokens: number;
}

export function getContextConfig(modelIdentifier?: string, contextWindowSize?: number | null): ModelContextConfig {
  const maxTokens = valid(contextWindowSize)
    ?? inferredSize(modelIdentifier)
    ?? DEFAULT_CONTEXT_WINDOW_SIZE;
  return { maxTokens, usableTokens: Math.floor(maxTokens * USABLE_CONTEXT_RATIO) };
}

