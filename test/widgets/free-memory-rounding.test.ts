import { describe, expect, it } from "bun:test";
import { FreeMemoryWidget } from "../../src/widgets/FreeMemory";
import { DEFAULT_SETTINGS } from "../../src/types/Settings";
import type { RenderContext } from "../../src/types/RenderContext";
import type { WidgetItem } from "../../src/types/Widget";

describe("FreeMemory unit rollover", () => {
  const widget = new FreeMemoryWidget();

  it("promotes to next unit when rounded value reaches 1024", () => {
    // 1023.6 MB used -> should display as 1.0G, not 1024M
    const item: WidgetItem = { id: "mem", type: "free-memory", rawValue: true };
    const context = {
      data: {
        memory: {
          totalBytes: 2 * 1024 ** 3,
          freeBytes: 2 * 1024 ** 3 - 1023.6 * 1024 ** 2,
        },
      },
    };
    const rendered = widget.render(item, context as any, DEFAULT_SETTINGS);
    expect(rendered).toContain("1.0G");
  });

  it("promotes to next unit when rounded value reaches 1024 with memoryUsage", () => {
    const item: WidgetItem = { id: "mem", type: "free-memory", rawValue: true };
    const context: RenderContext = {
      data: { payload_version: 1 },
      now: new Date(),
      terminalWidth: 80,
      isPreview: false,
      memoryUsage: {
        total: 2 * 1024 ** 3,
        used: 1023.6 * 1024 ** 2, // 1023.6 MB used
      },
    };
    expect(widget.render(item, context, DEFAULT_SETTINGS)).toBe("1.0G/2.0G");

    const kbContext: RenderContext = {
      ...context,
      memoryUsage: {
        total: 2 * 1024 ** 3,
        used: 1023.6 * 1024, // 1023.6 KB used -> 1M
      },
    };
    expect(widget.render(item, kbContext, DEFAULT_SETTINGS)).toBe("1M/2.0G");
  });

  it("keeps values below the rounding boundary in the smaller unit", () => {
    const item: WidgetItem = { id: "mem", type: "free-memory", rawValue: true };
    const context: RenderContext = {
      data: { payload_version: 1 },
      now: new Date(),
      terminalWidth: 80,
      isPreview: false,
      memoryUsage: {
        total: 2 * 1024 ** 3,
        used: 1023.4 * 1024 ** 2, // 1023.4 MB used
      },
    };
    expect(widget.render(item, context, DEFAULT_SETTINGS)).toBe("1023M/2.0G");

    const kbContext: RenderContext = {
      ...context,
      memoryUsage: {
        total: 2 * 1024 ** 3,
        used: 1023.4 * 1024, // 1023.4 KB used
      },
    };
    expect(widget.render(item, kbContext, DEFAULT_SETTINGS)).toBe("1023K/2.0G");
  });

  it("renders labeled value with prefix when rawValue is false", () => {
    const item: WidgetItem = { id: "mem", type: "free-memory", rawValue: false };
    const context: RenderContext = {
      data: { payload_version: 1 },
      now: new Date(),
      terminalWidth: 80,
      isPreview: false,
      memoryUsage: {
        total: 2 * 1024 ** 3,
        used: 1023.6 * 1024 ** 2,
      },
    };
    expect(widget.render(item, context, DEFAULT_SETTINGS)).toBe("Mem: 1.0G/2.0G");
  });

  it("promotes freeMemoryBytes fallback properly", () => {
    const item: WidgetItem = { id: "mem", type: "free-memory", rawValue: true };
    const context: RenderContext = {
      data: { payload_version: 1 },
      now: new Date(),
      terminalWidth: 80,
      isPreview: false,
      freeMemoryBytes: 1023.6 * 1024 ** 2,
    };
    expect(widget.render(item, context, DEFAULT_SETTINGS)).toBe("1.0G");
  });

  it("does not render NaNB when memory values are NaN", () => {
    const item: WidgetItem = { id: "mem", type: "free-memory", rawValue: true };
    const context = {
      data: {
        memory: {
          totalBytes: NaN,
          freeBytes: NaN,
        },
      },
      memoryUsage: { total: NaN, used: NaN },
    };
    const rendered = widget.render(item, context as any, DEFAULT_SETTINGS);
    expect(rendered).not.toContain("NaN");
    expect(rendered).toBe("0B/0B");
  });

  it("promotes bytes to kilobytes when rounded value reaches 1024", () => {
    const item: WidgetItem = { id: "mem", type: "free-memory", rawValue: true };
    const context: RenderContext = {
      data: { payload_version: 1 },
      now: new Date(),
      terminalWidth: 80,
      isPreview: false,
      memoryUsage: {
        total: 2 * 1024 ** 3,
        used: 1023.6, // 1023.6 bytes -> 1K
      },
    };
    expect(widget.render(item, context, DEFAULT_SETTINGS)).toBe("1K/2.0G");
  });
});
