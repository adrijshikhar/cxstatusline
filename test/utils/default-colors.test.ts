import { describe, expect, it } from "bun:test";
import { COLOR_MAP } from "../../src/utils/colors";
import { TerminalWidthWidget } from "../../src/widgets/TerminalWidth";
import { VersionWidget } from "../../src/widgets/Version";
import { DEFAULT_SETTINGS, type Settings } from "../../src/types/Settings";
import type { WidgetItem } from "../../src/types/Widget";
import { renderStatusLine } from "../../src/utils/renderer";

describe("default widget colors", () => {
  it("uses brightBlack instead of unmapped gray", () => {
    const known = new Set(COLOR_MAP.map((c) => c.name));
    const termWidth = new TerminalWidthWidget();
    const version = new VersionWidget();
    expect(known.has(termWidth.getDefaultColor())).toBe(true);
    expect(termWidth.getDefaultColor()).toBe("brightBlack");
    expect(known.has(version.getDefaultColor())).toBe(true);
    expect(version.getDefaultColor()).toBe("brightBlack");
  });

  it("paints a separator with no explicit color as bright black", () => {
    const widgets: WidgetItem[] = [
      { id: "a", type: "custom-text" },
      { id: "sep", type: "separator" },
      { id: "b", type: "custom-text" }
    ];
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      colorLevel: 1,
      inheritSeparatorColors: false
    };
    const preRendered = widgets.map((widget) => ({
      content: widget.type === "separator" ? "" : widget.id.toUpperCase(),
      plainLength: widget.type === "separator" ? 0 : 1,
      widget
    }));

    const out = renderStatusLine(
      widgets,
      settings,
      { isPreview: false, terminalWidth: 200 } as any,
      preRendered,
      []
    );

    expect(out).toContain("\x1b[90m | ");
  });
});
