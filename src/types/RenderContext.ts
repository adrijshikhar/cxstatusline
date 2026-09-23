import type { PayloadV1 } from "../payload";
import type { SpeedMetrics } from "./SpeedMetrics";

/** All values available to widgets for one status-line render. */
export interface RenderContext {
  readonly data: PayloadV1;
  readonly now: Date;
  readonly terminalWidth: number | null;
  /** Explicit or pre-calculated speed metrics for token processing rates. */
  readonly speedMetrics?: SpeedMetrics | null;
  /** Explicit or pre-calculated windowed speed metrics indexed by window seconds. */
  readonly windowedSpeedMetrics?: Record<string, SpeedMetrics> | null;
  /** Deprecated input retained for callers that still construct test contexts. */
  readonly freeMemoryBytes?: number;
  /** Memory is sampled by the command once per render, never by a widget. */
  readonly memoryUsage?: { used: number; total: number };
  /** Presentation-compatible views derived solely from the Codex payload. */
  readonly usageData?: {
    fiveHourUsage?: number | undefined;
    fiveHourResetAt?: string | undefined;
    weeklyUsage?: number | undefined;
    weeklyResetAt?: string | undefined;
    error?: string | undefined;
  };
  readonly isPreview: boolean;
  readonly minimalist?: boolean;
  readonly contextPercentage?: number;
  readonly lineIndex?: number;
  readonly globalSeparatorIndex?: number;
  readonly globalPowerlineThemeIndex?: number;
  readonly globalPowerlineStartCapIndex?: number;
  /** Absence disables command caching, falling back to synchronous execution (used by TUI and tests). */
  readonly commandCacheDir?: string;
  readonly liveGit?: boolean;
}

