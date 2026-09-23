import { describe, expect, it } from "bun:test";
import type { RenderContext } from "../../src/types/RenderContext";
import { DEFAULT_SETTINGS } from "../../src/types/Settings";
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
});
