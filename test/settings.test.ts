import { describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SETTINGS, SettingsSchema } from "../src/types/Settings";
import { WidgetItemSchema } from "../src/types/Widget";
import { loadSettings, saveSettings } from "../src/utils/config";
import { tmpEnv } from "./helpers";

function settingsFile(): string {
  const { root } = tmpEnv();
  return join(root, ".config", "cxstatusline", "settings.json");
}

describe("settings", () => {
  test("items accept the user-defined widget fields", () => {
    expect(WidgetItemSchema.safeParse({
      id: "c", type: "model", customText: "[PROD]", customSymbol: "⚡", commandPath: "date", preserveColors: true, timeout: 4000,
    }).success).toBe(true);
    expect(WidgetItemSchema.safeParse({ id: "c", type: "model", timeout: 0 }).success).toBe(false);
    expect(WidgetItemSchema.safeParse({ id: "c", type: "model", timeout: 2.5 }).success).toBe(false);
  });

  test("items accept refreshMs positive integer and reject invalid values", () => {
    expect(WidgetItemSchema.safeParse({ id: "c", type: "custom-command", commandPath: "date", refreshMs: 5000 }).success).toBe(true);
    expect(WidgetItemSchema.safeParse({ id: "c", type: "custom-command", commandPath: "date" }).success).toBe(true);
    expect(WidgetItemSchema.safeParse({ id: "c", type: "custom-command", commandPath: "date", refreshMs: 0 }).success).toBe(false);
    expect(WidgetItemSchema.safeParse({ id: "c", type: "custom-command", commandPath: "date", refreshMs: -100 }).success).toBe(false);
    expect(WidgetItemSchema.safeParse({ id: "c", type: "custom-command", commandPath: "date", refreshMs: 2.5 }).success).toBe(false);
  });


  test("settings enforce one to three rows and the closed widget enum", () => {
    expect(SettingsSchema.safeParse({ version: 2, lines: [] }).success).toBe(false);
    expect(SettingsSchema.safeParse({ version: 2, lines: [[], [], [], []] }).success).toBe(false);
    expect(SettingsSchema.safeParse({ version: 2, lines: [[{ id: "x", type: "weather" }]] }).success).toBe(false);
    expect(SettingsSchema.safeParse({ version: 2, lines: [[{ id: "x", type: "custom-command", commandPath: "date" }]] }).success).toBe(true);
    expect(SettingsSchema.safeParse({ version: 1, lines: [[]] }).success).toBe(false);
  });

  test("writes defaults only when the settings file is absent", async () => {
    const file = settingsFile();
    const loaded = await loadSettings(file);

    expect(loaded).toEqual({ settings: DEFAULT_SETTINGS, error: null });
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(DEFAULT_SETTINGS);
  });

  test("malformed settings are preserved and defaults stay in memory", async () => {
    const file = settingsFile();
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, "{");

    const loaded = await loadSettings(file);

    expect(loaded.error).toContain("valid JSON");
    expect(readFileSync(file, "utf8")).toBe("{");
    expect(loaded.settings).toEqual(DEFAULT_SETTINGS);
  });

  test("invalid schema settings are preserved", async () => {
    const file = settingsFile();
    mkdirSync(join(file, ".."), { recursive: true });
    const invalid = JSON.stringify({ version: 2, lines: [] });
    writeFileSync(file, invalid);

    const loaded = await loadSettings(file);

    expect(loaded.error).toContain("valid format");
    expect(readFileSync(file, "utf8")).toBe(invalid);
    expect(loaded.settings).toEqual(DEFAULT_SETTINGS);
  });

  test("save writes through a settings symlink without replacing it", async () => {
    const file = settingsFile();
    const target = join(file, "..", "..", "dotfiles", "settings.json");
    mkdirSync(join(file, ".."), { recursive: true });
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, JSON.stringify(DEFAULT_SETTINGS));
    symlinkSync(target, file);

    const settings = { ...DEFAULT_SETTINGS, flexMode: "full" as const };
    await saveSettings(file, settings);

    expect(lstatSync(file).isSymbolicLink()).toBe(true);
    expect(realpathSync(file)).toBe(realpathSync(target));
    expect(JSON.parse(readFileSync(target, "utf8"))).toEqual(settings);
    expect(readdirSync(join(target, "..")).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    expect(existsSync(file)).toBe(true);
  });
});
