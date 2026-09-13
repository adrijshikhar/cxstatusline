import { expect, test } from "bun:test";
import { keepSgrOnly } from "../src/utils/ansi";

test("keepSgrOnly keeps SGR sequences and drops every other control character", () => {
  const input = "\x1b[31mred\x1b[0m \x1b]8;;http://x\x1b\\link\x1b]8;;\x1b\\ bell\x07 nl\n tab\t \x1b[2Jclear \x9bcsi";
  expect(keepSgrOnly(input)).toBe("\x1b[31mred\x1b[0m ]8;;http://x\\link]8;;\\ bell nl tab [2Jclear csi");
});

test("keepSgrOnly leaves plain text and multi-parameter SGR untouched", () => {
  expect(keepSgrOnly("plain")).toBe("plain");
  expect(keepSgrOnly("\x1b[38;2;10;20;30;1mx\x1b[22;39m")).toBe("\x1b[38;2;10;20;30;1mx\x1b[22;39m");
});
