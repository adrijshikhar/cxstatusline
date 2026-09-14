import { describe, expect, test } from "bun:test";
import type { GlobalNumberFormat, NumberFormat } from "../src/types/NumberFormat";
import { DEFAULT_SETTINGS } from "../src/types/Settings";
import type { WidgetItem } from "../src/types/Widget";
import { formatTokens } from "../src/utils/format-tokens";
import {
  CYCLE_NUMBER_STYLE_ACTION,
  cycleNumberStyle,
  formatPercent,
  getNextNumberStyle,
  getNumberFormatKeybind,
  getNumberFormatModifierText,
  renderMagnitude,
  resolveNumberFormat,
} from "../src/utils/number-format";

describe("renderMagnitude", () => {
  const cases: { value: number; format: NumberFormat; baseline: number; expected: string }[] = [
    { value: 1, format: {}, baseline: 1, expected: "1.0" },
    { value: 1, format: { style: "compact" }, baseline: 1, expected: "1" },
    { value: 1.1, format: { style: "compact" }, baseline: 1, expected: "1.1" },
    { value: 512, format: { style: "compact" }, baseline: 1, expected: "512" },
    { value: 1, format: { decimals: 2 }, baseline: 1, expected: "1.00" },
    { value: 1.149, format: { style: "whole" }, baseline: 1, expected: "1" },
    { value: 12, format: {}, baseline: 0, expected: "12" },
    { value: 12, format: { decimals: 1 }, baseline: 0, expected: "12.0" },
  ];

  for (const { value, format, baseline, expected } of cases) {
    test(`value ${value} with ${JSON.stringify(format)} over baseline ${baseline} -> ${expected}`, () => {
      expect(renderMagnitude(value, format, baseline)).toBe(expected);
    });
  }
});

describe("formatPercent", () => {
  test("keeps one decimal by default (unchanged)", () => {
    expect(formatPercent(84.5)).toBe("84.5%");
    expect(formatPercent(100)).toBe("100.0%");
  });

  test("compact trims a pointless trailing zero", () => {
    expect(formatPercent(100, { style: "compact" })).toBe("100%");
    expect(formatPercent(84.5, { style: "compact" })).toBe("84.5%");
  });

  test("whole rounds to an integer", () => {
    expect(formatPercent(84.4, { style: "whole" })).toBe("84%");
    expect(formatPercent(99.9, { style: "whole" })).toBe("100%");
  });
});

describe("resolveNumberFormat", () => {
  const widget = (numberFormat?: NumberFormat): WidgetItem => ({
    id: "w",
    type: "tokens-input",
    ...(numberFormat ? { numberFormat } : {}),
  });
  const withGlobal = (numberFormat: GlobalNumberFormat) => ({ ...DEFAULT_SETTINGS, numberFormat });

  test("returns an empty format when nothing is set (current behavior)", () => {
    expect(resolveNumberFormat("token", widget(), DEFAULT_SETTINGS)).toEqual({});
  });

  test("uses the per-widget value when no global is set", () => {
    expect(resolveNumberFormat("token", widget({ style: "compact" }), DEFAULT_SETTINGS)).toEqual({ style: "compact" });
  });

  test("lets a global for the kind win over the per-widget value", () => {
    const settings = withGlobal({ token: { style: "whole" } });
    expect(resolveNumberFormat("token", widget({ style: "compact" }), settings)).toEqual({ style: "whole" });
  });

  test("ignores a global set for a different kind", () => {
    const settings = withGlobal({ speed: { style: "whole" } });
    expect(resolveNumberFormat("token", widget({ style: "compact" }), settings)).toEqual({ style: "compact" });
  });
});

describe("formatTokens with a format", () => {
  test("compact trims pointless trailing zeros", () => {
    expect(formatTokens(1000000, { style: "compact" })).toBe("1M");
    expect(formatTokens(1147000, { style: "compact" })).toBe("1.1M");
    expect(formatTokens(512000, { style: "compact" })).toBe("512k");
  });

  test("whole drops decimals and still promotes to M correctly", () => {
    expect(formatTokens(1000000, { style: "whole" })).toBe("1M");
    expect(formatTokens(999600, { style: "whole" })).toBe("1M");
  });

  test("decimals widens precision", () => {
    expect(formatTokens(1000000, { decimals: 2 })).toBe("1.00M");
  });

  test("default (no format) is byte-identical to today", () => {
    expect(formatTokens(1000000)).toBe("1.0M");
    expect(formatTokens(512000)).toBe("512.0k");
  });
});

describe("cycleNumberStyle", () => {
  test("cycles default, compact, whole, then back to default", () => {
    const item: WidgetItem = { id: "1", type: "tokens-input" };

    const compact = cycleNumberStyle(item);
    const whole = cycleNumberStyle(compact);
    const off = cycleNumberStyle(whole);

    expect(compact.numberFormat).toEqual({ style: "compact" });
    expect(whole.numberFormat).toEqual({ style: "whole" });
    expect(off).toEqual({ id: "1", type: "tokens-input" });
  });

  test("preserves an explicit decimals across the cycle", () => {
    const item: WidgetItem = { id: "1", type: "tokens-input", numberFormat: { decimals: 2 } };

    const compact = cycleNumberStyle(item);
    const whole = cycleNumberStyle(compact);
    const off = cycleNumberStyle(whole);

    expect(compact.numberFormat).toEqual({ style: "compact", decimals: 2 });
    expect(whole.numberFormat).toEqual({ style: "whole", decimals: 2 });
    expect(off.numberFormat).toEqual({ decimals: 2 });
  });

  test("treats an explicit precise style as the default state", () => {
    const item: WidgetItem = {
      id: "1",
      type: "tokens-input",
      numberFormat: { style: "precise", decimals: 2 },
    };

    expect(cycleNumberStyle(item).numberFormat).toEqual({ style: "compact", decimals: 2 });
    expect(getNextNumberStyle("precise")).toBe("compact");
  });

  test("leaves other widget fields untouched", () => {
    const item: WidgetItem = { id: "1", type: "tokens-input", color: "blue", bold: true };

    expect(cycleNumberStyle(item)).toEqual({
      id: "1",
      type: "tokens-input",
      color: "blue",
      bold: true,
      numberFormat: { style: "compact" },
    });
  });
});

describe("getNumberFormatKeybind", () => {
  test("binds the precision cycle to '.'", () => {
    expect(getNumberFormatKeybind()).toEqual({
      key: ".",
      label: "(.) precision",
      action: CYCLE_NUMBER_STYLE_ACTION,
    });
  });
});

describe("getNumberFormatModifierText", () => {
  const item = (style?: "precise" | "compact" | "whole"): WidgetItem => ({
    id: "1",
    type: "tokens-input",
    ...(style ? { numberFormat: { style } } : {}),
  });

  test("omits the default number style", () => {
    expect(getNumberFormatModifierText(item())).toBeUndefined();
    expect(getNumberFormatModifierText(item("precise"))).toBeUndefined();
  });

  test("labels non-default number styles", () => {
    expect(getNumberFormatModifierText(item("compact"))).toBe("(compact)");
    expect(getNumberFormatModifierText(item("whole"))).toBe("(whole)");
  });
});
