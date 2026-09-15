import { describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS } from "../../src/types/Settings";
import { STORAGE_KEY, loadSavedSettings, persistSettings } from "./settings-store";

describe("browser settings storage", () => {
  test("migrates valid data and leaves invalid or failed writes alone", () => {
    let value = JSON.stringify({ ...DEFAULT_SETTINGS, version: 2 });
    const storage = { getItem: () => value, setItem: (_key: string, next: string) => { value = next; } };
    expect(loadSavedSettings(storage).settings?.version).toBe(3);
    const saved = persistSettings(storage, DEFAULT_SETTINGS);
    expect(JSON.parse(value)).toEqual(saved);
    value = "{bad";
    expect(loadSavedSettings(storage).settings).toBeNull();
    expect(loadSavedSettings({ getItem: () => { throw new Error("blocked"); } }).error).toContain("could not be loaded");
    expect(() => persistSettings({ setItem: () => { throw new Error("full"); } }, DEFAULT_SETTINGS)).toThrow("full");
  });
});
