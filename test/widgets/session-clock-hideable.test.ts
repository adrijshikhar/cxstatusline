import { describe, expect, test } from "bun:test";
import type { RenderContext } from "../../src/types/RenderContext";
import { DEFAULT_SETTINGS } from "../../src/types/Settings";
import type { WidgetItem } from "../../src/types/Widget";
import { SessionClockWidget } from "../../src/widgets/SessionClock";

describe("SessionClockWidget hideable states", () => {
  const widget = new SessionClockWidget();

  test("declares ZERO_HIDEABLE_STATE", () => {
    const states = widget.getHideableStates?.();
    expect(states).toBeDefined();
    expect(states?.length).toBe(1);
    expect(states?.[0]?.key).toBe("zero");
  });

  test("hides when session elapsed time < 1m and hide:zero is enabled", () => {
    const context: RenderContext = {
      data: {
        payload_version: 1,
        session: { started_at: "2026-09-23T12:00:30Z" },
      },
      now: new Date("2026-09-23T12:00:45Z"), // 15 seconds elapsed
      terminalWidth: 80,
      isPreview: false,
    };
    const item: WidgetItem = { id: "clock", type: "session-clock", metadata: { hide: "zero" } };
    expect(widget.render(item, context, DEFAULT_SETTINGS)).toBeNull();
  });

  test("renders '<1m' when elapsed time < 1m and hide:zero is not enabled", () => {
    const context: RenderContext = {
      data: {
        payload_version: 1,
        session: { started_at: "2026-09-23T12:00:30Z" },
      },
      now: new Date("2026-09-23T12:00:45Z"), // 15 seconds elapsed
      terminalWidth: 80,
      isPreview: false,
    };
    const item: WidgetItem = { id: "clock", type: "session-clock" };
    expect(widget.render(item, context, DEFAULT_SETTINGS)).toBe("Session: <1m");
  });

  test("renders elapsed time when >= 1m even if hide:zero is enabled", () => {
    const context: RenderContext = {
      data: {
        payload_version: 1,
        session: { started_at: "2026-09-23T11:00:00Z" },
      },
      now: new Date("2026-09-23T12:00:00Z"), // 1 hour elapsed
      terminalWidth: 80,
      isPreview: false,
    };
    const item: WidgetItem = { id: "clock", type: "session-clock", metadata: { hide: "zero" } };
    expect(widget.render(item, context, DEFAULT_SETTINGS)).toBe("Session: 1hr");
  });
});
