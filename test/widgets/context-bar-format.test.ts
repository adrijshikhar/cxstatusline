import { describe, expect, it } from "bun:test";
import type { RenderContext } from "../../src/types/RenderContext";
import { DEFAULT_SETTINGS } from "../../src/types/Settings";
import type { WidgetItem } from "../../src/types/Widget";
import { ContextBarWidget } from "../../src/widgets/ContextBar";

describe("ContextBarWidget formatting", () => {
  const widget = new ContextBarWidget();

  it("formats tokens with compact 0 decimals in live mode matching preview", () => {
    const context: RenderContext = {
      data: {
        payload_version: 1,
        usage: {
          context_window: 200_000,
          context_tokens: 50_000,
        },
      },
      now: new Date(),
      terminalWidth: 80,
      isPreview: false,
    };

    const output = widget.render({ id: "bar", type: "context-bar" }, context, DEFAULT_SETTINGS);
    expect(output).not.toBeNull();
    // Must contain "50k/200k" rather than "50.0k/200.0k"
    expect(output).toContain("50k/200k");
  });

  it("cycles through progress modes including line bar", () => {
    const base: WidgetItem = { id: "bar", type: "context-bar" };
    const long = widget.handleEditorAction("toggle-progress", base);
    const slider = widget.handleEditorAction("toggle-progress", long ?? base);
    const sliderOnly = widget.handleEditorAction("toggle-progress", slider ?? base);
    const line = widget.handleEditorAction("toggle-progress", sliderOnly ?? base);
    const backToShort = widget.handleEditorAction("toggle-progress", line ?? base);

    expect(long?.metadata?.display).toBe("progress");
    expect(slider?.metadata?.display).toBe("slider");
    expect(sliderOnly?.metadata?.display).toBe("slider-only");
    expect(line?.metadata?.display).toBe("line");
    expect(backToShort?.metadata?.display).toBe("progress-short");

    expect(widget.getEditorDisplay(line!).modifierText).toBe("(line bar)");
  });

  it("renders a thin line progress bar without brackets in line mode", () => {
    const context: RenderContext = {
      data: {
        payload_version: 1,
        usage: {
          context_window: 200_000,
          context_tokens: 50_000,
        },
      },
      now: new Date(),
      terminalWidth: 80,
      isPreview: false,
    };

    const output = widget.render({ id: "bar", type: "context-bar", metadata: { display: "line" } }, context, DEFAULT_SETTINGS);
    expect(output).not.toBeNull();
    expect(output).toContain("━");
    expect(output).toContain("─");
    expect(output).not.toContain("[━");
    expect(output).toContain("50k/200k (25%)");
  });
});
