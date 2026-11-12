export interface AutoCompactConfig {
  enabled?: boolean;
  windowSize?: number;
}

const DEFAULT_CONTEXT_WINDOW_SIZE = 200_000;
const USABLE_CONTEXT_RATIO = 0.8;
const CONTEXT_WINDOW_ENV_REGEX = /^(\d+(?:[,_]\d+)*(?:\.\d+)?)\s*([km])?$/i;

let cachedEnvRaw: string | undefined;
let cachedEnvResult: number | null = null;
let hasCachedEnv = false;

export function resetContextWindowEnvCache(): void {
  cachedEnvRaw = undefined;
  cachedEnvResult = null;
  hasCachedEnv = false;
}

function parseContextWindowEnvValue(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const suffixMatch = CONTEXT_WINDOW_ENV_REGEX.exec(trimmed);
  const numericPart = suffixMatch?.[1];
  if (!numericPart) {
    return null;
  }

  const numeric = Number.parseFloat(numericPart.replace(/[,_]/g, ''));
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  const unit = suffixMatch[2]?.toLowerCase();
  const multiplier = unit === 'm' ? 1_000_000 : unit === 'k' ? 1_000 : 1;
  const result = Math.round(numeric * multiplier);

  // Reject nonsensical tiny windows (e.g. "1.5" without a unit rounds to 2).
  if (result < 1000) {
    return null;
  }

  return result;
}

export function getContextWindowEnvOverride(): number | null {
  const raw = typeof process !== 'undefined'
    ? (process.env.CXSTATUSLINE_CONTEXT_WINDOW_SIZE ?? process.env.CCSTATUSLINE_CONTEXT_WINDOW_SIZE)
    : undefined;
  if (hasCachedEnv && raw === cachedEnvRaw) {
    return cachedEnvResult;
  }

  cachedEnvRaw = raw;
  cachedEnvResult = raw === undefined ? null : parseContextWindowEnvValue(raw);
  hasCachedEnv = true;
  return cachedEnvResult;
}

function getContextWindowEnvFallback(): number | null {
  const raw = typeof process !== 'undefined'
    ? (process.env.CXSTATUSLINE_CONTEXT_SIZE_FALLBACK ?? process.env.CCSTATUSLINE_CONTEXT_SIZE_FALLBACK)
    : undefined;
  if (raw === undefined) {
    return null;
  }
  return parseContextWindowEnvValue(raw);
}

function isEnabledEnv(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value?.trim() ?? '');
}

function valid(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function inferredSize(model: string | undefined): number | null {
  if (!model) return null;
  const match = /(?:^|[ ([])((?:\d[\d,_]*)(?:\.\d+)?)\s*([km])(?:\b|$|[)\]])/i.exec(model);
  if (!match?.[1] || !match[2]) return null;
  const value = Number.parseFloat(match[1].replace(/[,_]/g, ""));
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * (match[2].toLowerCase() === "m" ? 1_000_000 : 1_000));
}

export function getModelContextIdentifier(model?: { name?: string; reasoning?: string } | string): string | undefined {
  if (typeof model === 'string') {
    return model.trim() || undefined;
  }
  const name = model?.name?.trim();
  return name || undefined;
}

export interface ModelContextConfig {
  maxTokens: number;
  usableTokens: number;
}

function getUsableTokens(maxTokens: number, autoCompact: AutoCompactConfig): number {
  if (
    autoCompact.enabled === false
    || (typeof process !== 'undefined' && (
      isEnabledEnv(process.env.DISABLE_AUTO_COMPACT)
      || isEnabledEnv(process.env.DISABLE_COMPACT)
    ))
  ) {
    return maxTokens;
  }

  const rawWindow = typeof process !== 'undefined'
    ? (process.env.CODEX_AUTO_COMPACT_WINDOW ?? process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW)
    : undefined;
  const envWindow = rawWindow === undefined ? null : parseContextWindowEnvValue(rawWindow);
  const configuredWindow = envWindow ?? valid(autoCompact.windowSize);
  const windowSize = Math.min(maxTokens, configuredWindow ?? maxTokens);

  const rawPercent = typeof process !== 'undefined'
    ? (process.env.CODEX_AUTOCOMPACT_PCT_OVERRIDE ?? process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE)
    : undefined;
  const percent = rawPercent === undefined ? NaN : Number(rawPercent.replace(/_/g, ''));
  const ratio = Number.isFinite(percent) && percent >= 1 && percent <= 100
    ? Math.min(USABLE_CONTEXT_RATIO, percent / 100)
    : USABLE_CONTEXT_RATIO;
  return Math.max(1, Math.floor(windowSize * ratio));
}

export function getContextConfig(
  modelIdentifier?: string,
  contextWindowSize?: number | null,
  autoCompact: AutoCompactConfig = {}
): ModelContextConfig {
  const envOverride = getContextWindowEnvOverride();
  const maxTokens = envOverride
    ?? valid(contextWindowSize)
    ?? inferredSize(modelIdentifier)
    ?? getContextWindowEnvFallback()
    ?? DEFAULT_CONTEXT_WINDOW_SIZE;

  return {
    maxTokens,
    usableTokens: getUsableTokens(maxTokens, autoCompact)
  };
}
