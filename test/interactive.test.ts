import { expect, test } from "bun:test";
import { canPrompt } from "../src/utils/interactive";
import { isUsableMenuSize, menuItemsForRows } from "../src/ui/terminal-size";

test.each([
  [false, false, false],
  [false, true, false],
  [true, false, false],
  [true, true, true],
])("prompts only when stdin=%s and stdout=%s are TTYs", (stdin, stdout, expected) => {
  expect(canPrompt({ isTTY: stdin }, { isTTY: stdout })).toBe(expected);
});

test("interactive menus enforce minimum size and cap visible choices", () => {
  expect(isUsableMenuSize(39, 20)).toBe(false);
  expect(isUsableMenuSize(40, 19)).toBe(false);
  expect(isUsableMenuSize(40, 20)).toBe(true);
  expect(menuItemsForRows(20)).toBe(7);
  expect(menuItemsForRows(40)).toBe(8);
});
