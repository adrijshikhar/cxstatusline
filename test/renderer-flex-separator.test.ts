import { describe, expect, it } from "bun:test";
import type { RenderContext } from "../src/types/RenderContext";
import type { Settings } from "../src/types/Settings";
import { CURRENT_VERSION } from "../src/types/Settings";
import type { WidgetItem } from "../src/types/Widget";
import { stripSgrCodes } from "../src/utils/ansi";
import { renderStatusLine, type PreRenderedWidget } from "../src/utils/renderer";

function createSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    version: CURRENT_VERSION,
    lines: [],
    flexMode: "full",
    compactThreshold: 60,
    colorLevel: 0,
    defaultPadding: "",
    defaultPaddingSide: "both",
    inheritSeparatorColors: false,
    globalBold: false,
    minimalistMode: false,
    powerline: {
      enabled: false,
      separators: ["\uE0B0"],
      separatorInvertBackground: [false],
      startCaps: [],
      endCaps: [],
      autoAlign: false,
      continueThemeAcrossLines: false,
    },
    ...overrides,
  };
}

function makePreRendered(widgets: WidgetItem[], contents: Record<number, string>): PreRenderedWidget[] {
  return widgets.map((widget, i) => {
    const content = contents[i] ?? "";
    return {
      content,
      plainLength: content.length,
      widget,
    };
  });
}

describe("renderer flex separator collapse", () => {
  it("drops a spacing separator stranded against a flex separator when the widget between renders empty", () => {
    const space: WidgetItem = { id: "space", type: "separator", character: " " };
    const widgets: WidgetItem[] = [
      { id: "a", type: "custom-text", customText: "A" },
      space,
      { id: "b", type: "custom-text", customText: "" },
      { id: "flex", type: "flex-separator" },
      { id: "c", type: "custom-text", customText: "C" },
    ];
    const settings = createSettings({ colorLevel: 0 });
    const context: RenderContext = {
      data: { payload_version: 1 },
      now: new Date("2026-09-02T12:00:00Z"),
      terminalWidth: null,
      isPreview: false,
    };
    const preRenderedWidgets = makePreRendered(widgets, { 0: "A", 2: "", 4: "C" });
    const out = stripSgrCodes(renderStatusLine(widgets, settings, context, preRenderedWidgets, []));

    expect(out).toBe("A | C");
  });

  it("drops a spacing separator following a flex separator when the widget between renders empty", () => {
    const space: WidgetItem = { id: "space", type: "separator", character: " " };
    const widgets: WidgetItem[] = [
      { id: "a", type: "custom-text", customText: "A" },
      { id: "flex", type: "flex-separator" },
      { id: "b", type: "custom-text", customText: "" },
      space,
      { id: "c", type: "custom-text", customText: "C" },
    ];
    const settings = createSettings({ colorLevel: 0 });
    const context: RenderContext = {
      data: { payload_version: 1 },
      now: new Date("2026-09-02T12:00:00Z"),
      terminalWidth: null,
      isPreview: false,
    };
    const preRenderedWidgets = makePreRendered(widgets, { 0: "A", 2: "", 4: "C" });
    const out = stripSgrCodes(renderStatusLine(widgets, settings, context, preRenderedWidgets, []));

    expect(out).toBe("A | C");
  });

  it("keeps a stranded spacing separator when a known-width flex separator allocates no space", () => {
    const space: WidgetItem = { id: "space", type: "separator", character: " " };
    const widgets: WidgetItem[] = [
      { id: "a", type: "custom-text", customText: "AAAAA" },
      space,
      { id: "hidden", type: "custom-text", customText: "" },
      { id: "flex", type: "flex-separator" },
      { id: "c", type: "custom-text", customText: "CCCCC" },
    ];
    const settings = createSettings({ colorLevel: 0, flexMode: "full" });
    // Full mode reserves six columns, leaving a ten-column render width.
    const context: RenderContext = {
      data: { payload_version: 1 },
      now: new Date("2026-09-02T12:00:00Z"),
      terminalWidth: 16,
      isPreview: false,
    };
    const preRenderedWidgets = makePreRendered(widgets, { 0: "AAAAA", 2: "", 4: "CCCCC" });
    const out = stripSgrCodes(renderStatusLine(widgets, settings, context, preRenderedWidgets, []));

    expect(out).toBe("AAAAA C...");
  });
});
