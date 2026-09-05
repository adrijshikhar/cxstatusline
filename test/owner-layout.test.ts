import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { getVisibleText } from "../src/utils/ansi";
import { renderStatusLines } from "../src/utils/renderer";
import { parsePayload } from "../src/payload";
import { SettingsSchema } from "../src/types/Settings";

const fixture = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

function renderFixture(settingsName: string, payloadName: string): string {
  const settings = SettingsSchema.parse(JSON.parse(fixture(settingsName)));
  const data = parsePayload(fixture(payloadName));
  return `${renderStatusLines(settings, {
    data,
    now: new Date("2026-09-02T12:00:00Z"),
    terminalWidth: null,
    freeMemoryBytes: 2 * 1024 ** 3,
    usageData: {
      weeklyUsage: data.usage?.weekly?.used === undefined ? undefined : data.usage.weekly.used * 100,
      weeklyResetAt: data.usage?.weekly?.resets_at,
    },
    isPreview: false,
  }).join("\n")}\n`;
}

test("owner preset renders the retained three-row layout", () => {
  const rows = renderFixture("settings-v2-owner.json", "payload-v1.json");
  expect(rows.split("\n").filter(Boolean)).toHaveLength(3);
  expect(rows.split("\n").filter(Boolean).map(getVisibleText)).toEqual([
    "Model: gpt-5-codex | Thinking: medium | Context: [███████░░░░░░░░░] 84.0k/200.0k (42%) | cwd: /Users/nemesis/Projects/my-projects/cxstatusline | ⎇ main | (+12,-3)",
    "Weekly: 8.0% | Session: 2hr | In: 90.3 t/s | Out: 1.7 t/s | Cached: 520.0k",
    "Mem: 2.0G | Session: dsl | Session ID: 0192a7f0-6c3e-7c1a-9b1e-3f5c2d1a0b9c | SB: ● | v0.152.1",
  ]);

  const settings = JSON.parse(fixture("settings-v2-owner.json")) as {
    lines: Array<Array<{ type: string }>>;
    defaultPadding?: string;
    powerline: { autoAlign: boolean };
  };
  expect(settings.lines.map((line) => line.filter(({ type }) => type !== "separator").map(({ type }) => type))).toEqual([
    ["model", "thinking-effort", "context-bar", "current-working-dir", "git-branch", "git-changes"],
    ["weekly-usage", "session-clock", "input-speed", "output-speed", "tokens-cached"],
    ["free-memory", "session-name", "claude-session-id", "sandbox-status", "version"],
  ]);
  expect(settings.lines.every((line) => {
    const visibleCount = line.filter(({ type }) => type !== "separator").length;
    return line.filter(({ type }) => type === "separator").length === visibleCount - 1;
  })).toBe(true);
  expect(settings.powerline.autoAlign).toBe(true);
  expect(settings.defaultPadding ?? "").toBe("");
});

test("sanitized owner import fixture has no executable command paths", () => {
  const fixtureText = fixture("ccstatusline-owner-sanitized.json");
  const owner = JSON.parse(fixtureText) as { lines: Array<Array<{ type: string; commandPath?: string }>> };
  const commands = owner.lines.flat().filter((item) => item.type === "custom-command");
  expect(commands).toHaveLength(2);
  expect(commands.map((item) => item.commandPath)).toEqual([
    "/deferred/custom-command",
    "/deferred/custom-command",
  ]);
  expect(fixtureText).not.toContain("/Users/");
  expect(fixtureText).not.toContain("/opt/homebrew");
});
