import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { DEFAULT_SETTINGS } from "../src/types/Settings";
import type { WidgetItem } from "../src/types/Widget";
import { exportPreset, normalizeImportedItems, previewImport } from "../src/utils/presets";

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

test("native presets round-trip without aliases or omissions", () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    lines: [[{ id: "term", type: "terminal-width" as const }]],
  };

  const preview = previewImport(JSON.parse(exportPreset(settings)));

  expect(preview.settings).toEqual(settings);
  expect("aliases" in preview).toBe(false);
  expect(preview.omittedTypes).toEqual([]);
});

test("owner ccstatusline preset keeps canonical IDs and reports unsupported widgets", () => {
  const preview = previewImport(fixture("ccstatusline-owner-sanitized.json"));

  expect("aliases" in preview).toBe(false);
  expect(preview.omittedTypes).toEqual([
    "session-cost", "session-usage", "skills",
  ]);
  expect(preview.settings.lines.map((line) => line.map((item) => item.type))).toEqual([
    ["model", "separator", "thinking-effort", "separator", "context-bar", "separator", "current-working-dir", "separator", "git-branch", "separator", "git-changes"],
    ["weekly-usage", "separator", "session-clock", "separator", "input-speed", "separator", "output-speed", "separator", "tokens-cached"],
    ["custom-command", "separator", "free-memory", "separator", "custom-command", "separator", "session-name", "separator", "claude-session-id"],
  ]);
});

test("normalization strips unknown fields and orphaned separators", () => {
  const normalized = normalizeImportedItems([
    { id: "leading", type: "separator" },
    { id: "model", type: "model", color: "cyan", weather: "/never-copied" },
    { id: "middle", type: "separator" },
    { id: "extra", type: "separator" },
    { id: "deferred", type: "skills" },
    { id: "trailing", type: "separator" },
  ]);

  expect(normalized.items).toEqual([{ id: "model", type: "model", color: "cyan" }]);
  expect(normalized.omittedTypes).toEqual(["skills"]);
  expect("aliases" in normalized).toBe(false);
});

test("normalization keeps user-defined widget fields", () => {
  const items: WidgetItem[] = [
    { id: "cmd", type: "custom-command", commandPath: "date +%H:%M", preserveColors: true, timeout: 4000 },
    { id: "txt", type: "custom-text", customText: "[PROD]" },
    { id: "sym", type: "custom-symbol", customSymbol: "⚡" },
  ];
  const normalized = normalizeImportedItems(items);
  expect(normalized.items).toEqual(items);
  expect(normalized.omittedTypes).toEqual([]);
});
