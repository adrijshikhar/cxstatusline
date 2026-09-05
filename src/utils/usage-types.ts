export const SEVEN_DAY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface UsageWindowMetrics {
  sessionDurationMs: number;
  elapsedMs: number;
  remainingMs: number;
  elapsedPercent: number;
  remainingPercent: number;
}
