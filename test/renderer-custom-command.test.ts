import { expect, test } from "bun:test";
import { DEFAULT_SETTINGS, type Settings } from "../src/types/Settings";
import type { RenderContext } from "../src/types/RenderContext";
import { getVisibleText } from "../src/utils/ansi";
import { renderStatusLines } from "../src/utils/renderer";

const live: RenderContext = { data: { payload_version: 1 }, now: new Date(0), terminalWidth: 80, isPreview: false };
const command = "printf '\\033[31mred\\033[0m\\007 tail\\nsecond line\\n'";
const settings = (preserveColors: boolean): Settings => ({
  ...DEFAULT_SETTINGS,
  colorLevel: 3,
  lines: [[{ id: "c", type: "custom-command", commandPath: command, preserveColors, color: "cyan" }]],
});

test.skipIf(process.platform === "win32")("preserveColors keeps command SGR, drops other control chars and later lines", () => {
  const [row] = renderStatusLines(settings(true), live);
  expect(row).toContain("\x1b[31mred\x1b[0m tail");
  expect(row).not.toContain("\x07");
  expect(row).not.toContain("second");
  expect(getVisibleText(row!)).toBe("red tail");
});

test.skipIf(process.platform === "win32")("without preserveColors the command's ANSI is stripped and the item colour applies", () => {
  const [row] = renderStatusLines(settings(false), live);
  expect(row).not.toContain("\x1b[31m");
  expect(getVisibleText(row!)).toBe("red tail");
});

test("preview never executes and shows the command placeholder", () => {
  const [row] = renderStatusLines(settings(false), { ...live, isPreview: true });
  expect(getVisibleText(row!)).toBe("[cmd: printf '\\033[31mred\\...]");
});
