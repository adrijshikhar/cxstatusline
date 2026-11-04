import { describe, expect, it } from "bun:test";
import { buildEnabledPowerlineSettings } from "../src/utils/powerline-settings";
import { DEFAULT_SETTINGS } from "../src/types/Settings";
import type { WidgetItem } from "../src/types/Widget";

describe("buildEnabledPowerlineSettings", () => {
  it("keeps manual separators in config when enabling Powerline", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      lines: [[
        { id: "1", type: "model" as const },
        { id: "2", type: "separator" as const },
        { id: "3", type: "context-length" as const },
      ]],
    };
    const updated = buildEnabledPowerlineSettings(settings);
    expect(updated.lines[0]?.map((i) => i.type)).toEqual(["model", "separator", "context-length"]);
  });

  it("does not delete a manual separator across an enable then disable round trip", () => {
    const line: WidgetItem[] = [
      { id: "1", type: "model" },
      { id: "2", type: "separator" },
      { id: "3", type: "context-length" },
    ];
    const settings = {
      ...DEFAULT_SETTINGS,
      powerline: {
        ...DEFAULT_SETTINGS.powerline,
        enabled: false,
      },
      lines: [line],
    };

    const enabled = buildEnabledPowerlineSettings(settings);
    const disabled = {
      ...enabled,
      powerline: {
        ...enabled.powerline,
        enabled: false,
      },
    };

    expect(disabled.lines[0]?.map((item) => item.type)).toEqual(["model", "separator", "context-length"]);
  });
});
