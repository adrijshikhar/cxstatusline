import { CURRENT_VERSION, SettingsSchema, type Settings } from "../types/Settings";
import { WidgetItemSchema, WidgetTypeSchema, type WidgetItem, type WidgetType } from "../types/Widget";

export interface ImportPreview {
  settings: Settings;
  omittedTypes: string[];
}

export interface NormalizedImportedItems {
  items: WidgetItem[];
  omittedTypes: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addOnce(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value);
}

function trimSeparators(items: WidgetItem[]): WidgetItem[] {
  const result: WidgetItem[] = [];
  for (const item of items) {
    if (item.type === "separator" && (!result.length || result.at(-1)?.type === "separator")) continue;
    result.push(item);
  }
  while (result.at(-1)?.type === "separator") result.pop();
  return result;
}

/** Schema-filter untrusted rows into the closed Codex widget catalog. */
export function normalizeImportedItems(items: readonly unknown[]): NormalizedImportedItems {
  const accepted: WidgetItem[] = [];
  const omittedTypes: string[] = [];

  for (const raw of items) {
    if (!isRecord(raw) || typeof raw.type !== "string") continue;
    const sourceType = raw.type;
    const type = sourceType;
    if (!WidgetTypeSchema.safeParse(type).success) {
      addOnce(omittedTypes, sourceType);
      continue;
    }
    const parsed = WidgetItemSchema.safeParse({ ...raw, type });
    if (parsed.success) accepted.push(parsed.data);
  }

  return { items: trimSeparators(accepted), omittedTypes };
}

/** Normalize native v2 and pinned ccstatusline presets into a validated v2 preview. */
export function previewImport(raw: unknown): ImportPreview {
  if (!isRecord(raw) || !Array.isArray(raw.lines) || raw.lines.length < 1 || raw.lines.length > 3) {
    throw new Error("A preset must contain one to three lines.");
  }
  const omittedTypes: string[] = [];
  const lines = raw.lines.map((line) => {
    if (!Array.isArray(line)) throw new Error("Each preset line must be an array.");
    const normalized = normalizeImportedItems(line);
    for (const type of normalized.omittedTypes) addOnce(omittedTypes, type);
    return normalized.items;
  });
  const parsed = SettingsSchema.safeParse({ ...raw, version: CURRENT_VERSION, lines });
  if (!parsed.success) throw new Error(`Invalid preset: ${parsed.error.issues[0]?.message ?? "settings validation failed"}`);
  return { settings: parsed.data, omittedTypes };
}

export function exportPreset(settings: Settings): string {
  return `${JSON.stringify(SettingsSchema.parse(settings), null, 2)}\n`;
}
