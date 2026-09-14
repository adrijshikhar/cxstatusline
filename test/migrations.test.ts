import { describe, expect, test } from "bun:test";
import { migrateSettings } from "../src/utils/migrations";
import { CURRENT_VERSION, SettingsSchema } from "../src/types/Settings";

const v2 = () => ({
  version: 2,
  lines: [[
    { id: "b", type: "git-branch", color: "magenta", metadata: { hideNoGit: "true" } },
    { id: "c", type: "cache-hit-rate", metadata: { hideWhenEmpty: "true" } },
    { id: "m", type: "model", color: "cyan", bold: true },
  ], [], []],
  flexMode: "full-minus-40",
  colorLevel: 3,
  globalBold: true,
});

describe("settings migration", () => {
  test("a version 2 file migrates to the current version and still validates", () => {
    const out = migrateSettings(v2());
    expect(out.migrated).toBe(true);
    expect(out.unknownVersion).toBe(false);
    const parsed = SettingsSchema.safeParse(out.settings);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.version).toBe(CURRENT_VERSION);
  });

  test("migration preserves every unrelated value", () => {
    const parsed = SettingsSchema.parse(migrateSettings(v2()).settings);
    expect(parsed.colorLevel).toBe(3);
    expect(parsed.globalBold).toBe(true);
    expect(parsed.flexMode).toBe("full-minus-40");
    expect(parsed.lines[0]![2]).toMatchObject({ id: "m", type: "model", color: "cyan", bold: true });
    expect(parsed.lines[0]![0]!.color).toBe("magenta");
  });

  test("per-widget hide metadata becomes the unified hide list", () => {
    const parsed = SettingsSchema.parse(migrateSettings(v2()).settings);
    expect(parsed.lines[0]![0]!.metadata?.hide).toBe("no-git");
    expect(parsed.lines[0]![0]!.metadata?.hideNoGit).toBeUndefined();
    expect(parsed.lines[0]![1]!.metadata?.hide).toBe("zero");
    expect(parsed.lines[0]![1]!.metadata?.hideWhenEmpty).toBeUndefined();
  });

  test("a current-version file passes through untouched", () => {
    const current = { ...v2(), version: CURRENT_VERSION };
    const out = migrateSettings(current);
    expect(out.migrated).toBe(false);
    expect(out.settings).toEqual(current);
  });

  test("an unknown future version is flagged, never silently reset", () => {
    const out = migrateSettings({ ...v2(), version: 99 });
    expect(out.unknownVersion).toBe(true);
  });

  test("migration never throws on junk", () => {
    for (const junk of [null, 42, "x", [], {}, { version: "2" }, { version: 2, lines: "no" }]) {
      expect(() => migrateSettings(junk)).not.toThrow();
    }
  });
});
