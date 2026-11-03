import { describe, expect, it } from "bun:test";
import { PassThrough } from "node:stream";
import { render, type Instance } from "ink";
import React from "react";
import { countSeparatorSlots } from "../src/utils/separator-index";
import { assignPowerlineThemeSlots, countPowerlineThemeSlots, type PowerlineThemeSlotEntry } from "../src/utils/powerline-theme-index";
import { renderStatusLines } from "../src/utils/renderer";
import { DEFAULT_SETTINGS, type Settings } from "../src/types/Settings";
import type { WidgetItem } from "../src/types/Widget";
import type { RenderContext } from "../src/types/RenderContext";
import { renderSymbolSlotsEditor, type SymbolSlot } from "../src/widgets/shared/symbol-override";

const live: RenderContext = { data: { payload_version: 1 }, now: new Date(0), terminalWidth: 80, isPreview: false };

describe("separator-index merge boundaries", () => {
  it("carries a merge across a hidden widget that is merged too", () => {
    const widgets: WidgetItem[] = [
      { id: "1", type: "model", merge: true },
      { id: "hidden", type: "custom-text", merge: true },
      { id: "2", type: "context-length" },
    ];
    const preRendered = [
      { content: "model", widget: widgets[0]! },
      { content: "", widget: widgets[1]! },
      { content: "context", widget: widgets[2]! },
    ];

    expect(countSeparatorSlots(widgets, preRendered)).toBe(0);
  });

  it("ends a merge at a hidden widget that is not merged onward", () => {
    const widgets: WidgetItem[] = [
      { id: "1", type: "model", merge: true },
      { id: "hidden", type: "custom-text" },
      { id: "2", type: "context-length" },
    ];
    const preRendered = [
      { content: "model", widget: widgets[0]! },
      { content: "", widget: widgets[1]! },
      { content: "context", widget: widgets[2]! },
    ];

    expect(countSeparatorSlots(widgets, preRendered)).toBe(1);
  });
});

describe("powerline-theme-index merge boundaries", () => {
  const entry = (widget: WidgetItem, content = "content"): PowerlineThemeSlotEntry => ({
    widget,
    content,
  });

  it("carries a merge across a hidden widget that is merged too", () => {
    const entries: PowerlineThemeSlotEntry[] = [
      entry({ id: "1", type: "model", merge: true }),
      entry({ id: "2", type: "custom-text", merge: true }, ""),
      entry({ id: "3", type: "context-length" }),
    ];

    expect(countPowerlineThemeSlots(entries)).toBe(1);
  });

  it("ends a merge at a hidden widget that is not merged onward", () => {
    const entries: PowerlineThemeSlotEntry[] = [
      entry({ id: "1", type: "model", merge: true }),
      entry({ id: "2", type: "custom-text" }, ""),
      entry({ id: "3", type: "context-length" }),
    ];

    expect(countPowerlineThemeSlots(entries)).toBe(2);
  });
});

describe("renderer merge boundaries at empty widgets", () => {
  it("ends a merge at an empty widget that is not merged, restoring the default separator", () => {
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      defaultSeparator: "|",
      lines: [[
        { id: "a", type: "custom-text", customText: "A", merge: true },
        { id: "b", type: "custom-text", customText: "" },
        { id: "c", type: "custom-text", customText: "C" },
      ]],
    };
    const unmergedSettings: Settings = {
      ...DEFAULT_SETTINGS,
      defaultSeparator: "|",
      lines: [[
        { id: "a", type: "custom-text", customText: "A" },
        { id: "b", type: "custom-text", customText: "" },
        { id: "c", type: "custom-text", customText: "C" },
      ]],
    };

    const [rendered] = renderStatusLines(settings, live);
    const [expected] = renderStatusLines(unmergedSettings, live);
    expect(rendered).toBe(expected);
    expect(rendered).toContain("|");
  });

  it("carries a merge across an empty widget that is merged too", () => {
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      defaultSeparator: "|",
      lines: [[
        { id: "a", type: "custom-text", customText: "A", merge: true },
        { id: "b", type: "custom-text", customText: "", merge: true },
        { id: "c", type: "custom-text", customText: "C" },
      ]],
    };

    const [rendered] = renderStatusLines(settings, live);
    expect(rendered).not.toContain("|");
  });

  it("ends a merge in powerline mode when intermediate widget is empty and not merged onward", () => {
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      colorLevel: 1,
      powerline: {
        ...DEFAULT_SETTINGS.powerline,
        enabled: true,
        theme: "nord-aurora",
      },
      lines: [[
        { id: "a", type: "custom-text", customText: "A", merge: true },
        { id: "b", type: "custom-text", customText: "" },
        { id: "c", type: "custom-text", customText: "C" },
      ]],
    };
    const unmergedSettings: Settings = {
      ...DEFAULT_SETTINGS,
      colorLevel: 1,
      powerline: {
        ...DEFAULT_SETTINGS.powerline,
        enabled: true,
        theme: "nord-aurora",
      },
      lines: [[
        { id: "a", type: "custom-text", customText: "A" },
        { id: "b", type: "custom-text", customText: "" },
        { id: "c", type: "custom-text", customText: "C" },
      ]],
    };

    const [rendered] = renderStatusLines(settings, live);
    const [expected] = renderStatusLines(unmergedSettings, live);
    expect(rendered).toBe(expected);
  });
});

describe("SymbolSlotsEditor Shift+Tab toggle", () => {
  interface Harness {
    instance: Instance;
    lastFrame: () => string;
    write: (input: string) => Promise<void>;
    cleanup: () => void;
  }

  function createHarness(node: React.ReactElement): Harness {
    const stdin = new PassThrough() as PassThrough & {
      isTTY: boolean;
      setRawMode(enabled: boolean): PassThrough;
      ref(): PassThrough;
      unref(): PassThrough;
    };
    stdin.isTTY = true;
    stdin.setRawMode = () => stdin;
    stdin.ref = () => stdin;
    stdin.unref = () => stdin;
    const stdout = new PassThrough() as PassThrough & { columns: number; rows: number };
    stdout.columns = 120;
    stdout.rows = 40;
    let lastFrame = "";
    stdout.on("data", (chunk: Buffer) => { lastFrame = chunk.toString(); });
    const instance = render(node, {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      stderr: new PassThrough() as unknown as NodeJS.WriteStream,
      debug: true,
      exitOnCtrlC: false,
      patchConsole: false,
    });
    return {
      instance,
      lastFrame: () => lastFrame,
      async write(input: string): Promise<void> {
        stdin.write(input);
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      },
      cleanup() { instance.unmount(); instance.cleanup(); },
    };
  }

  it("blanks every slot on Shift+Tab and restores on second Shift+Tab", async () => {
    let completedItem: WidgetItem | undefined;
    const slots: SymbolSlot[] = [
      { id: "symbol1", label: "Symbol 1", defaultSymbol: "A" },
      { id: "symbol2", label: "Symbol 2", defaultSymbol: "B" },
    ];
    const initialWidget: WidgetItem = { id: "w", type: "git-changes" };

    const harness = createHarness(renderSymbolSlotsEditor({
      widget: initialWidget,
      onComplete: (item) => { completedItem = item; },
      onCancel: () => {},
    }, slots));

    try {
      expect(harness.lastFrame()).toContain("Symbol 1:");
      // Shift+Tab sequence: \x1b[Z
      await harness.write("\x1b[Z");
      await harness.write("\r");
      expect(completedItem?.metadata).toEqual({
        symbol1: "",
        symbol2: "",
      });
    } finally {
      harness.cleanup();
    }

    // Now test second Shift+Tab restores defaults
    let restoredItem: WidgetItem | undefined;
    const harness2 = createHarness(renderSymbolSlotsEditor({
      widget: {
        id: "w",
        type: "git-changes",
        metadata: {
          symbol1: "",
          symbol2: "",
        },
      },
      onComplete: (item) => { restoredItem = item; },
      onCancel: () => {},
    }, slots));

    try {
      expect(harness2.lastFrame()).toContain("Symbol 1:");
      await harness2.write("\x1b[Z");
      await harness2.write("\r");
      expect(restoredItem?.metadata).toBeUndefined();
    } finally {
      harness2.cleanup();
    }
  });
});
