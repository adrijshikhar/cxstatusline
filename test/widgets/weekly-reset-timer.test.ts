import { describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS } from "../../src/types/Settings";
import type { RenderContext } from "../../src/types/RenderContext";
import type { WidgetItem } from "../../src/types/Widget";
import { WeeklyResetTimerWidget } from "../../src/widgets/WeeklyResetTimer";

describe("WeeklyResetTimerWidget", () => {
  const widget = new WeeklyResetTimerWidget();
  const baseContext: RenderContext = {
    data: { payload_version: 1 },
    now: new Date("2026-09-03T12:00:00Z"),
    terminalWidth: 120,
    isPreview: false,
  };

  test("widget metadata and capabilities", () => {
    expect(widget.getDefaultColor()).toBe("brightBlue");
    expect(widget.getDisplayName()).toBe("Weekly Reset Timer");
    expect(widget.getDescription()).toBe("Shows time remaining until weekly usage reset");
    expect(widget.getCategory()).toBe("Usage");
    expect(widget.supportsRawValue()).toBe(true);
    expect(widget.supportsColors({ id: "w", type: "weekly-reset-timer" })).toBe(true);
    expect(widget.supportsNumberFormat()).toBe(true);
  });

  test("editor display and actions", () => {
    const item: WidgetItem = { id: "w", type: "weekly-reset-timer" };
    expect(widget.getEditorDisplay(item)).toEqual({
      displayText: "Weekly Reset Timer",
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

    const weekdayItem = widget.handleEditorAction("toggle-weekday", item);
    expect(weekdayItem?.metadata?.weekday).toBe("true");

    expect(widget.handleEditorAction("unknown", item)).toBeNull();
    expect(widget.getCustomKeybinds(item).length).toBeGreaterThan(0);
  });

  test("editor rendering support", () => {
    const item: WidgetItem = { id: "w", type: "weekly-reset-timer" };
    expect(typeof widget.renderEditor).toBe("function");
    expect(widget.renderEditor?.({ widget: item, action: "other", onComplete: () => {}, onCancel: () => {} })).toBeNull();
  });

  test("renders preview mode", () => {
    const previewContext: RenderContext = { ...baseContext, isPreview: true };
    const item: WidgetItem = { id: "w", type: "weekly-reset-timer" };

    const rendered = widget.render(item, previewContext, DEFAULT_SETTINGS);
    expect(rendered).toContain("Weekly Reset: ");

    const rawItem: WidgetItem = { ...item, rawValue: true };
    const renderedRaw = widget.render(rawItem, previewContext, DEFAULT_SETTINGS);
    expect(renderedRaw).not.toContain("Weekly Reset: ");

    const dateItem: WidgetItem = { ...item, metadata: { absolute: "true" } };
    const renderedDate = widget.render(dateItem, previewContext, DEFAULT_SETTINGS);
    expect(renderedDate).toContain("Weekly Reset: ");

    const progressItem: WidgetItem = { ...item, metadata: { display: "progress" } };
    const renderedProgress = widget.render(progressItem, previewContext, DEFAULT_SETTINGS);
    expect(renderedProgress).toContain("Weekly Reset [");
  });

  test("renders live mode with reset time", () => {
    const liveContext: RenderContext = {
      ...baseContext,
      usageData: {
        weeklyUsage: 25,
        weeklyResetAt: "2026-09-08T00:00:00Z",
      },
    };
    const item: WidgetItem = { id: "w", type: "weekly-reset-timer" };

    const rendered = widget.render(item, liveContext, DEFAULT_SETTINGS);
    expect(rendered).toContain("Weekly Reset: ");

    const rawItem: WidgetItem = { ...item, rawValue: true };
    expect(widget.render(rawItem, liveContext, DEFAULT_SETTINGS)).not.toContain("Weekly Reset: ");

    const progressItem: WidgetItem = { ...item, metadata: { display: "progress" } };
    const renderedProgress = widget.render(progressItem, liveContext, DEFAULT_SETTINGS);
    expect(renderedProgress).toContain("Weekly Reset [");

    const dateItem: WidgetItem = { ...item, metadata: { absolute: "true" } };
    const renderedDate = widget.render(dateItem, liveContext, DEFAULT_SETTINGS);
    expect(renderedDate).toContain("Weekly Reset: ");
  });

  test("handles missing resetAt and errors", () => {
    const missingContext: RenderContext = { ...baseContext, usageData: undefined };
    const item: WidgetItem = { id: "w", type: "weekly-reset-timer" };
    expect(widget.render(item, missingContext, DEFAULT_SETTINGS)).toBe("Weekly Reset: [Loading]");

    const errorContext: RenderContext = {
      ...baseContext,
      usageData: { error: "api-error" },
    };
    expect(widget.render(item, errorContext, DEFAULT_SETTINGS)).toBe("[API Error]");
  });

  test("declares no-data hideable state", () => {
    expect(widget.getHideableStates?.().map((s) => s.key)).toEqual(["no-data"]);
  });

  test("returns null when no-data state is enabled and reset time is absent", () => {
    const item: WidgetItem = { id: "1", type: "weekly-reset-timer", metadata: { hide: "no-data" } };
    expect(widget.render(item, { ...baseContext, usageData: undefined }, DEFAULT_SETTINGS)).toBeNull();
    expect(widget.render(item, { ...baseContext, usageData: {} }, DEFAULT_SETTINGS)).toBeNull();
    expect(widget.render(item, { ...baseContext, usageData: { error: "api-error" } }, DEFAULT_SETTINGS)).toBeNull();
  });

  test("keeps placeholders when no-data state is off", () => {
    const item: WidgetItem = { id: "1", type: "weekly-reset-timer" };
    expect(widget.render(item, { ...baseContext, usageData: undefined }, DEFAULT_SETTINGS)).toBe("Weekly Reset: [Loading]");
    expect(widget.render(item, { ...baseContext, usageData: { error: "api-error" } }, DEFAULT_SETTINGS)).toBe("[API Error]");
  });

  test("custom keybinds use 'o' for only-hours and 'f' for 12/24 format", () => {
    const item: WidgetItem = { id: "w", type: "weekly-reset-timer" };
    const timeKeybinds = widget.getCustomKeybinds(item);
    expect(timeKeybinds.find((k) => k.action === "toggle-hours")).toEqual({
      key: "o",
      label: "(o)nly hours",
      action: "toggle-hours",
    });
    expect(timeKeybinds.some((k) => k.key === "h")).toBe(false);

    const dateItem: WidgetItem = { id: "w", type: "weekly-reset-timer", metadata: { absolute: "true" } };
    const dateKeybinds = widget.getCustomKeybinds(dateItem);
    expect(dateKeybinds.find((k) => k.action === "toggle-hour-format")).toEqual({
      key: "f",
      label: "12/24 (f)ormat",
      action: "toggle-hour-format",
    });
    expect(dateKeybinds.some((k) => k.key === "h")).toBe(false);
  });
});
