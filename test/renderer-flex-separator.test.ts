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
    terminalWidthCacheTtlSeconds: 5,
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

  it("keeps uncolored widget text that reads FLEX instead of treating it as a flex separator", () => {
    const widgets: WidgetItem[] = [
      { id: "left", type: "custom-text", customText: "left" },
      { id: "flex", type: "flex-separator" },
      { id: "literal", type: "custom-text", customText: "FLEX" },
      { id: "right", type: "custom-text", customText: "right" },
    ];
    const settings = createSettings({ colorLevel: 0, flexMode: "full" });
    const preRendered = makePreRendered(widgets, { 0: "left", 2: "FLEX", 3: "right" });

    const knownContext: RenderContext = {
      data: { payload_version: 1 },
      now: new Date(),
      terminalWidth: 40,
      isPreview: false,
    };
    const known = stripSgrCodes(renderStatusLine(widgets, settings, knownContext, preRendered, []));
    expect(known).toBe(`left${" ".repeat(21)}FLEXright`);

    const unknownContext: RenderContext = {
      data: { payload_version: 1 },
      now: new Date(),
      terminalWidth: null,
      isPreview: false,
    };
    const unknown = stripSgrCodes(renderStatusLine(widgets, settings, unknownContext, preRendered, []));
    expect(unknown).toBe("left | FLEXright");
  });

  it("keeps truncating when the reserved columns take the whole terminal", () => {
    const widgets: WidgetItem[] = [
      { id: "text", type: "custom-text", customText: "abcdefghijklmnopqrstuvwxyz" },
    ];
    const settings = createSettings({ colorLevel: 0, flexMode: "full-minus-40" });
    const preRendered = makePreRendered(widgets, { 0: "abcdefghijklmnopqrstuvwxyz" });
    const context: RenderContext = {
      data: { payload_version: 1 },
      now: new Date(),
      terminalWidth: 40,
      isPreview: false,
    };
    const out = renderStatusLine(widgets, settings, context, preRendered, []);
    expect(out).toBe("");
  });
});
