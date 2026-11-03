import { describe, expect, it } from "bun:test";
import {
  getDescriptionRows,
  getListWindow,
  getPickerMaxVisible,
} from "../src/tui/components/items-editor/list-window";
import {
  getPickerInsertIndex,
  placePickerSelection,
} from "../src/tui/components/items-editor/picker-selection";
import type { WidgetItem } from "../src/types/Widget";

describe("getListWindow", () => {
  it("keeps selection centered within visible window", () => {
    const window = getListWindow(20, 10, 5);
    expect(window.start).toBe(8);
    expect(window.end).toBe(13);
    expect(window.hiddenAbove).toBe(8);
    expect(window.hiddenBelow).toBe(7);
  });

  it("shows the whole list when it fits", () => {
    expect(getListWindow(5, 2, 10)).toEqual({ start: 0, end: 5, hiddenAbove: 0, hiddenBelow: 0 });
  });

  it("shows an empty window for an empty list", () => {
    expect(getListWindow(0, 0, 10)).toEqual({ start: 0, end: 0, hiddenAbove: 0, hiddenBelow: 0 });
  });

  it("starts at the top while the selection is near the top", () => {
    expect(getListWindow(90, 0, 10)).toEqual({ start: 0, end: 10, hiddenAbove: 0, hiddenBelow: 80 });
    expect(getListWindow(90, 4, 10)).toEqual({ start: 0, end: 10, hiddenAbove: 0, hiddenBelow: 80 });
  });

  it("centers the selection in the middle of the list", () => {
    expect(getListWindow(90, 50, 10)).toEqual({ start: 45, end: 55, hiddenAbove: 45, hiddenBelow: 35 });
  });

  it("stops at the bottom when the selection is near the end", () => {
    expect(getListWindow(90, 89, 10)).toEqual({ start: 80, end: 90, hiddenAbove: 80, hiddenBelow: 0 });
  });
});

describe("getPickerMaxVisible", () => {
  it("leaves room for the rest of the picker screen and every status line", () => {
    expect(getPickerMaxVisible(24, 1)).toBe(7);
    expect(getPickerMaxVisible(24, 3)).toBe(5);
  });

  it("never shows fewer than three entries on a tiny terminal", () => {
    expect(getPickerMaxVisible(12, 1)).toBe(3);
  });

  it("falls back to ten entries when the terminal height is unknown", () => {
    expect(getPickerMaxVisible(undefined, 1)).toBe(10);
  });

  it("gives every description row past the first to the description", () => {
    expect(getPickerMaxVisible(40, 1, 1)).toBe(23);
    expect(getPickerMaxVisible(40, 1, 7)).toBe(17);
    expect(getPickerMaxVisible(24, 1, 7)).toBe(3);
  });
});

describe("getDescriptionRows", () => {
  it("takes a row per line, wrapping long lines at word boundaries", () => {
    expect(getDescriptionRows("Shows the model", 40)).toBe(1);
    expect(getDescriptionRows("First line\nSecond line", 40)).toBe(2);
    expect(getDescriptionRows("aaaa bbbb cccc", 9)).toBe(2);
    expect(getDescriptionRows("aaaa bbbb cccc", 14)).toBe(1);
    expect(getDescriptionRows("aaaa bbbb\ncc", 4)).toBe(3);
  });

  it("breaks a word wider than a row across rows", () => {
    expect(getDescriptionRows("x".repeat(25), 10)).toBe(3);
    expect(getDescriptionRows(`a ${"x".repeat(20)}`, 10)).toBe(3);
  });

  it("counts wide characters by the columns they take", () => {
    expect(getDescriptionRows("日本語のテキスト", 8)).toBe(2);
  });

  it("takes a row per line when the width is unknown", () => {
    expect(getDescriptionRows("one\ntwo\nthree", undefined)).toBe(3);
  });
});

describe("picker-selection", () => {
  const model: WidgetItem = { id: "a", type: "model", color: "red" };
  const tokens: WidgetItem = { id: "b", type: "tokens-input" };
  const newWidget = { id: "new", backgroundColor: "bgBlue" };

  it("getPickerInsertIndex handles add, insert, change", () => {
    expect(getPickerInsertIndex("add", 2, 0)).toBe(1);
    expect(getPickerInsertIndex("add", 0, 0)).toBe(0);
    expect(getPickerInsertIndex("insert", 2, 1)).toBe(1);
    expect(getPickerInsertIndex("change", 2, 1)).toBe(1);
  });

  it("adds the new widget after the cursor", () => {
    expect(placePickerSelection([model, tokens], "add", 0, "git-branch", newWidget)).toEqual({
      widgets: [model, { id: "new", type: "git-branch", backgroundColor: "bgBlue" }, tokens],
      selectedIndex: 1,
    });
  });

  it("inserts the new widget before the cursor", () => {
    expect(placePickerSelection([model, tokens], "insert", 1, "git-branch", newWidget)).toEqual({
      widgets: [model, { id: "new", type: "git-branch", backgroundColor: "bgBlue" }, tokens],
      selectedIndex: 1,
    });
  });

  it("adds the new widget as the only item on an empty line", () => {
    expect(placePickerSelection([], "add", 0, "git-branch", newWidget)).toEqual({
      widgets: [{ id: "new", type: "git-branch", backgroundColor: "bgBlue" }],
      selectedIndex: 0,
    });
  });

  it("drops the label when the type changes, and keeps it when the type stays", () => {
    const labeled: WidgetItem = { ...model, metadata: { label: "M ", hide: "zero" } };

    expect(placePickerSelection([labeled, tokens], "change", 0, "git-branch", newWidget).widgets[0]).toEqual({
      id: "a",
      type: "git-branch",
      color: "red",
      metadata: { hide: "zero" },
    });
    expect(placePickerSelection([labeled, tokens], "change", 0, "model", newWidget).widgets[0]).toEqual(labeled);
  });

  it("changes the type of the widget at the cursor and keeps its other settings", () => {
    expect(placePickerSelection([model, tokens], "change", 0, "git-branch", newWidget)).toEqual({
      widgets: [{ id: "a", type: "git-branch", color: "red" }, tokens],
      selectedIndex: 0,
    });
  });

  it("leaves the line unchanged when changing with no widget at the cursor", () => {
    expect(placePickerSelection([], "change", 0, "git-branch", newWidget)).toEqual({
      widgets: [],
      selectedIndex: 0,
    });
  });

  it("does not mutate the input line", () => {
    const line = [model, tokens];
    placePickerSelection(line, "add", 0, "git-branch", newWidget);
    placePickerSelection(line, "change", 1, "git-branch", newWidget);
    expect(line).toEqual([{ id: "a", type: "model", color: "red" }, { id: "b", type: "tokens-input" }]);
  });
});
