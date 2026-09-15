import { SettingsSchema, type Settings } from "../../src/types/Settings";
import { migrateSettings } from "../../src/utils/migrations";

export const STORAGE_KEY = "cxstatusline.playground.settings.v2";

export function loadSavedSettings(storage: Pick<Storage, "getItem">): { settings: Settings | null; error: string | null } {
  try {
    const value = storage.getItem(STORAGE_KEY);
    if (value === null) return { settings: null, error: null };
    const migration = migrateSettings(JSON.parse(value));
    if (migration.unknownVersion) throw new Error("unsupported version");
    return { settings: SettingsSchema.parse(migration.settings), error: null };
  } catch {
    return { settings: null, error: "Saved browser settings could not be loaded; using the sample." };
  }
}

export function persistSettings(storage: Pick<Storage, "setItem">, value: Settings): Settings {
  const snapshot = SettingsSchema.parse(structuredClone(value));
  storage.setItem(STORAGE_KEY, JSON.stringify(snapshot, null, 2));
  return structuredClone(snapshot);
}
