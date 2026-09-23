import { describe, expect, test } from "bun:test";
import type { RenderContext } from "../../src/types/RenderContext";
import { DEFAULT_SETTINGS } from "../../src/types/Settings";
import type { WidgetItem } from "../../src/types/Widget";
import { FiveHourUsageWidget } from "../../src/widgets/FiveHourUsage";
import { WeeklyUsageWidget } from "../../src/widgets/WeeklyUsage";

const errorContext: RenderContext = {
  data: {
    payload_version: 1,
  },
  now: new Date("2026-09-23T12:00:00Z"),
  terminalWidth: 80,
  isPreview: false,
  usageData: {
    error: "rate-limited",
  },
};

describe("usage percentage widgets hideable states", () => {
  const widgets = [
    { name: "FiveHourUsage", widget: new FiveHourUsageWidget(), type: "five-hour-usage" },
    { name: "WeeklyUsage", widget: new WeeklyUsageWidget(), type: "weekly-usage" },
  ];

  for (const { name, widget, type } of widgets) {
    test(`${name} declares USAGE_NO_DATA_HIDEABLE_STATE`, () => {
      const states = widget.getHideableStates?.();
      expect(states).toBeDefined();
      expect(states?.length).toBe(1);
      expect(states?.[0]?.key).toBe("no-data");
    });

    test(`${name} hides on error when hide:no-data is enabled`, () => {
      const item: WidgetItem = { id: type, type: type as any, metadata: { hide: "no-data" } };
      expect(widget.render(item, errorContext, DEFAULT_SETTINGS)).toBeNull();
    });

    test(`${name} renders error placeholder when hide:no-data is not enabled`, () => {
      const item: WidgetItem = { id: type, type: type as any };
      expect(widget.render(item, errorContext, DEFAULT_SETTINGS)).toBe("[Rate limited]");
    });
  }
});
