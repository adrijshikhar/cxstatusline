import { describe, expect, it } from "bun:test";
import { DEFAULT_SETTINGS } from "../../src/types/Settings";
import type { RenderContext } from "../../src/types/RenderContext";
import type { WidgetItem } from "../../src/types/Widget";
import { GitChangesWidget } from "../../src/widgets/GitChanges";

describe("GitChangesWidget symbol overrides", () => {
  const widget = new GitChangesWidget();
  const previewContext: RenderContext = {
    data: { payload_version: 1 },
    now: new Date(0),
    terminalWidth: 80,
    isPreview: true,
  };

  it("renders default symbols in preview", () => {
    const item: WidgetItem = { id: "1", type: "git-changes" };
    expect(widget.render(item, previewContext, DEFAULT_SETTINGS)).toBe("(+42,-10)");
  });

  it("renders custom slot overrides", () => {
    const item: WidgetItem = {
      id: "1",
      type: "git-changes",
      metadata: { symbolInsertions: "▲", symbolDeletions: "▼" },
    };
    expect(widget.render(item, previewContext, DEFAULT_SETTINGS)).toBe("(▲42,▼10)");
  });

  it("drops symbols on empty override", () => {
    const item: WidgetItem = {
      id: "1",
      type: "git-changes",
      metadata: { symbolInsertions: "", symbolDeletions: "" },
    };
    expect(widget.render(item, previewContext, DEFAULT_SETTINGS)).toBe("(42,10)");
  });

  it("exposes glyph keybind 'g'", () => {
    const keys = (widget.getCustomKeybinds?.() ?? []).map((k) => k.key);
    expect(keys).toContain("g");
  });

  it("renders custom slot overrides in live mode", () => {
    const context: RenderContext = {
      data: {
        payload_version: 1,
        git: { changes: { additions: 15, deletions: 3 } },
        session: { cwd: "/nonexistent/path/for/test" },
      },
      now: new Date(0),
      terminalWidth: 80,
      isPreview: false,
    };
    const item: WidgetItem = {
      id: "1",
      type: "git-changes",
      metadata: { symbolInsertions: "+", symbolDeletions: "-" },
    };
    expect(widget.render(item, context, DEFAULT_SETTINGS)).toBe("(+15,-3)");

    const customItem: WidgetItem = {
      id: "1",
      type: "git-changes",
      metadata: { symbolInsertions: "▲", symbolDeletions: "▼" },
    };
    expect(widget.render(customItem, context, DEFAULT_SETTINGS)).toBe("(▲15,▼3)");
  });
});
