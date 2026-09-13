import { expect, test } from "bun:test";
import { DEFAULT_SETTINGS } from "../../src/types/Settings";
import type { RenderContext } from "../../src/types/RenderContext";
import type { WidgetItem } from "../../src/types/Widget";
import { CustomTextWidget } from "../../src/widgets/CustomText";

const widget = new CustomTextWidget();
const live: RenderContext = { data: { payload_version: 1 }, now: new Date(0), terminalWidth: 80, isPreview: false };
const preview: RenderContext = { ...live, isPreview: true };
const item = (customText?: string): WidgetItem => ({ id: "t", type: "custom-text" as any, ...(customText !== undefined && { customText }) });

test("renders the configured text in live and preview mode", () => {
  expect(widget.render(item("[PROD]"), live, DEFAULT_SETTINGS)).toBe("[PROD]");
  expect(widget.render(item("[PROD]"), preview, DEFAULT_SETTINGS)).toBe("[PROD]");
});

test("renders empty when unset so the renderer omits it", () => {
  expect(widget.render(item(), live, DEFAULT_SETTINGS)).toBe("");
});

test("editor display, keybind, category and flags match upstream", () => {
  expect(widget.getEditorDisplay(item("[PROD]"))).toEqual({ displayText: "Custom Text ([PROD])" });
  expect(widget.getEditorDisplay(item())).toEqual({ displayText: "Custom Text (Empty)" });
  expect(widget.getCustomKeybinds()).toEqual([{ key: "e", label: "(e)dit text", action: "edit-text" }]);
  expect(widget.getCategory()).toBe("Custom");
  expect(widget.getDefaultColor()).toBe("white");
  expect(widget.supportsRawValue()).toBe(false);
  expect(widget.supportsColors(item())).toBe(true);
  expect(typeof widget.renderEditor).toBe("function");
});
