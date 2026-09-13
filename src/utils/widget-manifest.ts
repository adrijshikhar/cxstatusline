import type { Widget, WidgetType } from "../types/Widget";
import * as widgets from "../widgets";

export interface WidgetManifestEntry {
  readonly type: WidgetType;
  readonly create: () => Widget;
}

const layoutWidget: Widget = {
  getDefaultColor: () => "white",
  render: () => null,
  getDescription: () => "Layout separator",
  getDisplayName: () => "Separator",
  getCategory: () => "layout",
  getEditorDisplay: () => ({ displayText: "Separator" }),
  supportsRawValue: () => false,
  supportsColors: () => false,
};

export const WIDGET_MANIFEST: readonly WidgetManifestEntry[] = [
  { type: "separator", create: () => layoutWidget },
  { type: "flex-separator", create: () => layoutWidget },
  { type: "model", create: () => new widgets.ModelWidget() },
  { type: "thinking-effort", create: () => new widgets.ThinkingEffortWidget() },
  { type: "git-branch", create: () => new widgets.GitBranchWidget() },
  { type: "git-changes", create: () => new widgets.GitChangesWidget() },
  { type: "git-review", create: () => new widgets.GitPrWidget() },
  { type: "git-root-dir", create: () => new widgets.GitRootDirWidget() },
  { type: "context-bar", create: () => new widgets.ContextBarWidget() },
  { type: "context-length", create: () => new widgets.ContextLengthWidget() },
  { type: "context-window", create: () => new widgets.ContextWindowWidget() },
  { type: "context-percentage", create: () => new widgets.ContextPercentageWidget() },
  { type: "context-percentage-usable", create: () => new widgets.ContextPercentageUsableWidget() },
  { type: "tokens-input", create: () => new widgets.TokensInputWidget() },
  { type: "tokens-output", create: () => new widgets.TokensOutputWidget() },
  { type: "tokens-cached", create: () => new widgets.TokensCachedWidget() },
  { type: "tokens-total", create: () => new widgets.TokensTotalWidget() },
  { type: "cache-hit-rate", create: () => new widgets.CacheHitRateWidget() },
  { type: "input-speed", create: () => new widgets.InputSpeedWidget() },
  { type: "output-speed", create: () => new widgets.OutputSpeedWidget() },
  { type: "total-speed", create: () => new widgets.TotalSpeedWidget() },
  { type: "weekly-usage", create: () => new widgets.WeeklyUsageWidget() },
  { type: "weekly-reset-timer", create: () => new widgets.WeeklyResetTimerWidget() },
  { type: "session-clock", create: () => new widgets.SessionClockWidget() },
  { type: "session-name", create: () => new widgets.SessionNameWidget() },
  { type: "claude-session-id", create: () => new widgets.ClaudeSessionIdWidget() },
  { type: "version", create: () => new widgets.VersionWidget() },
  { type: "current-working-dir", create: () => new widgets.CurrentWorkingDirWidget() },
  { type: "sandbox-status", create: () => new widgets.SandboxStatusWidget() },
  { type: "terminal-width", create: () => new widgets.TerminalWidthWidget() },
  { type: "free-memory", create: () => new widgets.FreeMemoryWidget() },
  { type: "custom-text", create: () => new widgets.CustomTextWidget() },
  { type: "custom-symbol", create: () => new widgets.CustomSymbolWidget() },
  { type: "custom-command", create: () => new widgets.CustomCommandWidget() },
];
