import { describe, expect, it } from "bun:test";
import type { RenderContext } from "../../src/types/RenderContext";
import { DEFAULT_SETTINGS } from "../../src/types/Settings";
import { CANONICAL_WIDGET_TYPES } from "../../src/types/canonical-widget-types";
import { WIDGET_MANIFEST } from "../../src/utils/widget-manifest";
import { ClaudeSessionIdWidget } from "../../src/widgets/ClaudeSessionId";

describe("Codex Session ID widget", () => {
  const widget = new ClaudeSessionIdWidget();

  it("reports 'Codex Session ID' as display name instead of Claude", () => {
    expect(widget.getDisplayName()).toBe("Codex Session ID");
    expect(widget.getEditorDisplay({ id: "sid", type: "claude-session-id" }).displayText).toBe(
      "Codex Session ID"
    );
  });

  it("manifest registers both codex-session-id and claude-session-id", () => {
    const types = WIDGET_MANIFEST.map((e) => e.type);
    expect(types).toContain("codex-session-id");
    expect(types).toContain("claude-session-id");
    expect(CANONICAL_WIDGET_TYPES).toContain("codex-session-id");
    expect(CANONICAL_WIDGET_TYPES).toContain("claude-session-id");
  });

  it("renders session ID from payload for both types", () => {
    const context: RenderContext = {
      data: {
        payload_version: 1,
        session: { id: "test-sess-1234" },
      },
      now: new Date(),
      terminalWidth: 80,
      isPreview: false,
    };

    expect(widget.render({ id: "1", type: "codex-session-id" as any }, context, DEFAULT_SETTINGS)).toBe(
      "Session ID: test-sess-1234"
    );
    expect(widget.render({ id: "2", type: "claude-session-id" }, context, DEFAULT_SETTINGS)).toBe(
      "Session ID: test-sess-1234"
    );
  });
});
