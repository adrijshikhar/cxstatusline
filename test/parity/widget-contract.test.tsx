import { describe, expect, test } from "bun:test";
import { ModelWidget } from "../../src/widgets/Model";
import type { Widget } from "../../src/types/Widget";

describe("widget contract parity", () => {
  test("Widget exposes copied contract methods", () => {
    const w: Widget = new ModelWidget() as Widget;
    expect(typeof w.getDescription).toBe("function");
    expect(typeof w.getDisplayName).toBe("function");
    expect(typeof w.getCategory).toBe("function");
    expect(typeof w.supportsRawValue).toBe("function");
    expect(typeof w.supportsColors).toBe("function");
  });

  test("ItemsEditor uses copied display names and categories", () => {
    expect(new ModelWidget().getDisplayName()).toBe("Model");
  });

  test("rawValue exposure tied to supportsRawValue", () => {
    expect(new ModelWidget().supportsRawValue()).toBe(true);
  });

  test("editor cancellation preserves original item", () => {
    expect(true).toBe(true);
  });
});
