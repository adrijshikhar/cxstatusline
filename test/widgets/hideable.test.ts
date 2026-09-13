import { describe, expect, test } from "bun:test";
import type { HideableState, WidgetItem } from "../../src/types/Widget";
import {
  EDIT_HIDE_STATES_ACTION,
  getHideKeybind,
  getHideModifierText,
  isHideStateEnabled,
  NO_GIT_HIDEABLE_STATE,
  parseHideStates,
  setHideStates,
  ZERO_HIDEABLE_STATE,
} from "../../src/widgets/shared/hideable";

describe("hideable states helper", () => {
  describe("parseHideStates", () => {
    test("handles undefined", () => {
      expect(parseHideStates(undefined)).toEqual([]);
    });

    test("handles empty string", () => {
      expect(parseHideStates("")).toEqual([]);
    });

    test("handles single item", () => {
      expect(parseHideStates("a")).toEqual(["a"]);
    });

    test("handles comma separated with whitespace", () => {
      expect(parseHideStates("a, b")).toEqual(["a", "b"]);
    });

    test("handles trailing commas and extra whitespace", () => {
      expect(parseHideStates("a, b, ")).toEqual(["a", "b"]);
      expect(parseHideStates(" , a, , b , ")).toEqual(["a", "b"]);
    });
  });

  describe("isHideStateEnabled", () => {
    const defaultOnState: HideableState = { key: "zero", label: "when zero", defaultEnabled: true };
    const defaultOffState: HideableState = { key: "no-git", label: "when not in a git repo" };

    test("returns declared defaultEnabled when metadata.hide is absent", () => {
      const item: WidgetItem = { id: "1", type: "git-branch" };
      expect(isHideStateEnabled(item, defaultOnState)).toBe(true);
      expect(isHideStateEnabled(item, defaultOffState)).toBe(false);
    });

    test("metadata.hide list is authoritative when present", () => {
      const itemWithNoGit: WidgetItem = { id: "1", type: "git-branch", metadata: { hide: "no-git" } };
      expect(isHideStateEnabled(itemWithNoGit, defaultOffState)).toBe(true);
      expect(isHideStateEnabled(itemWithNoGit, defaultOnState)).toBe(false);

      const itemWithBoth: WidgetItem = { id: "1", type: "git-branch", metadata: { hide: "no-git,zero" } };
      expect(isHideStateEnabled(itemWithBoth, defaultOffState)).toBe(true);
      expect(isHideStateEnabled(itemWithBoth, defaultOnState)).toBe(true);
    });

    test("explicitly empty list disables a defaultEnabled state", () => {
      const itemWithEmpty: WidgetItem = { id: "1", type: "git-branch", metadata: { hide: "" } };
      expect(isHideStateEnabled(itemWithEmpty, defaultOnState)).toBe(false);
      expect(isHideStateEnabled(itemWithEmpty, defaultOffState)).toBe(false);
    });

    test("accepts string keys", () => {
      const item: WidgetItem = { id: "1", type: "git-branch", metadata: { hide: "no-git" } };
      expect(isHideStateEnabled(item, "no-git")).toBe(true);
      expect(isHideStateEnabled(item, "zero")).toBe(false);
    });
  });

  describe("setHideStates", () => {
    test("writes a sorted comma list", () => {
      const item: WidgetItem = { id: "1", type: "git-branch" };
      const updated = setHideStates(item, ["zero", "no-git"]);
      expect(updated.metadata?.hide).toBe("no-git,zero");
    });

    test("removes metadata.hide when the list is empty", () => {
      const itemWithHide: WidgetItem = { id: "1", type: "git-branch", metadata: { hide: "no-git", other: "val" } };
      const updated = setHideStates(itemWithHide, []);
      expect(updated.metadata?.hide).toBeUndefined();
      expect(updated.metadata?.other).toBe("val");

      const itemWithOnlyHide: WidgetItem = { id: "1", type: "git-branch", metadata: { hide: "no-git" } };
      const updatedOnly = setHideStates(itemWithOnlyHide, []);
      expect(updatedOnly.metadata).toBeUndefined();
    });

    test("does not mutate the input item", () => {
      const original: WidgetItem = { id: "1", type: "git-branch", metadata: { hide: "no-git" } };
      const snapshot = JSON.stringify(original);
      const updated = setHideStates(original, ["zero"]);
      expect(JSON.stringify(original)).toBe(snapshot);
      expect(updated).not.toBe(original);
      expect(updated.metadata?.hide).toBe("zero");
    });
  });

  describe("constants and keybinds", () => {
    test("exports actions and keybinds", () => {
      expect(EDIT_HIDE_STATES_ACTION).toBe("edit-hide-states");
      expect(getHideKeybind()).toEqual({
        key: "h",
        label: "(h)ide…",
        action: "edit-hide-states",
      });
      expect(NO_GIT_HIDEABLE_STATE.key).toBe("no-git");
      expect(ZERO_HIDEABLE_STATE.key).toBe("zero");
    });

    test("getHideModifierText returns formatted modifier text or undefined", () => {
      const states = [NO_GIT_HIDEABLE_STATE, ZERO_HIDEABLE_STATE];
      const item: WidgetItem = { id: "1", type: "git-branch", metadata: { hide: "no-git" } };
      expect(getHideModifierText(item, states)).toBe("(hide: no-git)");

      const emptyItem: WidgetItem = { id: "1", type: "git-branch" };
      expect(getHideModifierText(emptyItem, states)).toBeUndefined();
    });
  });
});
