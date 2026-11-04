import { describe, expect, it } from "bun:test";
import { getContextWindowMetrics } from "../../src/utils/context-window";
import { calculateContextPercentage, calculateContextPercentageMetrics } from "../../src/utils/context-percentage";
import { ContextPercentageWidget } from "../../src/widgets/ContextPercentage";
import { DEFAULT_SETTINGS } from "../../src/types/Settings";
import type { WidgetItem } from "../../src/types/Widget";
import type { RenderContext } from "../../src/types/RenderContext";

describe("Context Window percentage calculation", () => {
  it("leaves output tokens out of the percentage worked out from Codex usage payload", () => {
    const metrics = getContextWindowMetrics({
      payload_version: 1,
      usage: {
        context_window: 200_000,
        context_tokens: 1700,
        used_tokens: 1900,
        input_tokens: 1000,
        output_tokens: 200,
        cached_input_tokens: 700,
      },
    });

    expect(metrics.windowSize).toBe(200_000);
    expect(metrics.usedTokens).toBe(1900);
    expect(metrics.contextLengthTokens).toBe(1700);
    // contextLengthTokens over the window: output tokens aren't counted in percentage
    expect(metrics.usedPercentage).toBe((1700 / 200_000) * 100);
    expect(metrics.remainingPercentage).toBe(100 - (1700 / 200_000) * 100);
    expect(metrics.totalInputTokens).toBe(1000);
    expect(metrics.totalOutputTokens).toBe(200);
    expect(metrics.cachedTokens).toBe(700);
  });

  it("extracts totals and usage from current_usage object, leaving output tokens out of the percentage", () => {
    const metrics = getContextWindowMetrics({
      context_window: {
        context_window_size: 200_000,
        current_usage: {
          input_tokens: 1000,
          output_tokens: 200,
          cache_creation_input_tokens: 300,
          cache_read_input_tokens: 400,
        },
        total_input_tokens: 4567,
        total_output_tokens: 890,
      },
    } as any);

    expect(metrics.windowSize).toBe(200_000);
    expect(metrics.usedTokens).toBe(1900);
    expect(metrics.contextLengthTokens).toBe(1700);
    // contextLengthTokens over the window: output tokens aren't counted
    expect(metrics.usedPercentage).toBe((1700 / 200_000) * 100);
    expect(metrics.remainingPercentage).toBe(100 - (1700 / 200_000) * 100);
    expect(metrics.totalInputTokens).toBe(4567);
    expect(metrics.totalOutputTokens).toBe(890);
    expect(metrics.cachedTokens).toBe(700);
    expect(metrics.totalTokens).toBe(1900);
  });

  it("calculateContextPercentage and calculateContextPercentageMetrics leave output tokens out", () => {
    const context = {
      data: {
        context_window: {
          context_window_size: 200_000,
          current_usage: {
            input_tokens: 10_000,
            output_tokens: 30_000,
            cache_creation_input_tokens: 2000,
            cache_read_input_tokens: 18_000,
          },
        },
      },
    };

    // Input (10k) + cache creation (2k) + cache read (18k) = 30k of 200k = 15%
    expect(calculateContextPercentage(context as any)).toBe(15);
    expect(calculateContextPercentageMetrics(context as any)).toEqual({
      usedPercentage: 15,
      windowSize: 200_000,
    });
  });

  it("ContextPercentageWidget leaves output tokens out of the percentage worked out from current_usage", () => {
    const widget = new ContextPercentageWidget();
    const item: WidgetItem = {
      id: "context-percentage",
      type: "context-percentage",
    };
    const context: RenderContext = {
      data: {
        context_window: {
          context_window_size: 200_000,
          current_usage: {
            input_tokens: 10_000,
            output_tokens: 30_000,
            cache_creation_input_tokens: 2000,
            cache_read_input_tokens: 38_000,
          },
        },
      } as any,
      now: new Date(),
      terminalWidth: 80,
      isPreview: false,
    };

    expect(widget.render(item, context, DEFAULT_SETTINGS)).toBe("Ctx Used: 25.0%");
  });

  it("ContextPercentageWidget leaves output tokens out of the percentage worked out from Codex payload", () => {
    const widget = new ContextPercentageWidget();
    const item: WidgetItem = {
      id: "context-percentage",
      type: "context-percentage",
    };
    const context: RenderContext = {
      data: {
        payload_version: 1,
        usage: {
          context_window: 200_000,
          context_tokens: 50_000,
          used_tokens: 80_000,
        },
      },
      now: new Date(),
      terminalWidth: 80,
      isPreview: false,
    };

    expect(widget.render(item, context, DEFAULT_SETTINGS)).toBe("Ctx Used: 25.0%");
  });
});
