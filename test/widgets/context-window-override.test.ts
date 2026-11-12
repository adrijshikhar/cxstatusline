import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { getContextConfig, getContextWindowEnvOverride, resetContextWindowEnvCache } from "../../src/utils/model-context";
import { calculateContextPercentageMetrics } from "../../src/utils/context-percentage";
import { ContextBarWidget } from "../../src/widgets/ContextBar";
import { ContextWindowWidget } from "../../src/widgets/ContextWindow";
import { ContextPercentageWidget } from "../../src/widgets/ContextPercentage";
import { ContextPercentageUsableWidget } from "../../src/widgets/ContextPercentageUsable";
import { DEFAULT_SETTINGS } from "../../src/types/Settings";
import type { RenderContext } from "../../src/types/RenderContext";
import type { WidgetItem } from "../../src/types/Widget";

describe("context window environment overrides", () => {
  const origCxOverride = process.env.CXSTATUSLINE_CONTEXT_WINDOW_SIZE;
  const origCcOverride = process.env.CCSTATUSLINE_CONTEXT_WINDOW_SIZE;
  const origCxFallback = process.env.CXSTATUSLINE_CONTEXT_SIZE_FALLBACK;
  const origCcFallback = process.env.CCSTATUSLINE_CONTEXT_SIZE_FALLBACK;

  beforeEach(() => {
    delete process.env.CXSTATUSLINE_CONTEXT_WINDOW_SIZE;
    delete process.env.CCSTATUSLINE_CONTEXT_WINDOW_SIZE;
    delete process.env.CXSTATUSLINE_CONTEXT_SIZE_FALLBACK;
    delete process.env.CCSTATUSLINE_CONTEXT_SIZE_FALLBACK;
    resetContextWindowEnvCache();
  });

  afterEach(() => {
    if (origCxOverride !== undefined) process.env.CXSTATUSLINE_CONTEXT_WINDOW_SIZE = origCxOverride;
    else delete process.env.CXSTATUSLINE_CONTEXT_WINDOW_SIZE;

    if (origCcOverride !== undefined) process.env.CCSTATUSLINE_CONTEXT_WINDOW_SIZE = origCcOverride;
    else delete process.env.CCSTATUSLINE_CONTEXT_WINDOW_SIZE;

    if (origCxFallback !== undefined) process.env.CXSTATUSLINE_CONTEXT_SIZE_FALLBACK = origCxFallback;
    else delete process.env.CXSTATUSLINE_CONTEXT_SIZE_FALLBACK;

    if (origCcFallback !== undefined) process.env.CCSTATUSLINE_CONTEXT_SIZE_FALLBACK = origCcFallback;
    else delete process.env.CCSTATUSLINE_CONTEXT_SIZE_FALLBACK;

    resetContextWindowEnvCache();
  });

  describe("parsing override values", () => {
    it("accepts raw numbers", () => {
      process.env.CXSTATUSLINE_CONTEXT_WINDOW_SIZE = "1000000";
      expect(getContextConfig("gpt-4o", 200000)).toEqual({
        maxTokens: 1000000,
        usableTokens: 800000,
      });
    });

    it("accepts k and m units (case-insensitive)", () => {
      process.env.CXSTATUSLINE_CONTEXT_WINDOW_SIZE = "1M";
      expect(getContextConfig("gpt-4o", 200000).maxTokens).toBe(1000000);

      process.env.CXSTATUSLINE_CONTEXT_WINDOW_SIZE = "500k";
      expect(getContextConfig("gpt-4o", 200000).maxTokens).toBe(500000);
    });

    it("accepts commas, underscores, decimals and whitespace", () => {
      process.env.CXSTATUSLINE_CONTEXT_WINDOW_SIZE = "  1_500,000  ";
      expect(getContextConfig("gpt-4o", 200000).maxTokens).toBe(1500000);

      process.env.CXSTATUSLINE_CONTEXT_WINDOW_SIZE = "1.5M";
      expect(getContextConfig("gpt-4o", 200000).maxTokens).toBe(1500000);
    });

    it("rejects non-numeric, non-positive, and windows smaller than 1000", () => {
      for (const bad of ["invalid", "0", "-50", "   ", "1.5"]) {
        process.env.CXSTATUSLINE_CONTEXT_WINDOW_SIZE = bad;
        expect(getContextConfig("gpt-4o", 200000).maxTokens).toBe(200000);
      }
    });

    it("falls back to CCSTATUSLINE_CONTEXT_WINDOW_SIZE when CXSTATUSLINE_* is not set", () => {
      process.env.CCSTATUSLINE_CONTEXT_WINDOW_SIZE = "800k";
      expect(getContextConfig("gpt-4o", 200000).maxTokens).toBe(800000);
    });

    it("prefers CXSTATUSLINE_CONTEXT_WINDOW_SIZE over CCSTATUSLINE_CONTEXT_WINDOW_SIZE", () => {
      process.env.CXSTATUSLINE_CONTEXT_WINDOW_SIZE = "1M";
      process.env.CCSTATUSLINE_CONTEXT_WINDOW_SIZE = "500k";
      expect(getContextConfig("gpt-4o", 200000).maxTokens).toBe(1000000);
    });

    it("uses CXSTATUSLINE_CONTEXT_SIZE_FALLBACK when no size is reported or inferred", () => {
      process.env.CXSTATUSLINE_CONTEXT_SIZE_FALLBACK = "400k";
      expect(getContextConfig(undefined, null).maxTokens).toBe(400000);
    });
  });

  describe("widgets and percentage calculations with override", () => {
    it("recalculates percentage against overridden window size", () => {
      process.env.CXSTATUSLINE_CONTEXT_WINDOW_SIZE = "1M";
      const context = {
        data: {
          context_window: {
            context_window_size: 200000,
            used_percentage: 50, // 100k of 200k
          },
        },
      };

      const metrics = calculateContextPercentageMetrics(context as any);
      expect(metrics).toEqual({
        usedPercentage: 10, // 100k of 1M = 10%
        windowSize: 1000000,
      });
    });

    it("ContextWindowWidget displays the overridden window size", () => {
      process.env.CXSTATUSLINE_CONTEXT_WINDOW_SIZE = "1M";
      const widget = new ContextWindowWidget();
      const item: WidgetItem = { id: "cw", type: "context-window" };
      const context: RenderContext = {
        data: {
          context_window: { context_window_size: 200000 },
        } as any,
        now: new Date(),
        terminalWidth: 80,
        isPreview: false,
      };

      expect(widget.render(item, context, DEFAULT_SETTINGS)).toBe("Win: 1.0M");
    });

    it("ContextBarWidget uses the overridden window size for total tokens and bar percentage", () => {
      process.env.CXSTATUSLINE_CONTEXT_WINDOW_SIZE = "1M";
      const widget = new ContextBarWidget();
      const item: WidgetItem = { id: "cb", type: "context-bar" };
      const context: RenderContext = {
        data: {
          context_window: {
            context_window_size: 200000,
            current_usage: {
              input_tokens: 100000,
            },
          },
        } as any,
        now: new Date(),
        terminalWidth: 80,
        isPreview: false,
      };

      const rendered = widget.render(item, context, DEFAULT_SETTINGS);
      expect(rendered).toContain("100k/1.0M (10%)");
    });
  });
});
