import { describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS } from "../../src/types/Settings";
import type { RenderContext } from "../../src/types/RenderContext";
import type { WidgetItem } from "../../src/types/Widget";
import { FiveHourUsageWidget } from "../../src/widgets/FiveHourUsage";

describe("FiveHourUsageWidget", () => {
  const widget = new FiveHourUsageWidget();
  const baseContext: RenderContext = {
    data: { payload_version: 1 },
    now: new Date("2026-09-03T12:00:00Z"),
    terminalWidth: 120,
    isPreview: false,
  };

  test("widget metadata and capabilities", () => {
    expect(widget.getDefaultColor()).toBe("brightBlue");
    expect(widget.getDisplayName()).toBe("5h Usage");
    expect(widget.getDescription()).toBe("Shows 5-hour API usage percentage");
    expect(widget.getCategory()).toBe("Usage");
    expect(widget.supportsRawValue()).toBe(true);
    expect(widget.supportsColors({ id: "u", type: "five-hour-usage" })).toBe(true);
    expect(widget.supportsNumberFormat()).toBe(true);
  });

  test("editor display and actions", () => {
    const item: WidgetItem = { id: "u", type: "five-hour-usage" };
    expect(widget.getEditorDisplay(item)).toEqual({
      displayText: "5h Usage",
      modifierText: "(used)",
    });

    const invertedItem = widget.handleEditorAction("toggle-invert", item);
    expect(invertedItem?.metadata?.invert).toBe("true");
    expect(widget.getEditorDisplay(invertedItem!)).toEqual({
      displayText: "5h Usage",
      modifierText: "(remaining)",
    });

    const cursorItem = widget.handleEditorAction("toggle-cursor", item);
    expect(cursorItem?.metadata?.cursor).toBe("true");

    const progressItem = widget.handleEditorAction("toggle-progress", item);
    expect(progressItem?.metadata?.display).toBe("progress");

    expect(widget.handleEditorAction("unknown", item)).toBeNull();
    expect(widget.getCustomKeybinds(item).length).toBeGreaterThan(0);
  });

  test("renders preview mode", () => {
    const previewContext: RenderContext = { ...baseContext, isPreview: true };
    const item: WidgetItem = { id: "u", type: "five-hour-usage" };

    expect(widget.render(item, previewContext, DEFAULT_SETTINGS)).toBe("5h: 31.0%");

    const rawItem: WidgetItem = { ...item, rawValue: true };
    expect(widget.render(rawItem, previewContext, DEFAULT_SETTINGS)).toBe("31.0%");

    const progressItem: WidgetItem = { ...item, metadata: { display: "progress" } };
    const renderedProgress = widget.render(progressItem, previewContext, DEFAULT_SETTINGS);
    expect(renderedProgress).toContain("5h: [");
    expect(renderedProgress).toContain("31.0%");

    const sliderItem: WidgetItem = { ...item, metadata: { display: "slider" } };
    const renderedSlider = widget.render(sliderItem, previewContext, DEFAULT_SETTINGS);
    expect(renderedSlider).toContain("5h: ");
    expect(renderedSlider).toContain("31.0%");
  });

  test("renders live mode with usage data", () => {
    const liveContext: RenderContext = {
      ...baseContext,
      usageData: {
        fiveHourUsage: 45.5,
        fiveHourResetAt: "2026-09-03T14:00:00Z",
      },
    };
    const item: WidgetItem = { id: "u", type: "five-hour-usage" };

    expect(widget.render(item, liveContext, DEFAULT_SETTINGS)).toBe("5h: 45.5%");

    const rawItem: WidgetItem = { ...item, rawValue: true };
    expect(widget.render(rawItem, liveContext, DEFAULT_SETTINGS)).toBe("45.5%");

    const invertedItem: WidgetItem = { ...item, metadata: { invert: "true" } };
    expect(widget.render(invertedItem, liveContext, DEFAULT_SETTINGS)).toBe("5h: 54.5%");

    const cursorItem: WidgetItem = { ...item, metadata: { display: "progress", cursor: "true" } };
    const renderedCursor = widget.render(cursorItem, liveContext, DEFAULT_SETTINGS);
    expect(renderedCursor).toContain("5h: [");
  });

  test("handles missing data and errors gracefully", () => {
    const missingContext: RenderContext = { ...baseContext, usageData: undefined };
    const item: WidgetItem = { id: "u", type: "five-hour-usage" };
    expect(widget.render(item, missingContext, DEFAULT_SETTINGS)).toBeNull();

    const emptyContext: RenderContext = { ...baseContext, usageData: {} };
    expect(widget.render(item, emptyContext, DEFAULT_SETTINGS)).toBeNull();

    const errorContext: RenderContext = {
      ...baseContext,
      usageData: { error: "rate-limited" },
    };
    expect(widget.render(item, errorContext, DEFAULT_SETTINGS)).toBe("[Rate limited]");
  });
});
