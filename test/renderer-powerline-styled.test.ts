import { expect, test } from "bun:test";
import { DEFAULT_SETTINGS, type Settings } from "../src/types/Settings";
import type { RenderContext } from "../src/types/RenderContext";
import { getColorAnsiCode } from "../src/utils/colors";
import { renderStatusLines } from "../src/utils/renderer";

const live: RenderContext = { data: { payload_version: 1 }, now: new Date(0), terminalWidth: 80, isPreview: false };

test.skipIf(process.platform === "win32")("Powerline keeps segment background across command reset", () => {
  const bgCode = getColorAnsiCode("bgBlue", "ansi16", true);
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    colorLevel: 1,
    powerline: {
      ...DEFAULT_SETTINGS.powerline,
      enabled: true,
      theme: "custom",
    },
    lines: [[
      {
        id: "c",
        type: "custom-command",
        commandPath: "printf 'red\\033[31mR\\033[0m tail'",
        preserveColors: true,
        backgroundColor: "bgBlue",
      },
      {
        id: "m",
        type: "model",
        backgroundColor: "bgBlue",
      },
    ]],
  };

  const [row] = renderStatusLines(settings, live);
  expect(row).toContain("\x1b[0m" + bgCode + " tail");
  expect(row).toContain("\x1b[31mR");
  expect(row).not.toContain("\x1b[1m");
  expect(row).toContain("\x1b[0m");
});
