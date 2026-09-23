import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SETTINGS } from "../../src/types/Settings";
import type { RenderContext } from "../../src/types/RenderContext";
import type { WidgetItem } from "../../src/types/Widget";
import { InputSpeedWidget } from "../../src/widgets/InputSpeed";
import { OutputSpeedWidget } from "../../src/widgets/OutputSpeed";
import { TotalSpeedWidget } from "../../src/widgets/TotalSpeed";
import { formatSpeed, resetSpeedTrackerMemoryCache } from "../../src/utils/speed-tracker";

describe("Speed widgets", () => {
  beforeEach(() => {
    resetSpeedTrackerMemoryCache();
  });

  describe("Widget metadata and capabilities", () => {
    test("declares correct metadata for InputSpeedWidget", () => {
      const widget = new InputSpeedWidget();
      expect(widget.getCategory()).toBe("Token Speed");
      expect(widget.getDisplayName()).toBe("Input Speed");
      expect(widget.getDefaultColor()).toBe("cyan");
      expect(widget.supportsRawValue()).toBe(true);
      expect(widget.supportsColors({ id: "s", type: "input-speed" })).toBe(true);
      expect(widget.supportsNumberFormat()).toBe(true);
      expect(widget.getHideableStates?.().map((s) => s.key)).toEqual(["no-data"]);
    });

    test("declares correct metadata for OutputSpeedWidget", () => {
      const widget = new OutputSpeedWidget();
      expect(widget.getCategory()).toBe("Token Speed");
      expect(widget.getDisplayName()).toBe("Output Speed");
      expect(widget.getDefaultColor()).toBe("cyan");
      expect(widget.supportsRawValue()).toBe(true);
      expect(widget.supportsColors({ id: "s", type: "output-speed" })).toBe(true);
      expect(widget.supportsNumberFormat()).toBe(true);
      expect(widget.getHideableStates?.().map((s) => s.key)).toEqual(["no-data"]);
    });

    test("declares correct metadata for TotalSpeedWidget", () => {
      const widget = new TotalSpeedWidget();
      expect(widget.getCategory()).toBe("Token Speed");
      expect(widget.getDisplayName()).toBe("Total Speed");
      expect(widget.getDefaultColor()).toBe("cyan");
      expect(widget.supportsRawValue()).toBe(true);
      expect(widget.supportsColors({ id: "s", type: "total-speed" })).toBe(true);
      expect(widget.supportsNumberFormat()).toBe(true);
      expect(widget.getHideableStates?.().map((s) => s.key)).toEqual(["no-data"]);
    });

    test("editor display shows session average by default and window when configured", () => {
      const inWidget = new InputSpeedWidget();
      const outWidget = new OutputSpeedWidget();
      const totalWidget = new TotalSpeedWidget();

      expect(inWidget.getEditorDisplay({ id: "in", type: "input-speed" }).modifierText).toBe("(session avg)");
      expect(outWidget.getEditorDisplay({ id: "out", type: "output-speed" }).modifierText).toBe("(session avg)");
      expect(totalWidget.getEditorDisplay({ id: "tot", type: "total-speed" }).modifierText).toBe("(session avg)");

      expect(
        inWidget.getEditorDisplay({ id: "in", type: "input-speed", metadata: { windowSeconds: "45" } }).modifierText
      ).toBe("(45s window)");
    });
  });

  describe("formatSpeed utility", () => {
    test("formats null or invalid speeds as em dash", () => {
      expect(formatSpeed(null)).toBe("—");
      expect(formatSpeed(-5)).toBe("—");
      expect(formatSpeed(Number.NaN)).toBe("—");
      expect(formatSpeed(Number.POSITIVE_INFINITY)).toBe("—");
    });

    test("formats normal speeds in t/s", () => {
      expect(formatSpeed(42.5)).toBe("42.5 t/s");
      expect(formatSpeed(85.2)).toBe("85.2 t/s");
      expect(formatSpeed(0)).toBe("—");
    });

    test("formats high speeds in k t/s", () => {
      expect(formatSpeed(1200)).toBe("1.2k t/s");
      expect(formatSpeed(24500)).toBe("24.5k t/s");
    });

    test("respects NumberFormat precision and style overrides", () => {
      expect(formatSpeed(42.5, { style: "whole" })).toBe("43 t/s");
      expect(formatSpeed(42.5, { decimals: 2 })).toBe("42.50 t/s");
      expect(formatSpeed(1250, { style: "whole" })).toBe("1k t/s");
      expect(formatSpeed(1250, { decimals: 2 })).toBe("1.25k t/s");
    });
  });

  describe("Preview mode rendering", () => {
    const previewContext: RenderContext = {
      data: { payload_version: 1 },
      now: new Date("2026-09-23T12:00:00Z"),
      terminalWidth: 120,
      isPreview: true,
    };

    test("renders preview values labeled and raw", () => {
      const inWidget = new InputSpeedWidget();
      const outWidget = new OutputSpeedWidget();
      const totalWidget = new TotalSpeedWidget();

      expect(inWidget.render({ id: "in", type: "input-speed" }, previewContext, DEFAULT_SETTINGS)).toBe("In: 85.2 t/s");
      expect(inWidget.render({ id: "in", type: "input-speed", rawValue: true }, previewContext, DEFAULT_SETTINGS)).toBe("85.2 t/s");

      expect(outWidget.render({ id: "out", type: "output-speed" }, previewContext, DEFAULT_SETTINGS)).toBe("Out: 42.5 t/s");
      expect(outWidget.render({ id: "out", type: "output-speed", rawValue: true }, previewContext, DEFAULT_SETTINGS)).toBe("42.5 t/s");

      expect(totalWidget.render({ id: "tot", type: "total-speed" }, previewContext, DEFAULT_SETTINGS)).toBe("Total: 127.7 t/s");
      expect(totalWidget.render({ id: "tot", type: "total-speed", rawValue: true }, previewContext, DEFAULT_SETTINGS)).toBe("127.7 t/s");
    });

    test("renders window preview values when windowSeconds is configured", () => {
      const inWidget = new InputSpeedWidget();
      const outWidget = new OutputSpeedWidget();
      const totalWidget = new TotalSpeedWidget();

      expect(
        inWidget.render({ id: "in", type: "input-speed", metadata: { windowSeconds: "30" } }, previewContext, DEFAULT_SETTINGS)
      ).toBe("In: 31.5 t/s");
      expect(
        outWidget.render({ id: "out", type: "output-speed", metadata: { windowSeconds: "30" } }, previewContext, DEFAULT_SETTINGS)
      ).toBe("Out: 26.8 t/s");
      expect(
        totalWidget.render({ id: "tot", type: "total-speed", metadata: { windowSeconds: "30" } }, previewContext, DEFAULT_SETTINGS)
      ).toBe("Total: 58.3 t/s");
    });
  });

  describe("Live session calculation and resumed thread resilience", () => {
    test("does not report absurd speeds on newly resumed sessions with historical tokens", () => {
      const outWidget = new OutputSpeedWidget();
      const inWidget = new InputSpeedWidget();

      // Simulated state from screenshot:
      // Session resumed 5 seconds ago, carrying 370M input tokens and 808k output tokens from history
      const resumedContext: RenderContext = {
        data: {
          payload_version: 1,
          session: {
            id: "01a0b351-2f2f-7d22-8176-49e45bde8f9b",
            started_at: "2026-09-23T12:50:00Z",
            run_state: "ready",
          },
          usage: {
            input_tokens: 370095134,
            output_tokens: 808006,
            cached_input_tokens: 450000000,
          },
        },
        now: new Date("2026-09-23T12:50:05Z"), // 5s elapsed
        terminalWidth: 120,
        isPreview: false,
      };

      // On first render of resumed session, no active generation has happened yet.
      // Must NOT output 74,019,026.8 t/s or 161,601.2 t/s!
      expect(inWidget.render({ id: "in", type: "input-speed" }, resumedContext, DEFAULT_SETTINGS)).toBe("In: —");
      expect(outWidget.render({ id: "out", type: "output-speed" }, resumedContext, DEFAULT_SETTINGS)).toBe("Out: —");

      // With hide: no-data, must return null (hidden)
      expect(
        inWidget.render({ id: "in", type: "input-speed", metadata: { hide: "no-data" } }, resumedContext, DEFAULT_SETTINGS)
      ).toBeNull();
      expect(
        outWidget.render({ id: "out", type: "output-speed", metadata: { hide: "no-data" } }, resumedContext, DEFAULT_SETTINGS)
      ).toBeNull();
    });

    test("computes accurate speed when tokens advance over time", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "cx-speed-advance-test-"));
      try {
        const outWidget = new OutputSpeedWidget();
        const inWidget = new InputSpeedWidget();
        const totalWidget = new TotalSpeedWidget();

        const sessionId = "session-generate-test";
        const startTime = new Date("2026-09-23T12:00:00Z");

        // Initial observation (baseline established)
        const ctx1: RenderContext = {
          data: {
            payload_version: 1,
            session: { id: sessionId, started_at: startTime.toISOString(), run_state: "working" },
            usage: { input_tokens: 1000, output_tokens: 100 },
          },
          now: startTime,
          terminalWidth: 120,
          isPreview: false,
          commandCacheDir: tempDir,
        };

        expect(outWidget.render({ id: "out", type: "output-speed" }, ctx1, DEFAULT_SETTINGS)).toBe("Out: —");

        // 2 seconds later: output tokens increase by 100 (+50 t/s), input tokens increase by 300 (+150 t/s)
        const ctx2: RenderContext = {
          data: {
            payload_version: 1,
            session: { id: sessionId, started_at: startTime.toISOString(), run_state: "working" },
            usage: { input_tokens: 1300, output_tokens: 200 },
          },
          now: new Date("2026-09-23T12:00:02Z"),
          terminalWidth: 120,
          isPreview: false,
          commandCacheDir: tempDir,
        };

        expect(outWidget.render({ id: "out", type: "output-speed" }, ctx2, DEFAULT_SETTINGS)).toBe("Out: 50.0 t/s");
        expect(inWidget.render({ id: "in", type: "input-speed" }, ctx2, DEFAULT_SETTINGS)).toBe("In: 150.0 t/s");
        expect(totalWidget.render({ id: "tot", type: "total-speed" }, ctx2, DEFAULT_SETTINGS)).toBe("Total: 200.0 t/s");

        // Idle after completion: retains the last active turn speed
        const ctx3: RenderContext = {
          data: {
            payload_version: 1,
            session: { id: sessionId, started_at: startTime.toISOString(), run_state: "ready" },
            usage: { input_tokens: 1300, output_tokens: 200 },
          },
          now: new Date("2026-09-23T12:00:05Z"),
          terminalWidth: 120,
          isPreview: false,
          commandCacheDir: tempDir,
        };

        expect(outWidget.render({ id: "out", type: "output-speed" }, ctx3, DEFAULT_SETTINGS)).toBe("Out: 50.0 t/s");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("persists speed metrics across commandCacheDir file IO", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "cx-speed-cache-test-"));
      try {
        const outWidget = new OutputSpeedWidget();
        const sessionId = "session-disk-test";
        const startTime = new Date("2026-09-23T12:00:00Z");

        const ctx1: RenderContext = {
          data: {
            payload_version: 1,
            session: { id: sessionId, started_at: startTime.toISOString(), run_state: "working" },
            usage: { input_tokens: 5000, output_tokens: 500 },
          },
          now: startTime,
          terminalWidth: 120,
          isPreview: false,
          commandCacheDir: tempDir,
        };

        expect(outWidget.render({ id: "out", type: "output-speed" }, ctx1, DEFAULT_SETTINGS)).toBe("Out: —");

        // Clear memory cache to force reading from disk
        resetSpeedTrackerMemoryCache();

        const ctx2: RenderContext = {
          data: {
            payload_version: 1,
            session: { id: sessionId, started_at: startTime.toISOString(), run_state: "working" },
            usage: { input_tokens: 5000, output_tokens: 600 },
          },
          now: new Date("2026-09-23T12:00:02Z"),
          terminalWidth: 120,
          isPreview: false,
          commandCacheDir: tempDir,
        };

        expect(outWidget.render({ id: "out", type: "output-speed" }, ctx2, DEFAULT_SETTINGS)).toBe("Out: 50.0 t/s");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
});
