import { expect, test } from "bun:test";
import { DEFAULT_SETTINGS } from "../../src/types/Settings";
import type { RenderContext } from "../../src/types/RenderContext";
import type { WidgetItem } from "../../src/types/Widget";
import { CustomSymbolWidget } from "../../src/widgets/CustomSymbol";

const widget = new CustomSymbolWidget();
const live: RenderContext = { data: { payload_version: 1 }, now: new Date(0), terminalWidth: 80, isPreview: false };
const item = (customSymbol?: string): WidgetItem => ({ id: "s", type: "custom-symbol" as any, ...(customSymbol !== undefined && { customSymbol }) });

test("renders the symbol, or empty when unset", () => {
  expect(widget.render(item("⚡"), live, DEFAULT_SETTINGS)).toBe("⚡");
  expect(widget.render(item("👩‍💻"), live, DEFAULT_SETTINGS)).toBe("👩‍💻");
  expect(widget.render(item(), live, DEFAULT_SETTINGS)).toBe("");
});

test("editor display, keybind, category and flags match upstream", () => {
  expect(widget.getEditorDisplay(item("⚡"))).toEqual({ displayText: "Custom Symbol (⚡)" });
  expect(widget.getEditorDisplay(item())).toEqual({ displayText: "Custom Symbol (?)" });
  expect(widget.getCustomKeybinds()).toEqual([{ key: "e", label: "(e)dit symbol", action: "edit-symbol" }]);
  expect(widget.getCategory()).toBe("Custom");
  expect(widget.supportsRawValue()).toBe(false);
  expect(widget.supportsColors(item())).toBe(true);
});
