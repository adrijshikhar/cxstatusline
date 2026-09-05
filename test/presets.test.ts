import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { DEFAULT_SETTINGS } from "../src/types/Settings";
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
    "session-cost", "session-usage", "custom-command", "skills",
  ]);
  expect(preview.settings.lines.map((line) => line.map((item) => item.type))).toEqual([
    ["model", "separator", "thinking-effort", "separator", "context-bar", "separator", "current-working-dir", "separator", "git-branch", "separator", "git-changes"],
    ["weekly-usage", "separator", "session-clock", "separator", "input-speed", "separator", "output-speed", "separator", "tokens-cached"],
    ["free-memory", "separator", "session-name", "separator", "claude-session-id"],
  ]);
});

test("normalization strips unknown fields and orphaned separators", () => {
  const normalized = normalizeImportedItems([
    { id: "leading", type: "separator" },
    { id: "model", type: "model", color: "cyan", commandPath: "/never-copied" },
    { id: "middle", type: "separator" },
    { id: "extra", type: "separator" },
    { id: "deferred", type: "custom-command" },
    { id: "trailing", type: "separator" },
  ]);

  expect(normalized.items).toEqual([{ id: "model", type: "model", color: "cyan" }]);
  expect(normalized.omittedTypes).toEqual(["custom-command"]);
  expect("aliases" in normalized).toBe(false);
});
