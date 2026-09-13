import { expect, test } from "bun:test";
import { DEFAULT_SETTINGS } from "../src/types/Settings";
import { resolveStyledText } from "../src/utils/renderer";

const styled = "\x1b[31mred\x1b[0m";

test("unstyled content passes through unchanged", () => {
  expect(resolveStyledText("plain", false, DEFAULT_SETTINGS, "truecolor")).toEqual({ text: "plain", styled: false });
  expect(resolveStyledText("plain", undefined, DEFAULT_SETTINGS, "truecolor")).toEqual({ text: "plain", styled: false });
});

test("styled content keeps its SGR when colour is on and no solid override is set", () => {
  expect(resolveStyledText(styled, true, DEFAULT_SETTINGS, "truecolor")).toEqual({ text: styled, styled: true });
  expect(resolveStyledText(styled, true, { ...DEFAULT_SETTINGS, overrideForegroundColor: "gradient:hex:FF0000,hex:0000FF" }, "truecolor"))
    .toEqual({ text: styled, styled: true });
});

test("styled content is stripped when colour is off or a solid override foreground wins", () => {
  expect(resolveStyledText(styled, true, DEFAULT_SETTINGS, "none")).toEqual({ text: "red", styled: false });
  expect(resolveStyledText(styled, true, { ...DEFAULT_SETTINGS, overrideForegroundColor: "cyan" }, "truecolor")).toEqual({ text: "red", styled: false });
});
