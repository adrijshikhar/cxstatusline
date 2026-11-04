import { describe, expect, it } from "bun:test";
import type { RenderContext } from "../src/types/RenderContext";
import {
  DEFAULT_SETTINGS,
  type Settings,
} from "../src/types/Settings";
import type { WidgetItem } from "../src/types/Widget";
import { getVisibleWidth } from "../src/utils/ansi";
import {
  calculateMaxWidthsFromPreRendered,
  preRenderAllWidgets,
  renderStatusLine,
} from "../src/utils/renderer";
import {
  buildTerminalWidthItems,
  getTerminalWidthSelectionIndex,
  validateCompactThresholdInput,
} from "../src/tui/components/TerminalWidthMenu";

describe("TerminalWidthMenu helpers", () => {
  it("returns three options with descriptions", () => {
    const items = buildTerminalWidthItems("full-until-compact", 60);

    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      label: "Full width always",
      sublabel: "(default)",
      value: "full",
    });
    expect(items[1]).toMatchObject({
      label: "Full width minus 40",
      sublabel: undefined,
      value: "full-minus-40",
    });
    expect(items[2]).toMatchObject({
      label: "Full width until compact",
      sublabel: "(threshold 60%, active)",
      value: "full-until-compact",
    });
    expect(items[2]?.description).toContain("60%");
  });

  it("marks the mode new settings get as the default", () => {
    expect(DEFAULT_SETTINGS.flexMode).toBe("full");

    const fullMinus40Items = buildTerminalWidthItems("full-minus-40", 60);
    expect(fullMinus40Items[0]?.sublabel).toBe("(default)");
    expect(fullMinus40Items[1]?.sublabel).toBe("(active)");

    // The active mode says so, even when it is also the default
    const fullItems = buildTerminalWidthItems("full", 60);
    expect(fullItems[0]?.sublabel).toBe("(active)");
    expect(fullItems[1]?.sublabel).toBeUndefined();
  });

  it("returns the current option index for list selection", () => {
    expect(getTerminalWidthSelectionIndex("full")).toBe(0);
    expect(getTerminalWidthSelectionIndex("full-minus-40")).toBe(1);
    expect(getTerminalWidthSelectionIndex("full-until-compact")).toBe(2);
  });

  it("validates compact threshold input", () => {
    expect(validateCompactThresholdInput("50")).toBeNull();
    expect(validateCompactThresholdInput("1")).toBeNull();
    expect(validateCompactThresholdInput("99")).toBeNull();
    expect(validateCompactThresholdInput("0")).toContain("between 1 and 99");
    expect(validateCompactThresholdInput("100")).toContain("between 1 and 99");
    expect(validateCompactThresholdInput("abc")).toContain("valid number");
    expect(validateCompactThresholdInput("")).toContain("valid number");
  });
});

describe("TerminalWidthMenu descriptions", () => {
  it("describes the columns full width always actually reserves", () => {
    const terminalWidth = 50;
    const widgets: WidgetItem[] = [
      { id: "left", type: "custom-text", customText: "LEFT" },
      { id: "flex", type: "flex-separator" },
      { id: "right", type: "custom-text", customText: "RIGHT" },
    ];
    const settings: Settings = { ...DEFAULT_SETTINGS, flexMode: "full" };
    const context: RenderContext = {
      isPreview: false,
      terminalWidth,
      data: { payload_version: 1 },
      now: new Date(0),
    };
    const preRenderedLines = preRenderAllWidgets([widgets], settings, context);
    const maxWidths = calculateMaxWidthsFromPreRendered(preRenderedLines, settings);
    const line = renderStatusLine(widgets, settings, context, preRenderedLines[0] ?? [], maxWidths);
    const reserved = terminalWidth - getVisibleWidth(line);

    const fullItem = buildTerminalWidthItems("full", 60)[0];

    expect(fullItem?.description).toContain(`minus ${reserved} characters`);
  });
});
