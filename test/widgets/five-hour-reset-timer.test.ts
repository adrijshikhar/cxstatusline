import { describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS } from "../../src/types/Settings";
import type { RenderContext } from "../../src/types/RenderContext";
import type { WidgetItem } from "../../src/types/Widget";
import { FiveHourResetTimerWidget } from "../../src/widgets/FiveHourResetTimer";
import { LOCALE_EDITOR_ACTION } from "../../src/widgets/shared/locale-editor";
import { TIMEZONE_EDITOR_ACTION } from "../../src/widgets/shared/timezone-editor";

describe("FiveHourResetTimerWidget", () => {
  const widget = new FiveHourResetTimerWidget();
  const baseContext: RenderContext = {
    data: { payload_version: 1 },
    now: new Date("2026-09-03T12:00:00Z"),
    terminalWidth: 120,
    isPreview: false,
  };

  test("widget metadata and capabilities", () => {
    expect(widget.getDefaultColor()).toBe("brightBlue");
    expect(widget.getDisplayName()).toBe("5h Reset Timer");
    expect(widget.getDescription()).toBe("Shows time remaining until 5-hour usage reset");
    expect(widget.getCategory()).toBe("Usage");
    expect(widget.supportsRawValue()).toBe(true);
    expect(widget.supportsColors({ id: "r", type: "five-hour-reset-timer" })).toBe(true);
    expect(widget.supportsNumberFormat()).toBe(true);
  });

  test("editor display and actions", () => {
    const item: WidgetItem = { id: "r", type: "five-hour-reset-timer" };
    expect(widget.getEditorDisplay(item)).toEqual({
      displayText: "5h Reset Timer",
      modifierText: undefined,
    });

    const compactItem = widget.handleEditorAction("toggle-compact", item);
    expect(compactItem?.metadata?.compact).toBe("true");

    const dateItem = widget.handleEditorAction("toggle-date", item);
    expect(dateItem?.metadata?.absolute).toBe("true");

    const progressItem = widget.handleEditorAction("toggle-progress", item);
    expect(progressItem?.metadata?.display).toBe("progress");

    const hoursItem = widget.handleEditorAction("toggle-hours", item);
    expect(hoursItem?.metadata?.hours).toBe("true");

    expect(widget.handleEditorAction("unknown", item)).toBeNull();
    expect(widget.getCustomKeybinds(item).length).toBeGreaterThan(0);
  });

  test("editor rendering support", () => {
    const item: WidgetItem = { id: "r", type: "five-hour-reset-timer" };
    expect(typeof widget.renderEditor).toBe("function");
    // Should return null for non-editor actions
    expect(widget.renderEditor?.({ widget: item, action: "other", onComplete: () => {}, onCancel: () => {} })).toBeNull();
  });

  test("renders preview mode", () => {
    const previewContext: RenderContext = { ...baseContext, isPreview: true };
    const item: WidgetItem = { id: "r", type: "five-hour-reset-timer" };

    const rendered = widget.render(item, previewContext, DEFAULT_SETTINGS);
    expect(rendered).toContain("5h Reset: ");

    const rawItem: WidgetItem = { ...item, rawValue: true };
    const renderedRaw = widget.render(rawItem, previewContext, DEFAULT_SETTINGS);
    expect(renderedRaw).not.toContain("5h Reset: ");

    const dateItem: WidgetItem = { ...item, metadata: { absolute: "true" } };
    const renderedDate = widget.render(dateItem, previewContext, DEFAULT_SETTINGS);
    expect(renderedDate).toContain("5h Reset: ");

    const progressItem: WidgetItem = { ...item, metadata: { display: "progress" } };
    const renderedProgress = widget.render(progressItem, previewContext, DEFAULT_SETTINGS);
    expect(renderedProgress).toContain("5h Reset [");
  });

  test("renders live mode with reset time", () => {
    // 2 hours remaining in a 5h window
    const liveContext: RenderContext = {
      ...baseContext,
      usageData: {
        fiveHourUsage: 60,
        fiveHourResetAt: "2026-09-03T14:00:00Z",
      },
    };
    const item: WidgetItem = { id: "r", type: "five-hour-reset-timer" };

    const rendered = widget.render(item, liveContext, DEFAULT_SETTINGS);
    expect(rendered).toBe("5h Reset: 2hr");

    const rawItem: WidgetItem = { ...item, rawValue: true };
    expect(widget.render(rawItem, liveContext, DEFAULT_SETTINGS)).toBe("2hr");

    const compactItem: WidgetItem = { ...item, metadata: { compact: "true" } };
    expect(widget.render(compactItem, liveContext, DEFAULT_SETTINGS)).toBe("5h Reset: 2h");

    const progressItem: WidgetItem = { ...item, metadata: { display: "progress" } };
    const renderedProgress = widget.render(progressItem, liveContext, DEFAULT_SETTINGS);
    expect(renderedProgress).toContain("5h Reset [");
    expect(renderedProgress).toContain("60.0%");

    const dateItem: WidgetItem = { ...item, metadata: { absolute: "true" } };
    const renderedDate = widget.render(dateItem, liveContext, DEFAULT_SETTINGS);
    expect(renderedDate).toContain("5h Reset: ");
    expect(renderedDate).toContain("2026-09-03");
  });

  test("handles missing resetAt and errors", () => {
    const missingContext: RenderContext = { ...baseContext, usageData: undefined };
    const item: WidgetItem = { id: "r", type: "five-hour-reset-timer" };
    expect(widget.render(item, missingContext, DEFAULT_SETTINGS)).toBe("5h Reset: [Loading]");

    const errorContext: RenderContext = {
      ...baseContext,
      usageData: { error: "api-error" },
    };
    expect(widget.render(item, errorContext, DEFAULT_SETTINGS)).toBe("[API Error]");
  });
});
