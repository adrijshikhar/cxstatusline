import { describe, expect, it } from "bun:test";
import { DEFAULT_SETTINGS, SettingsSchema } from "../src/types/Settings";

describe("SettingsSchema defaults", () => {
  it("defaults flexMode to full", () => {
    const parsed = SettingsSchema.parse({});
    expect(parsed.flexMode).toBe("full");
    expect(DEFAULT_SETTINGS.flexMode).toBe("full");
  });
});
