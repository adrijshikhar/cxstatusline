import { describe, expect, it } from "bun:test";
import { FiveHourUsageWidget } from "../../src/widgets/FiveHourUsage";
import { WeeklyUsageWidget } from "../../src/widgets/WeeklyUsage";
import { DEFAULT_SETTINGS } from "../../src/types/Settings";

describe("FiveHourUsage time cursor in remaining mode", () => {
  it("positions cursor at time left when inverted", () => {
    const widget = new FiveHourUsageWidget();
    const item = {
      id: "5h",
      type: "five-hour-usage" as const,
      metadata: { cursor: "true", display: "slider", invert: "true" },
    };
    const now = new Date("2026-09-03T12:00:00.000Z");
    const resetsAt = new Date(now.getTime() + 14400000).toISOString();
    const context = {
      now,
      data: {
        session: {
          rateLimits: {
            fiveHour: {
              usedPercentage: 30,
              resetsAt,
            },
          },
        },
      },
      usageData: {
        fiveHourUsage: 30,
        fiveHourResetAt: resetsAt,
      },
    };
    const rendered = widget.render(item, context as any, DEFAULT_SETTINGS);
    expect(rendered).toContain("│");
    // 30% used with 20% of the block elapsed (4h left out of 5h = 80% time left).
    // In remaining mode (invert: 'true'), fill shows 70% left (7 bars) and
    // cursor marks the 80% time left (index 8), not 20% elapsed (index 2).
    expect(rendered).toBe("5h: ▓▓▓▓▓▓▓░│░ 70.0%");
  });

  it("places cursor at elapsed time in normal mode and remaining time in inverted mode", () => {
    const widget = new FiveHourUsageWidget();
    const now = new Date("2026-09-03T12:00:00.000Z");
    const resetsAt = new Date(now.getTime() + 14400000).toISOString();
    const context = {
      now,
      usageData: {
        fiveHourUsage: 30,
        fiveHourResetAt: resetsAt,
      },
    };

    // Normal mode: 30% fill, 20% elapsed cursor (index 2)
    const normalItem = {
      id: "5h",
      type: "five-hour-usage" as const,
      metadata: { cursor: "true", display: "slider" },
    };
    expect(widget.render(normalItem, context as any, DEFAULT_SETTINGS)).toBe("5h: ▓▓│░░░░░░░ 30.0%");

    // Inverted mode: 70% fill, 80% remaining cursor (index 8)
    const invertedItem = {
      id: "5h",
      type: "five-hour-usage" as const,
      metadata: { cursor: "true", display: "slider", invert: "true" },
    };
    expect(widget.render(invertedItem, context as any, DEFAULT_SETTINGS)).toBe("5h: ▓▓▓▓▓▓▓░│░ 70.0%");
  });

  it("positions cursor in progress bar mode at time left when inverted", () => {
    const widget = new FiveHourUsageWidget();
    const now = new Date("2026-09-03T12:00:00.000Z");
    const resetsAt = new Date(now.getTime() + 14400000).toISOString();
    const context = {
      now,
      usageData: {
        fiveHourUsage: 30,
        fiveHourResetAt: resetsAt,
      },
    };

    const invertedProgress = {
      id: "5h",
      type: "five-hour-usage" as const,
      metadata: { cursor: "true", display: "progress", invert: "true" },
    };
    // Width 32: 70% fill is 22 chars (indices 0..21), 80% remaining cursor is index 25
    expect(widget.render(invertedProgress, context as any, DEFAULT_SETTINGS)).toBe("5h: [██████████████████████░░░│░░░░░░] 70.0%");
  });

  it("supports fallback to context.data.session.rateLimits if usageData is omitted", () => {
    const widget = new FiveHourUsageWidget();
    const now = new Date("2026-09-03T12:00:00.000Z");
    const resetsAt = new Date(now.getTime() + 14400000).toISOString();
    const context = {
      now,
      data: {
        session: {
          rateLimits: {
            fiveHour: {
              usedPercentage: 30,
              resetsAt,
            },
          },
        },
      },
    };
    const item = {
      id: "5h",
      type: "five-hour-usage" as const,
      metadata: { cursor: "true", display: "slider", invert: "true" },
    };
    expect(widget.render(item, context as any, DEFAULT_SETTINGS)).toBe("5h: ▓▓▓▓▓▓▓░│░ 70.0%");
  });
});

describe("WeeklyUsage time cursor in remaining mode", () => {
  it("positions cursor at time left when inverted", () => {
    const widget = new WeeklyUsageWidget();
    const now = new Date("2026-09-03T12:00:00.000Z");
    // 7-day window is 604,800,000 ms. 20% elapsed means 80% remains = 483,840,000 ms.
    const resetsAt = new Date(now.getTime() + 483840000).toISOString();
    const context = {
      now,
      usageData: {
        weeklyUsage: 30,
        weeklyResetAt: resetsAt,
      },
    };

    const normalItem = {
      id: "weekly",
      type: "weekly-usage" as const,
      metadata: { cursor: "true", display: "slider" },
    };
    expect(widget.render(normalItem, context as any, DEFAULT_SETTINGS)).toBe("Weekly: ▓▓│░░░░░░░ 30.0%");

    const invertedItem = {
      id: "weekly",
      type: "weekly-usage" as const,
      metadata: { cursor: "true", display: "slider", invert: "true" },
    };
    expect(widget.render(invertedItem, context as any, DEFAULT_SETTINGS)).toBe("Weekly: ▓▓▓▓▓▓▓░│░ 70.0%");
  });

  it("supports fallback to context.data.session.rateLimits if usageData is omitted", () => {
    const widget = new WeeklyUsageWidget();
    const now = new Date("2026-09-03T12:00:00.000Z");
    const resetsAt = new Date(now.getTime() + 483840000).toISOString();
    const context = {
      now,
      data: {
        session: {
          rateLimits: {
            weekly: {
              usedPercentage: 30,
              resetsAt,
            },
          },
        },
      },
    };
    const item = {
      id: "weekly",
      type: "weekly-usage" as const,
      metadata: { cursor: "true", display: "slider", invert: "true" },
    };
    expect(widget.render(item, context as any, DEFAULT_SETTINGS)).toBe("Weekly: ▓▓▓▓▓▓▓░│░ 70.0%");
  });
});
