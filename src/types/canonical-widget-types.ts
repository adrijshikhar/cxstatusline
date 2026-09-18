export const CANONICAL_WIDGET_TYPES = [
  "separator", "flex-separator", "model", "thinking-effort",
  "git-branch", "git-changes", "git-review", "git-root-dir",
  "context-bar", "context-length", "context-window", "context-percentage",
  "context-percentage-usable", "tokens-input", "tokens-output", "tokens-cached",
  "tokens-total", "cache-hit-rate", "input-speed", "output-speed", "total-speed",
  "five-hour-usage", "five-hour-reset-timer",
  "weekly-usage", "weekly-reset-timer",
  "session-clock", "session-name", "claude-session-id", "version",
  "current-working-dir", "sandbox-status", "terminal-width", "free-memory",
  "custom-text", "custom-symbol", "custom-command",
] as const;

export type CanonicalWidgetType = typeof CANONICAL_WIDGET_TYPES[number];
